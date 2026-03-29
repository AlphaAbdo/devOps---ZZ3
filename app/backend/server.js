"use strict";

const http    = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const Redis   = require("ioredis");
const prom    = require("prom-client");

// métriques Node.js par défaut (cpu, mémoire, event loop...)
prom.collectDefaultMetrics({ prefix: "pixelwar_" });

const cPixelsPlaced = new prom.Counter({
  name: "pixelwar_pixels_placed_total",
  help: "nombre de pixels posés",
});

const gWsConnections = new prom.Gauge({
  name: "pixelwar_ws_connections_active",
  help: "connexions websocket actives",
});

// --- config ---
const PORT       = parseInt(process.env.PORT       || "3000", 10);
const REDIS_HOST = process.env.REDIS_HOST           || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT  || "6379", 10);
const REDIS_PASS = process.env.REDIS_PASS           || undefined;

const GRID_KEY = "pixelgrid";  // clé du hash Redis

const GRID_W = 50;
const GRID_H = 50;

// redis
const redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASS, lazyConnect: true });

redis.on("error", err => {
  console.error("redis error:", err.message);
});

redis.connect().catch(err => {
  console.error("redis connect failed:", err.message);
  process.exit(1);
});

// express
const app = express();
app.use(express.json());

// CORS ouvert — c'est une démo de toute façon
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// probe K8s
app.get("/healthz", async (req, res) => {
  try {
    await redis.ping();
    res.json({ ok: true });
  } catch (_) {
    res.status(503).json({ ok: false });
  }
});

app.get("/api/grid", async (req, res) => {
  try {
    const raw   = await redis.hgetall(GRID_KEY);
    const cells = raw || {};
    res.json({ gridWidth: GRID_W, gridHeight: GRID_H, cells });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// pose un pixel
app.post("/api/pixel", async (req, res) => {
  const { x, y, color } = req.body;
  // console.log("pixel:", x, y, color);

  if (
    typeof x !== "number" || typeof y !== "number" || typeof color !== "string" ||
    x < 0 || x >= GRID_W || y < 0 || y >= GRID_H ||
    !/^#[0-9a-fA-F]{6}$/.test(color)
  ) {
    return res.status(400).json({ error: "bad payload" });
  }

  try {
    await redis.hset(GRID_KEY, `${x},${y}`, color);
    broadcast({ type: "pixel", x, y, color });
    cPixelsPlaced.inc();
    // TODO: mettre un rate limit ici? genre 1px/sec par IP
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- serveur HTTP + websocket ---
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: "/ws" });

function broadcast(msg) {
  const frame = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(frame);
    }
  }
}

wss.on("connection", ws => {
  gWsConnections.inc();
  ws.on("close",  () => gWsConnections.dec());
  ws.on("error", () => {});  // rien à faire ici
});

// métriques Prometheus
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", prom.register.contentType);
  res.end(await prom.register.metrics());
});

server.listen(PORT, () => {
  console.log(`pixelwar backend on :${PORT} — redis ${REDIS_HOST}:${REDIS_PORT}`);
});

// graceful shutdown sinon K8s coupe les connexions ws
process.on("SIGTERM", () => {
  console.log("SIGTERM: shutting down");
  server.close(() => {
    redis.quit().finally(() => process.exit(0));
  });
});

process.on("SIGINT", () => process.emit("SIGTERM"));
