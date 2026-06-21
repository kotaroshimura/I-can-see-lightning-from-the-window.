const loginPanel = document.querySelector("#loginPanel");
const editorPanel = document.querySelector("#editorPanel");
const loginForm = document.querySelector("#loginForm");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const library = document.querySelector("#library");
const adminStage = document.querySelector("#adminStage");
const message = document.querySelector("#message");
const saveButton = document.querySelector("#saveButton");
const deleteButton = document.querySelector("#deleteButton");
const duplicateButton = document.querySelector("#duplicateButton");
const xInput = document.querySelector("#xInput");
const yInput = document.querySelector("#yInput");
const wInput = document.querySelector("#wInput");
const hInput = document.querySelector("#hInput");
const motionInput = document.querySelector("#motionInput");
const durationInput = document.querySelector("#durationInput");

const STAGE_WIDTH = 390;
const STAGE_HEIGHT = 844;
let scene = { stage: { width: STAGE_WIDTH, height: STAGE_HEIGHT }, items: [] };
let gifs = [];
let selectedIds = new Set();
let dragState = null;

function isFilePage() {
  return window.location.protocol === "file:";
}

async function requestJson(url, options = {}) {
  if (isFilePage()) throw new Error("サーバー経由で開いてください");
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    let text = await response.text();
    try {
      text = JSON.parse(text).error || text;
    } catch (_error) {
      // Keep raw message.
    }
    throw new Error(text);
  }
  return response.json();
}

function showMessage(text) {
  message.textContent = text;
}

function selectedItems() {
  return scene.items.filter((item) => selectedIds.has(item.id));
}

function renderLibrary() {
  library.innerHTML = "";
  for (const gif of gifs) {
    const button = document.createElement("button");
    button.className = "gifChoice";
    button.type = "button";
    button.title = gif;
    button.innerHTML = `<img src="/gifs/${encodeURIComponent(gif)}" alt="">`;
    button.addEventListener("click", () => addItem(gif));
    library.append(button);
  }
}

function renderStage() {
  adminStage.innerHTML = "";
  for (const item of scene.items) {
    const node = document.createElement("div");
    node.className = `item${selectedIds.has(item.id) ? " selected" : ""}`;
    node.dataset.id = item.id;
    node.style.width = `${item.width}px`;
    node.style.height = `${item.height}px`;
    node.style.transform = `translate(${item.x}px, ${item.y}px)`;
    node.innerHTML = `<img src="/gifs/${encodeURIComponent(item.gif)}" alt="">`;
    node.addEventListener("pointerdown", (event) => startDrag(event, item.id));
    node.addEventListener("click", (event) => selectItem(event, item.id));
    adminStage.append(node);
  }
  syncControls();
}

function selectItem(event, id) {
  event.stopPropagation();
  if (event.shiftKey) {
    selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
  } else {
    selectedIds = new Set([id]);
  }
  renderStage();
}

