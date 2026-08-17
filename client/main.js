// Client bootstrap: websocket, input, snapshot interpolation, main loop.
import { TILE } from '/shared/defs.js';
import { render, buildMinimap } from '/render.js';
import * as ui from '/ui.js';

export const state = {
  ws: null, id: 0, name: '',
  w: 0, h: 0, tiles: null, objects: new Map(), wormhole: null, team: null,
  you: null, snapA: null, snapB: null, tA: 0, tB: 0,
  env: { tod: 0.3, day: 0, season: 0, amb: 15, night: false },
  cam: { x: 0, y: 0 },
  mouse: { x: 0, y: 0 }, aim: 0,
  keys: new Set(),
  buildSel: null,          // structure id while placing
  crate: null,             // {i, inv} when a crate is open
  joined: false, dead: false, respawnIn: 0,
  hurtFlash: 0,
  zoom: 1.7,               // close, claustrophobic camera (mouse wheel adjusts)
  shake: 0,                // camera shake on damage
  touch: null,             // {mx,my} from the virtual joystick
  sprintLock: false,       // mobile sprint toggle
};

const canvas = document.getElementById('game');
export const ctx = canvas.getContext('2d');
function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
addEventListener('resize', resize); resize();

// ---------- networking ----------
export function send(m) { if (state.ws?.readyState === 1) state.ws.send(JSON.stringify(m)); }
export function act(k, extra = {}) { send({ t: 'a', k, ...extra }); }

