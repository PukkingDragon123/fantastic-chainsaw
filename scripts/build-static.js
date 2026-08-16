// Builds a self-contained single-player index.html at the repo root.
// It inlines shared defs, the server simulation, and the client, wired together
// with an in-page loopback "socket" instead of a real WebSocket — so the game
// runs entirely in the browser (solo mode) and can be hosted on any static CDN.
// Real co-op still uses `npm start` (the authoritative server).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// strip ES module syntax so all files share one inline <script type="module"> scope
const strip = src => src
  .replace(/^import\s[\s\S]*?from\s*['"][^'"]*['"];\s*$/gm, '')
  .replace(/^export\s+/gm, '');

const shim = `
// ---- browser shims for the server simulation ----
const Buffer = { from: (u8) => ({ toString: () => {
  let s = '';
  for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  return btoa(s);
} }) };

// ---- loopback socket: routes client messages straight into a local Game ----
const SAVE_KEY = 'exoterra-save';
let localGame = null, localPlayer = null, localTimers = [];

class LocalSocket {
  constructor() { this.readyState = 1; setTimeout(() => this.onopen && this.onopen(), 0); }
  close() {}
  deliver(obj) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }); }
  send(raw) {
    const m = JSON.parse(raw);
    if (m.t === 'join') {
      let save = null;
      if (!location.search.includes('fresh')) {
        try { save = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch {}
      }
      try { localGame = new Game(save); }
      catch (e) { console.warn('save incompatible, starting fresh', e); localGame = new Game(null); }
      localPlayer = localGame.addPlayer(String(m.name || 'Researcher').slice(0, 16) || 'Researcher');
      this.deliver(localGame.welcome(localPlayer));
      localGame.emit({ t: 'chat', from: '🛰', m: localPlayer.name + ' came through the wormhole. (solo expedition — run the server for co-op)' });
      localTimers.forEach(clearInterval);
      localTimers = [
        setInterval(() => localGame.tick(1 / TICK_RATE), 1000 / TICK_RATE),
        setInterval(() => {
          const ev = localGame.events; localGame.events = [];
          const snap = localGame.snapshotFor(localPlayer);
          if (ev.length) snap.ev = ev;
          this.deliver(snap);
        }, 1000 / SNAP_RATE),
        setInterval(() => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(localGame.save())); } catch {} }, 30_000),
      ];
      addEventListener('beforeunload', () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(localGame.save())); } catch {} });
      window.__exo = () => localGame; // debug/testing hook (solo build only)
      return;
    }
    const p = localPlayer;
    if (!p || !localGame) return;
    if (m.t === 'i') {
      const cl = v => { v = +v; return isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0; };
      p.input.mx = cl(m.mx); p.input.my = cl(m.my); p.input.sprint = !!m.sprint;
      if (typeof m.aim === 'number' && isFinite(m.aim)) p.aim = m.aim;
    } else if (m.t === 'a') {
      if (m.k === 'drink') localGame.drinkWater(p, false);
      else if (m.k === 'fill') localGame.drinkWater(p, true);
      else localGame.action(p, m);
    } else if (m.t === 'chat') {
      const text = String(m.m || '').slice(0, 160);
      if (text) localGame.emit({ t: 'chat', from: p.name, m: text });
    }
  }
}
const WebSocket = LocalSocket;
`;

const js = [
  shim,
  strip(read('shared/defs.js')),
  strip(read('server/worldgen.js')),
  strip(read('server/game.js')),
  strip(read('client/main.js')),
  strip(read('client/render.js')),
  strip(read('client/ui.js')),
  // main.js imports ui as a namespace; rebuild that object from the inlined functions
  `const ui = { onJoined, refreshHUD, togglePanel, closeAll, refreshPanels, showCrate,
    hideCrate, showCampfire, refreshHint, log, chatFocused, toggleChat, showWin,
    noteDamage, openCat };`,
].join('\n');

let html = read('client/index.html')
  .replace('<script type="module" src="/main.js"></script>',
    '<script type="module">\n' + js + '\n</script>')
  .replace('<title>EXO-TERRA — Research Expedition</title>',
    '<title>EXO-TERRA — Research Expedition (solo)</title>')
  .replace('Survive. Catalogue. Repair. Return.',
    'Survive. Catalogue. Repair. Return.<br><small>Solo build — progress saves in your browser. Add ?fresh to the URL for a new world.</small>');

fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log('wrote index.html (' + (html.length / 1024).toFixed(0) + ' KB)');
