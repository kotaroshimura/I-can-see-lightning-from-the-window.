const fs = require("fs");
const path = require("path");
const express = require("express");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const GIF_DIR = path.join(ROOT, "GIF");
const DATA_DIR = path.join(ROOT, "data");
const SCENE_FILE = path.join(DATA_DIR, "scene.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === "production" ? "" : "admin");
const ADMIN_COOKIE = "gif_admin=1";
const syncEpoch = Date.now();

fs.mkdirSync(GIF_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

function listGifs() {
  return fs
    .readdirSync(GIF_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".gif"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function defaultScene() {
  return {
    stage: { width: 390, height: 844 },
    items: listGifs().slice(0, 1).map((gif, index) => ({
      id: `item-${index + 1}`,
      gif,
      x: 390,
      y: 356,
      width: 132,
      height: 132,
      motion: "scroll",
      duration: 18000,
      offset: 0
    }))
  };
}

function readScene() {
  try {
    const scene = JSON.parse(fs.readFileSync(SCENE_FILE, "utf8"));
    if (scene && Array.isArray(scene.items)) return scene;
  } catch (_error) {
    // No saved scene yet.
  }
  return defaultScene();
}

function cleanNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sanitizeScene(scene) {
  const gifSet = new Set(listGifs());
  const sourceItems = Array.isArray(scene.items) ? scene.items : [];
  return {
    stage: { width: 390, height: 844 },
    items: sourceItems
      .filter((item) => gifSet.has(item.gif))
      .slice(0, 100)
      .map((item, index) => ({
        id: String(item.id || `item-${Date.now()}-${index}`),
        gif: String(item.gif),
        x: cleanNumber(item.x, 0),
        y: cleanNumber(item.y, 0),
        width: Math.max(1, Math.min(390, cleanNumber(item.width, 132))),
        height: Math.max(1, Math.min(844, cleanNumber(item.height, 132))),
        motion: item.motion === "scroll" ? "scroll" : "fixed",
        duration: Math.max(1000, Math.min(120000, cleanNumber(item.duration, 18000))),
        offset: cleanNumber(item.offset, 0)
      }))
  };
}

function saveScene(scene) {
  const cleanScene = sanitizeScene(scene);
  fs.writeFileSync(SCENE_FILE, JSON.stringify(cleanScene, null, 2));
  broadcastScene(cleanScene);
  return cleanScene;
}

function isAdmin(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map((cookie) => cookie.trim())
    .includes(ADMIN_COOKIE);
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: "Unauthorized" });
}

const eventClients = new Set();

function broadcastScene(scene = readScene()) {
  const data = JSON.stringify({ scene });
  for (const res of eventClients) {
    res.write("event: scene\n");
    res.write(`data: ${data}\n\n`);
  }
}

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR, { etag: false, maxAge: 0 }));
app.use("/gifs", express.static(GIF_DIR, { immutable: false, maxAge: "1m" }));

app.get("/api/scene", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ scene: readScene() });
});

app.get("/api/sync", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ serverTime: Date.now(), epoch: syncEpoch });
});

app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive"
  });

  const sendSync = () => {
    res.write("event: sync\n");
    res.write(`data: ${JSON.stringify({ serverTime: Date.now(), epoch: syncEpoch })}\n\n`);
  };

  eventClients.add(res);
  sendSync();
  broadcastScene();
  const timer = setInterval(sendSync, 1000);
  req.on("close", () => {
    clearInterval(timer);
    eventClients.delete(res);
  });
});

app.post("/api/admin/login", (req, res) => {
  if (!ADMIN_PASSWORD) {
    res.status(503).json({ error: "ADMIN_PASSWORD is not configured" });
    return;
  }
  if (req.body && req.body.password === ADMIN_PASSWORD) {
    res.setHeader("Set-Cookie", `${ADMIN_COOKIE}; Path=/; SameSite=Lax; HttpOnly`);
    res.json({ ok: true });
    return;
  }
  res.status(401).json({ error: "Password is incorrect" });
});

app.post("/api/admin/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "gif_admin=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly");
  res.json({ ok: true });
});

app.get("/api/admin/state", requireAdmin, (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ gifs: listGifs(), scene: readScene() });
});

app.put("/api/admin/scene", requireAdmin, (req, res) => {
  res.json({ scene: saveScene(req.body.scene || {}) });
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, HOST, () => {
  const shownHost = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`Viewer: http://${shownHost}:${PORT}`);
  console.log(`Admin:  http://${shownHost}:${PORT}/admin`);
});