function connect(name) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}`);
  state.ws = ws;
  ws.onopen = () => send({ t: 'join', name });
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => { if (state.joined) ui.log('sys', 'Connection lost. Refresh to rejoin.'); };
}

function handle(m) {
  if (m.t === 'welcome') {
    state.id = m.id; state.name = m.name; state.w = m.w; state.h = m.h;
    const bin = atob(m.tiles);
    state.tiles = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) state.tiles[i] = bin.charCodeAt(i);
    state.objects.clear();
    for (const o of m.objects) state.objects.set(o.i, o);
    state.wormhole = m.wormhole; state.team = m.team;
    state.joined = true;
    buildMinimap(state);
    ui.onJoined();
    return;
  }
  if (m.t === 's') {
    state.snapA = state.snapB; state.tA = state.tB;
    state.snapB = m.ents; state.tB = performance.now();
    state.you = m.you;
    state.env = { tod: m.tod, day: m.day, season: m.season, amb: m.amb, night: m.night };
    state.dead = m.you.dead; state.respawnIn = m.you.respawnIn;
    ui.noteDamage(m.you.hp);
    if (m.mail) for (const ev of m.mail) handleEvent(ev);
    if (m.ev) for (const ev of m.ev) handleEvent(ev);
    ui.refreshHUD();
  }
}

function handleEvent(ev) {
  switch (ev.t) {
    case 'obj+': state.objects.set(ev.o.i, ev.o); break;
    case 'obj-': state.objects.delete(ev.i);
      if (state.crate?.i === ev.i) { state.crate = null; ui.hideCrate(); }
      break;
    case 'obj*': { const o = state.objects.get(ev.i); if (o) Object.assign(o, ev.p); break; }
    case 'team': state.team = ev.team; ui.refreshPanels(); break;
    case 'msg': ui.log('sys', ev.m); break;
    case 'whisper': ui.showWhisper(ev.m); break;
    case 'chat': ui.log('chat', `${ev.from}: ${ev.m}`); break;
    case 'crate': state.crate = { i: ev.i, inv: ev.inv }; ui.showCrate(); break;
    case 'win': ui.showWin(); break;
  }
}

// ---------- interpolated entities ----------
export function lerpedEnts() {
  const now = performance.now() - 120; // render slightly in the past
  if (!state.snapB) return [];
  if (!state.snapA || state.tB === state.tA) return state.snapB;
  const f = Math.min(1.2, Math.max(0, (now - state.tA) / (state.tB - state.tA)));
  const prev = new Map(state.snapA.map(e => [e.k + e.id, e]));
  return state.snapB.map(e => {
    const p = prev.get(e.k + e.id);
    if (!p) return e;
    return { ...e, x: p.x + (e.x - p.x) * f, y: p.y + (e.y - p.y) * f };
  });
}

// my interpolated position (server authoritative; lerp toward you.x/y for smoothness)
export const myPos = { x: 0, y: 0, init: false };

// ---------- input ----------
const KEYMAP = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' };

addEventListener('keydown', (e) => {
  if (!state.joined) return;
  if (ui.chatFocused()) { if (e.key === 'Enter' || e.key === 'Escape') ui.toggleChat(e.key === 'Enter'); return; }
  const k = e.key.toLowerCase();
  if (KEYMAP[k]) state.keys.add(KEYMAP[k]);
  else if (k === 'shift') state.keys.add('sprint');
  else if (k === ' ') { e.preventDefault(); doAttack(); }
  else if (k === 'e') doInteract();
  else if (k === 'f') act('scan');
  else if (k === 'q') act('drink');
  else if (k === 'g') act('fill');
  else if (k === 'c') ui.togglePanel('craft');
  else if (k === 'b') ui.togglePanel('buildmenu');
  else if (k === 'n') ui.togglePanel('catalogue');
  else if (k === 'escape') { state.buildSel = null; ui.closeAll(); }
  else if (k === 'enter') ui.toggleChat(false);
});
addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (KEYMAP[k]) state.keys.delete(KEYMAP[k]);
  if (k === 'shift') state.keys.delete('sprint');
});

canvas.addEventListener('mousemove', (e) => { state.mouse.x = e.clientX; state.mouse.y = e.clientY; });
canvas.addEventListener('mousedown', (e) => {
  if (!state.joined || e.button !== 0) return;
  if (state.buildSel) {
    const [tx, ty] = mouseTile();
    act('build', { s: state.buildSel, tx, ty });
    if (!e.shiftKey) { state.buildSel = null; }
    return;
  }
  doAttack();
});
addEventListener('contextmenu', e => e.preventDefault());

export function mouseTile() {
  const z = TILE * state.zoom;
  return [
    Math.floor((state.mouse.x - canvas.width / 2) / z + myPos.x),
    Math.floor((state.mouse.y - canvas.height / 2) / z + myPos.y),
  ];
}

addEventListener('wheel', (e) => {
  if (!state.joined) return;
  state.zoom = Math.max(1.2, Math.min(2.4, state.zoom - Math.sign(e.deltaY) * 0.15));
}, { passive: true });

// aim at the nearest creature when attacking without a pointer (mobile)
function autoAim() {
  let best = null, bd = 4 * 4;
  if (state.snapB) for (const e of state.snapB) {
    if (e.k !== 'c') continue;
    const d = (e.x - myPos.x) ** 2 + (e.y - myPos.y) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  if (best) state.aim = Math.atan2(best.y - myPos.y, best.x - myPos.x);
  return state.aim;
}

function doAttack() { state.attackAnim = performance.now(); act('attack', { aim: state.aim }); }

// nearest interactable object within reach — the client proposes, the server validates
export function nearestInteractable() {
  let best = null, bd = 2.2 * 2.2;
  for (const o of state.objects.values()) {
    const d = (o.x + 0.5 - myPos.x) ** 2 + (o.y + 0.5 - myPos.y) ** 2;
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function doInteract() {
  const o = nearestInteractable();
  if (!o) { act('drink'); return; } // fallback: try drinking if next to water
  if (o.ty === 'campfire') { ui.showCampfire(o.i); return; }
  if (o.ty === 'crate') { act('open', { obj: o.i }); return; }
  act('interact', { obj: o.i });
}

// ---------- loops ----------
setInterval(() => { // input stream to server
  if (!state.joined) return;
  let mx = (state.keys.has('right') ? 1 : 0) - (state.keys.has('left') ? 1 : 0);
  let my = (state.keys.has('down') ? 1 : 0) - (state.keys.has('up') ? 1 : 0);
  if (state.touch) { mx = state.touch.mx; my = state.touch.my; }
  if (state.touch && (mx || my)) state.aim = Math.atan2(my, mx); // face where you walk
  send({ t: 'i', mx, my, sprint: state.keys.has('sprint') || state.sprintLock, aim: state.aim });
}, 50);

// ---------- touch controls ----------
if ('ontouchstart' in window) initTouch();
function initTouch() {
  document.body.classList.add('mobile');
  const joy = document.createElement('div'); joy.id = 'joy';
  joy.innerHTML = '<div id="joybase"><div id="joystick"></div></div>';
  document.body.appendChild(joy);
  const btns = document.createElement('div'); btns.id = 'mbtns';
  const B = (label, title, fn, hold) => {
    const b = document.createElement('button');
    b.className = 'mbtn'; b.textContent = label; b.title = title;
    b.addEventListener('touchstart', (e) => { e.preventDefault(); fn(b); }, { passive: false });
    btns.appendChild(b);
    return b;
  };
  B('⚔️', 'attack', () => { autoAim(); doAttack(); });
  B('✋', 'interact', () => doInteract());
  B('📡', 'scan', () => act('scan'));
  B('💧', 'drink', () => act('drink'));
  B('🏃', 'sprint', (b) => { state.sprintLock = !state.sprintLock; b.classList.toggle('on', state.sprintLock); });
  document.body.appendChild(btns);

  const base = joy.querySelector('#joybase'), stick = joy.querySelector('#joystick');
  let origin = null, touchId = null;
  addEventListener('touchstart', (e) => {
    if (!state.joined) return;
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.45 && t.clientY > innerHeight * 0.3 && touchId === null) {
        touchId = t.identifier;
        origin = { x: t.clientX, y: t.clientY };
        joy.style.display = 'block';
        base.style.left = (t.clientX - 60) + 'px'; base.style.top = (t.clientY - 60) + 'px';
      }
    }
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (touchId === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== touchId) continue;
      const dx = t.clientX - origin.x, dy = t.clientY - origin.y;
      const d = Math.hypot(dx, dy), max = 52;
      const f = d > 10 ? Math.min(1, d / max) : 0; // deadzone
      state.touch = d > 10 ? { mx: dx / d * f, my: dy / d * f } : { mx: 0, my: 0 };
      const cd = Math.min(d, max);
      stick.style.transform = `translate(${d ? dx / d * cd : 0}px, ${d ? dy / d * cd : 0}px)`;
    }
  }, { passive: true });
  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchId) {
        touchId = null; state.touch = { mx: 0, my: 0 };
        stick.style.transform = 'translate(0,0)';
        joy.style.display = 'none';
      }
    }
  };
  addEventListener('touchend', endTouch, { passive: true });
  addEventListener('touchcancel', endTouch, { passive: true });
}

function frame() {
  requestAnimationFrame(frame);
  if (!state.joined || !state.you) return;
  // smooth own position toward server truth
  if (!myPos.init) { myPos.x = state.you.x; myPos.y = state.you.y; myPos.init = true; }
  myPos.x += (state.you.x - myPos.x) * 0.25;
  myPos.y += (state.you.y - myPos.y) * 0.25;
  state.aim = Math.atan2(state.mouse.y - canvas.height / 2, state.mouse.x - canvas.width / 2);
  render(ctx, canvas, state);
  ui.refreshHint();
}
requestAnimationFrame(frame);

// ---------- join screen ----------
document.getElementById('joinbtn').onclick = () => {
  const name = document.getElementById('name').value.trim() || 'Researcher';
  document.getElementById('join').style.display = 'none';
  connect(name);
};
document.getElementById('name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('joinbtn').click();
  e.stopPropagation();
});
