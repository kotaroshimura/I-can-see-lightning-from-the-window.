const stage = document.querySelector("#stage");
const STAGE_WIDTH = 390;

let serverOffset = 0;
let syncEpoch = Date.now();
let scene = { items: [] };
let players = [];
const gifCache = new Map();

function serverNow() {
  return Date.now() + serverOffset;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

function applySync(sync) {
  serverOffset = sync.serverTime - Date.now();
  syncEpoch = sync.epoch;
}

function readUnsigned(bytes, state) {
  const value = bytes[state.pos] | (bytes[state.pos + 1] << 8);
  state.pos += 2;
  return value;
}

function readColorTable(bytes, state, size) {
  const table = [];
  for (let index = 0; index < size; index += 1) {
    table.push([bytes[state.pos], bytes[state.pos + 1], bytes[state.pos + 2]]);
    state.pos += 3;
  }
  return table;
}

function readSubBlocks(bytes, state) {
  const chunks = [];
  let totalLength = 0;
  while (state.pos < bytes.length) {
    const length = bytes[state.pos++];
    if (length === 0) break;
    chunks.push(bytes.slice(state.pos, state.pos + length));
    state.pos += length;
    totalLength += length;
  }
  const data = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return data;
}

function lzwDecode(minCodeSize, data, expectedLength) {
  let bitPosition = 0;
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let dictionary = [];
  let nextCode = endCode + 1;
  let previous = null;
  const output = [];

  const readCode = (size) => {
    let code = 0;
    for (let bit = 0; bit < size; bit += 1) {
      const byte = data[bitPosition >> 3];
      code |= (((byte >> (bitPosition & 7)) & 1) << bit);
      bitPosition += 1;
    }
    return code;
  };

  const reset = () => {
    dictionary = [];
    for (let code = 0; code < clearCode; code += 1) dictionary[code] = [code];
    dictionary[clearCode] = null;
    dictionary[endCode] = null;
    codeSize = minCodeSize + 1;
    nextCode = endCode + 1;
    previous = null;
  };

  reset();

  while (bitPosition < data.length * 8 && output.length < expectedLength) {
    const code = readCode(codeSize);
    if (code === clearCode) {
      reset();
      continue;
    }
    if (code === endCode) break;

    let entry;
    if (dictionary[code]) {
      entry = dictionary[code].slice();
    } else if (code === nextCode && previous) {
      entry = previous.concat(previous[0]);
    } else {
      break;
    }

    output.push(...entry);

    if (previous) {
      dictionary[nextCode] = previous.concat(entry[0]);
      nextCode += 1;
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
    }
    previous = entry;
  }

  return output.slice(0, expectedLength);
}

function deinterlace(indices, width) {
  const height = Math.ceil(indices.length / width);
  const result = new Array(indices.length);
  const passes = [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2]
  ];
  let sourceRow = 0;
  for (const [start, step] of passes) {
    for (let row = start; row < height; row += step) {
      const from = sourceRow * width;
      const to = row * width;
      for (let column = 0; column < width; column += 1) {
        result[to + column] = indices[from + column];
      }
      sourceRow += 1;
    }
  }
  return result;
}

function copyRect(buffer, canvasWidth, rect) {
  const copy = new Uint8ClampedArray(rect.width * rect.height * 4);
  for (let row = 0; row < rect.height; row += 1) {
    const sourceStart = ((rect.top + row) * canvasWidth + rect.left) * 4;
    const targetStart = row * rect.width * 4;
    copy.set(buffer.slice(sourceStart, sourceStart + rect.width * 4), targetStart);
  }
  return copy;
}

function restoreRect(buffer, canvasWidth, rect, copy) {
  for (let row = 0; row < rect.height; row += 1) {
    const targetStart = ((rect.top + row) * canvasWidth + rect.left) * 4;
    const sourceStart = row * rect.width * 4;
    buffer.set(copy.slice(sourceStart, sourceStart + rect.width * 4), targetStart);
  }
}

function clearRect(buffer, canvasWidth, rect) {
  for (let row = 0; row < rect.height; row += 1) {
    const start = ((rect.top + row) * canvasWidth + rect.left) * 4;
    buffer.fill(0, start, start + rect.width * 4);
  }
}

