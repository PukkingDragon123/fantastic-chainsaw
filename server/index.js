// EXO-TERRA server: static file host + WebSocket gateway + fixed-step game loop.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';
import { TICK_RATE, SNAP_RATE } from '../shared/defs.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = process.env.PORT || 3000;
const SAVE_FILE = path.join(ROOT, 'save.json');

// ---- load or create world ----
let save = null;
if (fs.existsSync(SAVE_FILE)) {
  try {
    save = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    console.log('Loaded save.json');
  } catch (e) { console.warn('Corrupt save, starting fresh:', e.message); }
}
const game = new Game(save);

// ---- static file server ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';
  if (url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const base = url.startsWith('/shared/') ? ROOT : path.join(ROOT, 'client');
  const file = path.normalize(path.join(base, url.startsWith('/shared/') ? url : url.slice(1)));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

// ---- websocket gateway ----
const wss = new WebSocketServer({ server });
const clients = new Map(); // ws -> player

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const p = clients.get(ws);

    if (!p) {
      if (m.t !== 'join') return;
      const name = String(m.name || 'Researcher').slice(0, 16).replace(/[^\w\- ]/g, '') || 'Researcher';
      // one live connection per character name
      for (const [ows, op] of clients) if (op.name === name) { ows.close(); clients.delete(ows); game.removePlayer(op); }
      const player = game.addPlayer(name);
      clients.set(ws, player);
      ws.send(JSON.stringify(game.welcome(player)));
      game.emit({ t: 'chat', from: '🛰', m: `${name} came through the wormhole.` });
      return;
    }

    if (m.t === 'i') {
      p.input.mx = clampNum(m.mx); p.input.my = clampNum(m.my);
      p.input.sprint = !!m.sprint;
      if (typeof m.aim === 'number' && isFinite(m.aim)) p.aim = m.aim;
    } else if (m.t === 'a') {
      if (m.k === 'drink') game.drinkWater(p, false);
      else if (m.k === 'fill') game.drinkWater(p, true);
      else game.action(p, m);
    } else if (m.t === 'chat') {
      const text = String(m.m || '').slice(0, 160);
      if (text) game.emit({ t: 'chat', from: p.name, m: text });
    }
  });
  ws.on('close', () => {
    const p = clients.get(ws);
    if (p) {
      game.emit({ t: 'chat', from: '🛰', m: `${p.name} lost signal.` });
      game.removePlayer(p);
      clients.delete(ws);
    }
  });
});

function clampNum(v) { v = +v; return isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0; }

// ---- game loop ----
const dt = 1 / TICK_RATE;
setInterval(() => game.tick(dt), 1000 / TICK_RATE);

// snapshots + queued broadcast events
setInterval(() => {
  const events = game.events;
  game.events = [];
  for (const [ws, p] of clients) {
    if (ws.readyState !== ws.OPEN) continue;
    const snap = game.snapshotFor(p);
    if (events.length) snap.ev = events;
    ws.send(JSON.stringify(snap));
  }
}, 1000 / SNAP_RATE);

// ---- persistence ----
function writeSave() {
  try { fs.writeFileSync(SAVE_FILE, JSON.stringify(game.save())); }
  catch (e) { console.warn('save failed:', e.message); }
}
setInterval(writeSave, 60_000);
process.on('SIGINT', () => { writeSave(); console.log('\nsaved. bye.'); process.exit(0); });
process.on('SIGTERM', () => { writeSave(); process.exit(0); });

server.listen(PORT, () => console.log(`EXO-TERRA running → http://localhost:${PORT} (seed ${game.seed})`));