function addItem(gif) {
  const item = {
    id: `item-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    gif,
    x: 120,
    y: 356,
    width: 132,
    height: 132,
    motion: "fixed",
    duration: 18000,
    offset: 0
  };
  scene.items.push(item);
  selectedIds = new Set([item.id]);
  renderStage();
  showMessage("追加しました");
}

function startDrag(event, id) {
  if (!selectedIds.has(id)) selectedIds = new Set([id]);
  dragState = {
    startX: event.clientX,
    startY: event.clientY,
    items: selectedItems().map((item) => ({ id: item.id, x: item.x, y: item.y }))
  };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function moveDrag(event) {
  if (!dragState) return;
  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;

  for (const start of dragState.items) {
    const item = scene.items.find((entry) => entry.id === start.id);
    if (!item) continue;
    item.x = Math.round(Math.max(0, Math.min(STAGE_WIDTH - item.width, start.x + dx)));
    item.y = Math.round(Math.max(0, Math.min(STAGE_HEIGHT - item.height, start.y + dy)));
  }
  renderStage();
}

function endDrag() {
  dragState = null;
}

function syncControls() {
  const first = selectedItems()[0];
  const disabled = !first;
  for (const input of [xInput, yInput, wInput, hInput, motionInput, durationInput]) {
    input.disabled = disabled;
  }
  if (!first) {
    xInput.value = "";
    yInput.value = "";
    wInput.value = "";
    hInput.value = "";
    motionInput.value = "fixed";
    durationInput.value = "";
    return;
  }
  xInput.value = first.x;
  yInput.value = first.y;
  wInput.value = first.width;
  hInput.value = first.height;
  motionInput.value = first.motion;
  durationInput.value = Math.round((first.duration || 18000) / 1000);
}

function clampItem(item) {
  item.width = Math.max(1, Math.min(STAGE_WIDTH, item.width));
  item.height = Math.max(1, Math.min(STAGE_HEIGHT, item.height));
  item.x = Math.max(0, Math.min(STAGE_WIDTH - item.width, item.x));
  item.y = Math.max(0, Math.min(STAGE_HEIGHT - item.height, item.y));
}

function applyControl(key, value) {
  for (const item of selectedItems()) {
    if (key === "duration") {
      item.duration = Math.max(1, Number(value) || 18) * 1000;
    } else if (key === "motion") {
      item.motion = value;
    } else {
      item[key] = Math.round(Number(value) || 0);
    }
    clampItem(item);
  }
  renderStage();
}

function deleteSelected() {
  scene.items = scene.items.filter((item) => !selectedIds.has(item.id));
  selectedIds = new Set();
  renderStage();
  showMessage("削除しました");
}

function duplicateSelected() {
  const copies = selectedItems().map((item) => ({
    ...item,
    id: `item-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    x: Math.min(STAGE_WIDTH - item.width, item.x + 18),
    y: Math.min(STAGE_HEIGHT - item.height, item.y + 18)
  }));
  scene.items.push(...copies);
  selectedIds = new Set(copies.map((item) => item.id));
  renderStage();
}

async function saveScene() {
  const result = await requestJson("/api/admin/scene", {
    method: "PUT",
    body: JSON.stringify({ scene })
  });
  scene = result.scene;
  renderStage();
  showMessage("保存しました。閲覧ページにも反映されます。");
}

async function loadEditor() {
  const state = await requestJson("/api/admin/state");
  gifs = state.gifs;
  scene = state.scene;
  renderLibrary();
  renderStage();
  loginPanel.hidden = true;
  editorPanel.hidden = false;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isFilePage()) {
    loginMessage.textContent = "http://localhost:5178/admin を開いてください。";
    window.location.href = "http://localhost:5178/admin";
    return;
  }
  try {
    await requestJson("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: passwordInput.value })
    });
    await loadEditor();
  } catch (error) {
    loginMessage.textContent = `ログインできません: ${error.message}`;
  }
});

adminStage.addEventListener("click", () => {
  selectedIds = new Set();
  renderStage();
});
window.addEventListener("pointermove", moveDrag);
window.addEventListener("pointerup", endDrag);
saveButton.addEventListener("click", saveScene);
deleteButton.addEventListener("click", deleteSelected);
duplicateButton.addEventListener("click", duplicateSelected);
xInput.addEventListener("input", () => applyControl("x", xInput.value));
yInput.addEventListener("input", () => applyControl("y", yInput.value));
wInput.addEventListener("input", () => applyControl("width", wInput.value));
hInput.addEventListener("input", () => applyControl("height", hInput.value));
motionInput.addEventListener("change", () => applyControl("motion", motionInput.value));
durationInput.addEventListener("input", () => applyControl("duration", durationInput.value));

loadEditor().catch(() => {
  loginPanel.hidden = false;
  editorPanel.hidden = true;
  if (isFilePage()) loginMessage.textContent = "サーバー経由で開いてください。";
});