function decodeGif(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const state = { pos: 0 };
  const signature = String.fromCharCode(...bytes.slice(0, 6));
  state.pos = 6;
  if (!signature.startsWith("GIF")) throw new Error("GIFではありません");

  const width = readUnsigned(bytes, state);
  const height = readUnsigned(bytes, state);
  const packed = bytes[state.pos++];
  const hasGlobalColorTable = (packed & 0x80) !== 0;
  const globalColorTableSize = 1 << ((packed & 0x07) + 1);
  state.pos += 2;
  const globalColorTable = hasGlobalColorTable ? readColorTable(bytes, state, globalColorTableSize) : [];
  const rawFrames = [];
  let graphicsControl = { delay: 100, disposal: 0, transparentIndex: null };

  while (state.pos < bytes.length) {
    const marker = bytes[state.pos++];
    if (marker === 0x3b) break;

    if (marker === 0x21) {
      const label = bytes[state.pos++];
      if (label === 0xf9) {
        state.pos += 1;
        const packedGce = bytes[state.pos++];
        const delay = readUnsigned(bytes, state) * 10;
        const transparentIndex = bytes[state.pos++];
        state.pos += 1;
        graphicsControl = {
          delay: Math.max(delay || 100, 20),
          disposal: (packedGce >> 2) & 0x07,
          transparentIndex: (packedGce & 0x01) ? transparentIndex : null
        };
      } else {
        readSubBlocks(bytes, state);
      }
      continue;
    }

    if (marker !== 0x2c) break;

    const left = readUnsigned(bytes, state);
    const top = readUnsigned(bytes, state);
    const frameWidth = readUnsigned(bytes, state);
    const frameHeight = readUnsigned(bytes, state);
    const imagePacked = bytes[state.pos++];
    const hasLocalColorTable = (imagePacked & 0x80) !== 0;
    const interlaced = (imagePacked & 0x40) !== 0;
    const localColorTableSize = 1 << ((imagePacked & 0x07) + 1);
    const colorTable = hasLocalColorTable ? readColorTable(bytes, state, localColorTableSize) : globalColorTable;
    const minCodeSize = bytes[state.pos++];
    const imageData = readSubBlocks(bytes, state);
    let indices = lzwDecode(minCodeSize, imageData, frameWidth * frameHeight);
    if (interlaced) indices = deinterlace(indices, frameWidth);

    rawFrames.push({
      left,
      top,
      width: frameWidth,
      height: frameHeight,
      colorTable,
      indices,
      ...graphicsControl
    });
    graphicsControl = { delay: 100, disposal: 0, transparentIndex: null };
  }

  const buffer = new Uint8ClampedArray(width * height * 4);
  const frames = [];
  let previousDisposal = 0;
  let previousRect = null;
  let previousBackup = null;

  for (const frame of rawFrames) {
    if (previousDisposal === 2 && previousRect) clearRect(buffer, width, previousRect);
    if (previousDisposal === 3 && previousRect && previousBackup) restoreRect(buffer, width, previousRect, previousBackup);

    const rect = { left: frame.left, top: frame.top, width: frame.width, height: frame.height };
    const backup = frame.disposal === 3 ? copyRect(buffer, width, rect) : null;

    for (let y = 0; y < frame.height; y += 1) {
      for (let x = 0; x < frame.width; x += 1) {
        const index = frame.indices[y * frame.width + x];
        if (index === frame.transparentIndex) continue;
        const color = frame.colorTable[index] || [0, 0, 0];
        const target = ((frame.top + y) * width + frame.left + x) * 4;
        buffer[target] = color[0];
        buffer[target + 1] = color[1];
        buffer[target + 2] = color[2];
        buffer[target + 3] = 255;
      }
    }

    frames.push({
      delay: frame.delay,
      imageData: new ImageData(new Uint8ClampedArray(buffer), width, height)
    });
    previousDisposal = frame.disposal;
    previousRect = rect;
    previousBackup = backup;
  }

  return {
    width,
    height,
    frames,
    duration: frames.reduce((total, frame) => total + frame.delay, 0) || 100
  };
}

async function getDecodedGif(name) {
  if (!gifCache.has(name)) {
    gifCache.set(
      name,
      fetch(`/gifs/${encodeURIComponent(name)}`, { cache: "reload" })
        .then((response) => {
          if (!response.ok) throw new Error(`${name}: ${response.status}`);
          return response.arrayBuffer();
        })
        .then(decodeGif)
    );
  }
  return gifCache.get(name);
}

function frameAt(decoded, elapsed) {
  const phase = ((elapsed % decoded.duration) + decoded.duration) % decoded.duration;
  let cursor = 0;
  for (let index = 0; index < decoded.frames.length; index += 1) {
    cursor += decoded.frames[index].delay;
    if (phase < cursor) return index;
  }
  return decoded.frames.length - 1;
}

function positionItem(item, elapsed) {
  if (item.motion !== "scroll") return { x: item.x, y: item.y };
  const travel = STAGE_WIDTH + item.width;
  const duration = item.duration || 18000;
  const phase = (((elapsed + (item.offset || 0)) % duration) + duration) % duration;
  return {
    x: STAGE_WIDTH - (phase / duration) * travel,
    y: item.y
  };
}

async function renderScene() {
  stage.innerHTML = "";
  const items = scene.items || [];
  players = await Promise.all(
    items.map(async (item) => {
      const decoded = await getDecodedGif(item.gif);
      const canvas = document.createElement("canvas");
      canvas.className = "gifItem";
      canvas.dataset.id = item.id;
      canvas.width = decoded.width;
      canvas.height = decoded.height;
      canvas.style.width = `${item.width}px`;
      canvas.style.height = `${item.height}px`;
      stage.append(canvas);
      return {
        item,
        decoded,
        canvas,
        context: canvas.getContext("2d"),
        lastFrame: -1
      };
    })
  );
}

function tick() {
  const elapsed = serverNow() - syncEpoch;
  for (const player of players) {
    const position = positionItem(player.item, elapsed);
    player.canvas.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;

    const frameIndex = frameAt(player.decoded, elapsed);
    if (frameIndex !== player.lastFrame) {
      player.context.putImageData(player.decoded.frames[frameIndex].imageData, 0, 0);
      player.lastFrame = frameIndex;
    }
  }
  requestAnimationFrame(tick);
}

async function boot() {
  applySync(await fetchJson("/api/sync"));
  scene = (await fetchJson("/api/scene")).scene;
  await renderScene();

  const events = new EventSource("/api/events");
  events.addEventListener("sync", (event) => applySync(JSON.parse(event.data)));
  events.addEventListener("scene", async (event) => {
    scene = JSON.parse(event.data).scene;
    await renderScene();
  });

  tick();
}

boot().catch(() => {
  stage.innerHTML = "";
});
