// dimensions du grid — doit matcher avec server.js côté backend
const GRID_W = 50;
const GRID_H = 50;

// palette de 16 couleurs
const PALETTE = [
  "#ffffff", "#e4e4e4", "#888888", "#222222",
  "#ffa7d1", "#e50000", "#e59500", "#a06a42",
  "#e5d900", "#94e044", "#02be01", "#00d3dd",
  "#0083c7", "#0000ea", "#cf6ee4", "#820080",
];

// même origine, nginx fait le proxy vers le backend
const BACKEND_HTTP = "";
const BACKEND_WS   = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

let activeColor = PALETTE[1];   // gris clair par défaut
let ws          = null;
let cells       = {};           // clé "x,y" → couleur hex

// refs DOM
const gridEl    = document.getElementById("grid");
const statusEl  = document.getElementById("status-bar");
const toolbarEl = document.getElementById("toolbar");
const coordsEl  = document.getElementById("coords");

// palette de couleurs dans le toolbar
PALETTE.forEach(hex => {
  const sw = document.createElement("div");
  sw.className = "swatch";
  sw.style.background = hex;
  sw.title = hex;
  if (hex === activeColor) sw.classList.add("selected");
  sw.addEventListener("click", () => {
    document.querySelectorAll(".swatch.selected").forEach(s => s.classList.remove("selected"));
    sw.classList.add("selected");
    activeColor = hex;
  });
  toolbarEl.appendChild(sw);
});

// construction du grid
gridEl.style.gridTemplateColumns = `repeat(${GRID_W}, 12px)`;

for (let y = 0; y < GRID_H; y++) {
  for (let x = 0; x < GRID_W; x++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.x = x;
    cell.dataset.y = y;

    cell.addEventListener("mouseenter", () => {
      coordsEl.textContent = `(${x}, ${y})`;
    });

    cell.addEventListener("click", () => sendPixel(x, y, activeColor));

    gridEl.appendChild(cell);
  }
}

function cellEl(x, y) {
  // index direct, plus rapide qu'un querySelector
  return gridEl.children[y * GRID_W + x] || null;
}

function applyPixel(x, y, color) {
  cells[`${x},${y}`] = color;
  const el = cellEl(x, y);
  if (el) el.style.background = color;
}

// fetch le grid complet au chargement
async function loadGrid() {
  try {
    const res  = await fetch(`${BACKEND_HTTP}/api/grid`);
    const data = await res.json();
    Object.entries(data.cells || {}).forEach(([key, color]) => {
      const [x, y] = key.split(",").map(Number);
      applyPixel(x, y, color);
    });
  } catch (err) {
    statusEl.textContent = "grid fetch failed — " + err.message;
  }
}

async function sendPixel(x, y, color) {
  applyPixel(x, y, color);  // update optimiste

  try {
    await fetch(`${BACKEND_HTTP}/api/pixel`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ x, y, color }),
    });
  } catch (_) {
    // le backend renverra le bon état de toute façon
  }
}

// websocket pour les màj en temps réel
function connectWS() {
  ws = new WebSocket(BACKEND_WS);

  ws.addEventListener("open", () => {
    statusEl.textContent = "live";
  });

  ws.addEventListener("message", evt => {
    try {
      const msg = JSON.parse(evt.data);
      // console.log(msg);
      if (msg.type === "pixel") {
        applyPixel(msg.x, msg.y, msg.color);
      }
    } catch (_) { /* msg foireux */ }
  });

  ws.addEventListener("close", () => {
    statusEl.textContent = "disconnected — retry in 3s";
    setTimeout(connectWS, 3000);
  });

  ws.addEventListener("error", () => {
    statusEl.textContent = "ws error";
    ws.close();
  });
}

// --- init ---
loadGrid().then(() => connectWS());
