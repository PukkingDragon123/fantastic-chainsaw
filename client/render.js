// Canvas renderer: procedurally drawn world with per-tile variation, biome decor,
// drop shadows, animated flora/creatures, dynamic lighting and day-phase grading.
// Everything is drawn in code — art assets can replace these shapes later.
import { TILE, TILE_INFO, T, RESOURCES, STRUCTURES, CREATURES, ITEMS, phaseOf } from '/shared/defs.js';
import { lerpedEnts, myPos, mouseTile } from '/main.js';

const TAU = Math.PI * 2;
const hash = (x, y) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296; // 0..1, deterministic per tile
};

// ---------- minimap ----------
const mini = document.createElement('canvas');
let miniDone = false;
const miniEl = document.createElement('canvas');
miniEl.id = 'minimap'; miniEl.width = 150; miniEl.height = 150;
document.body.appendChild(miniEl);

export function buildMinimap(state) {
  mini.width = state.w; mini.height = state.h;
  const mctx = mini.getContext('2d');
  const img = mctx.createImageData(state.w, state.h);
  for (let i = 0; i < state.tiles.length; i++) {
    const c = TILE_INFO[state.tiles[i]].color;
    img.data[i * 4] = parseInt(c.slice(1, 3), 16);
    img.data[i * 4 + 1] = parseInt(c.slice(3, 5), 16);
    img.data[i * 4 + 2] = parseInt(c.slice(5, 7), 16);
    img.data[i * 4 + 3] = 255;
  }
  mctx.putImageData(img, 0, 0);
  miniDone = true;
}

// ---------- particles (sparks, spores) ----------
const parts = [];
function spark(x, y, vx, vy, life, color, size) {
  if (parts.length < 220) parts.push({ x, y, vx, vy, life, max: life, color, size });
}

// offscreen buffer for the darkness/light pass (punching holes in the main
// canvas with destination-out would erase the scene itself)
const lightCv = document.createElement('canvas');
const lctx = lightCv.getContext('2d');

// tile color variation cache
const shadeCache = new Map();
function tileColor(base, v) {
  const key = base + v;
  let c = shadeCache.get(key);
  if (!c) {
    const d = (v - 0.5) * 22;
    const r = Math.max(0, Math.min(255, parseInt(base.slice(1, 3), 16) + d));
    const g = Math.max(0, Math.min(255, parseInt(base.slice(3, 5), 16) + d));
    const b = Math.max(0, Math.min(255, parseInt(base.slice(5, 7), 16) + d));
    c = `rgb(${r | 0},${g | 0},${b | 0})`;
    shadeCache.set(key, c);
  }
  return c;
}

const shadow = (ctx, x, y, rx, ry) => {
  ctx.fillStyle = 'rgba(10,14,8,.28)';
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
};

export function render(ctx, canvas, state) {
  const W = canvas.width, H = canvas.height;
  const now = performance.now() / 1000;
  const camX = myPos.x * TILE - W / 2, camY = myPos.y * TILE - H / 2;
  const sx = wx => wx * TILE - camX, sy = wy => wy * TILE - camY;
  const phase = phaseOf(state.env.tod);

  // ---- terrain ----
  const x0 = Math.max(0, Math.floor(camX / TILE)), y0 = Math.max(0, Math.floor(camY / TILE));
  const x1 = Math.min(state.w - 1, Math.ceil((camX + W) / TILE)), y1 = Math.min(state.h - 1, Math.ceil((camY + H) / TILE));
  ctx.fillStyle = '#06090d'; ctx.fillRect(0, 0, W, H);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const t = state.tiles[y * state.w + x];
      const h = hash(x, y);
      const px = x * TILE - camX, py = y * TILE - camY;
      ctx.fillStyle = tileColor(TILE_INFO[t].color, h * 0.55 + 0.22);
      ctx.fillRect(px, py, TILE + 1, TILE + 1);
      drawDecor(ctx, t, h, px, py, now, state.env.season);
    }

  // ---- build ghost ----
  if (state.buildSel) {
    const [tx, ty] = mouseTile();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#7fd4ef';
    ctx.fillRect(sx(tx), sy(ty), TILE, TILE);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#fff'; ctx.setLineDash([5, 4]);
    ctx.strokeRect(sx(tx), sy(ty), TILE, TILE);
    ctx.setLineDash([]);
    ctx.font = '22px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(STRUCTURES[state.buildSel]?.emoji || '', sx(tx) + TILE / 2, sy(ty) + TILE / 2 + 8);
  }

  // ---- objects + entities, painter-sorted by y ----
  const drawables = [];
  for (const o of state.objects.values())
    if (o.x >= x0 - 2 && o.x <= x1 + 2 && o.y >= y0 - 2 && o.y <= y1 + 2)
      drawables.push({ y: o.y + 0.99, obj: o });
  for (const e of lerpedEnts()) drawables.push({ y: e.y + (e.k === 'p' ? 0.32 : 0.2), ent: e });
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) {
    if (d.obj) drawObject(ctx, d.obj, sx(d.obj.x + 0.5), sy(d.obj.y + 0.5), state, now);
    else if (d.ent.k === 'c') drawCreature(ctx, d.ent, sx(d.ent.x), sy(d.ent.y), now);
    else drawPlayer(ctx, d.ent, sx(d.ent.x), sy(d.ent.y), state, now);
  }

  // ---- particles ----
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= 1 / 60; p.x += p.vx / 60; p.y += p.vy / 60;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    ctx.globalAlpha = p.life / p.max;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), p.size, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ---- darkness & light ----
  const darkness = nightAlpha(state.env.tod);
  if (darkness > 0.02) {
    if (lightCv.width !== W || lightCv.height !== H) { lightCv.width = W; lightCv.height = H; }
    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, W, H);
    lctx.fillStyle = `rgba(6,9,22,${darkness})`;
    lctx.fillRect(0, 0, W, H);
    lctx.globalCompositeOperation = 'destination-out';
    const flick = 1 + Math.sin(now * 11) * 0.04 + Math.sin(now * 23) * 0.03;
    for (const o of state.objects.values()) {
      if (o.ty === 'campfire' && o.lit) light(lctx, sx(o.x + 0.5), sy(o.y + 0.5), TILE * 6 * flick, 1);
      if (o.ty === 'wormhole') light(lctx, sx(o.x + 0.5), sy(o.y + 0.5), TILE * 5.5, 0.95);
      if (o.ty === 'crystal_node' && o.ready !== false) light(lctx, sx(o.x + 0.5), sy(o.y + 0.5), TILE * 1.6, 0.55);
      if (o.ty === 'glowshroom' && o.ready !== false) light(lctx, sx(o.x + 0.5), sy(o.y + 0.5), TILE * 1.8, 0.6);
    }
    for (const e of lerpedEnts()) {
      if (e.k === 'p' && !e.d) light(lctx, sx(e.x), sy(e.y), e.h === 'torch' ? TILE * 5.5 * flick : TILE * 1.8, e.h === 'torch' ? 1 : 0.65);
      if (e.k === 'c' && e.sp === 'crystal_wisp') light(lctx, sx(e.x), sy(e.y), TILE * 2.2, 0.75);
    }
    lctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(lightCv, 0, 0);
    // warm glow over fires
    for (const o of state.objects.values())
      if (o.ty === 'campfire' && o.lit) {
        const g = ctx.createRadialGradient(sx(o.x + 0.5), sy(o.y + 0.5), 0, sx(o.x + 0.5), sy(o.y + 0.5), TILE * 4);
        g.addColorStop(0, `rgba(255,150,50,${0.15 * darkness})`); g.addColorStop(1, 'rgba(255,150,50,0)');
        ctx.fillStyle = g;
        ctx.fillRect(sx(o.x + 0.5) - TILE * 4, sy(o.y + 0.5) - TILE * 4, TILE * 8, TILE * 8);
      }
  }
  // dusk / dawn warm grading
  if (phase === 'dusk') {
    ctx.fillStyle = 'rgba(230,120,40,0.10)'; ctx.fillRect(0, 0, W, H);
  } else if (state.env.tod > 0.20 && state.env.tod < 0.27) {
    ctx.fillStyle = 'rgba(255,180,110,0.08)'; ctx.fillRect(0, 0, W, H);
  }
  // season tint
  const tint = ['rgba(140,220,140,0.03)', 'rgba(255,210,120,0.05)', 'rgba(210,130,60,0.07)', 'rgba(190,215,255,0.14)'][state.env.season];
  ctx.fillStyle = tint; ctx.fillRect(0, 0, W, H);

  // ---- minimap ----
  if (miniDone) {
    const m = miniEl.getContext('2d');
    m.globalAlpha = 1;
    m.drawImage(mini, 0, 0, 150, 150);
    if (darkness > 0.05) { m.fillStyle = `rgba(5,8,18,${darkness * 0.5})`; m.fillRect(0, 0, 150, 150); }
    m.fillStyle = '#7fd4ef';
    const wh = state.wormhole;
    m.fillRect(wh.x / state.w * 150 - 2, wh.y / state.h * 150 - 2, 4, 4);
    for (const e of lerpedEnts()) if (e.k === 'p' && !e.d) {
      m.fillStyle = e.id === state.id ? '#fff' : '#ffd27f';
      m.fillRect(e.x / state.w * 150 - 2, e.y / state.h * 150 - 2, 4, 4);
    }
  }
}

// ---------- terrain decoration ----------
function drawDecor(ctx, t, h, px, py, now, season) {
  const winter = season === 3;
  if (winter && t >= T.SAND) {
    ctx.fillStyle = 'rgba(225,238,255,0.30)';
    ctx.fillRect(px, py, TILE + 1, TILE + 1);
  }
  if (t === T.GRASS || t === T.MEADOW) {
    if (h < 0.30) { // grass blades
      const gx = px + h * 90 % TILE, gy = py + (h * 53) % TILE;
      ctx.strokeStyle = t === T.GRASS ? 'rgba(60,90,40,.5)' : 'rgba(70,55,110,.5)';
      ctx.lineWidth = 1.4;
      const sway = Math.sin(now * 1.3 + h * 40) * 1.5;
      ctx.beginPath();
      ctx.moveTo(gx, gy + 6); ctx.quadraticCurveTo(gx + sway, gy, gx + sway + 1, gy - 4);
      ctx.moveTo(gx + 4, gy + 6); ctx.quadraticCurveTo(gx + 4 + sway, gy + 1, gx + 5 + sway, gy - 3);
      ctx.stroke();
    }
  } else if (t === T.SPORE && h < 0.22) { // drifting spore motes
    const mx = px + (h * 97) % TILE, my = py + (h * 61) % TILE + Math.sin(now * 0.7 + h * 30) * 4;
    ctx.fillStyle = `rgba(140,230,190,${0.25 + Math.sin(now + h * 20) * 0.15})`;
    ctx.beginPath(); ctx.arc(mx, my, 1.6, 0, TAU); ctx.fill();
  } else if (t === T.CRYSTAL && h < 0.16) { // glints
    const gl = Math.max(0, Math.sin(now * 1.8 + h * 50));
    ctx.fillStyle = `rgba(200,240,255,${gl * 0.45})`;
    const gx = px + (h * 83) % TILE, gy = py + (h * 47) % TILE;
    ctx.fillRect(gx - 2.5, gy - 0.5, 5, 1); ctx.fillRect(gx - 0.5, gy - 2.5, 1, 5);
  } else if (t === T.ROCK && h < 0.2) {
    ctx.strokeStyle = 'rgba(50,50,55,.4)';
    ctx.beginPath(); ctx.moveTo(px + h * 30, py + 8); ctx.lineTo(px + h * 30 + 8, py + 12); ctx.stroke();
  } else if (t === T.MARSH && h < 0.25) {
    ctx.fillStyle = 'rgba(30,45,25,.4)';
    ctx.beginPath(); ctx.ellipse(px + 20, py + 20, 9, 5, 0, 0, TAU); ctx.fill();
  } else if ((t === T.WATER || t === T.DEEP) && h < 0.3) { // shimmer
    const a = 0.10 + Math.max(0, Math.sin(now * 1.1 + h * 60)) * 0.16;
    ctx.strokeStyle = `rgba(220,240,255,${a})`;
    ctx.lineWidth = 1.3;
    const wy2 = py + (h * 71) % TILE;
    ctx.beginPath(); ctx.moveTo(px + 6, wy2); ctx.quadraticCurveTo(px + 13, wy2 - 2.5, px + 20, wy2); ctx.stroke();
  } else if (t === T.SAND && h < 0.14) {
    ctx.fillStyle = 'rgba(120,100,60,.5)';
    ctx.fillRect(px + (h * 87) % TILE, py + (h * 43) % TILE, 2, 2);
  }
}

function nightAlpha(tod) {
  const d = Math.cos(tod * TAU) * 0.5 + 0.5; // 1 at midnight, 0 at noon
  return Math.max(0, d - 0.22) * 1.06;
}

function light(ctx, x, y, r, strength) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(0,0,0,${Math.min(1, strength + 0.1)})`);
  g.addColorStop(0.65, `rgba(0,0,0,${Math.min(1, strength * 0.6)})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

// ---------- objects ----------
function drawObject(ctx, o, px, py, state, now) {
  const r = RESOURCES[o.ty];
  const h = hash(o.x, o.y);
  if (r) {
    ctx.globalAlpha = o.ready === false ? 0.30 : 1;
    if (o.ty === 'tree') {
      const sway = Math.sin(now * 0.8 + h * 20) * 1.6;
      shadow(ctx, px, py + 8, 13, 5);
      ctx.fillStyle = '#54422e';
      ctx.fillRect(px - 3, py - 4, 6, 13);
      for (const [dx, dy, rr, c] of [[-6, -12, 10, '#33613c'], [7, -10, 9, '#3c6f45'], [0, -19, 11, '#478252']]) {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(px + dx + sway, py + dy, rr, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = 'rgba(160,120,220,.5)'; // violet fronds — alien flora
      ctx.beginPath(); ctx.arc(px + sway + 4, py - 22, 3.2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(px + sway - 7, py - 16, 2.6, 0, TAU); ctx.fill();
    } else if (o.ty === 'boulder' || o.ty === 'debris') {
      shadow(ctx, px, py + 8, 13, 5);
      ctx.fillStyle = o.ty === 'debris' ? '#8a6a3a' : '#87878e';
      ctx.beginPath();
      ctx.moveTo(px - 12, py + 8); ctx.lineTo(px - 7, py - 8); ctx.lineTo(px + 3, py - 11);
      ctx.lineTo(px + 11, py - 3); ctx.lineTo(px + 12, py + 8);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = o.ty === 'debris' ? '#d29a45' : '#a2a2ab';
      ctx.beginPath(); ctx.moveTo(px - 7, py - 8); ctx.lineTo(px + 3, py - 11); ctx.lineTo(px + 5, py - 2); ctx.lineTo(px - 4, py + 1); ctx.closePath(); ctx.fill();
      if (o.ty === 'debris') { // blinking salvage beacon
        ctx.fillStyle = `rgba(255,120,60,${0.4 + Math.sin(now * 3 + h * 9) * 0.4})`;
        ctx.beginPath(); ctx.arc(px + 6, py - 8, 2.2, 0, TAU); ctx.fill();
      }
    } else if (o.ty === 'crystal_node') {
      shadow(ctx, px, py + 8, 11, 4);
      const glow = 0.5 + Math.sin(now * 1.5 + h * 10) * 0.3;
      ctx.fillStyle = `rgba(140,220,245,${0.25 * glow})`;
      ctx.beginPath(); ctx.arc(px, py - 2, 16, 0, TAU); ctx.fill();
      for (const [dx, s] of [[-6, 0.7], [0, 1], [7, 0.6]]) {
        ctx.fillStyle = '#8fdcf5';
        ctx.beginPath();
        ctx.moveTo(px + dx, py - 14 * s); ctx.lineTo(px + dx + 5 * s, py + 6);
        ctx.lineTo(px + dx - 5 * s, py + 6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.5)';
        ctx.beginPath(); ctx.moveTo(px + dx, py - 14 * s); ctx.lineTo(px + dx + 1.7, py + 4); ctx.lineTo(px + dx - 1, py + 4); ctx.closePath(); ctx.fill();
      }
    } else if (o.ty === 'fiber_plant') {
      ctx.strokeStyle = '#b3cf79'; ctx.lineWidth = 2;
      const sway = Math.sin(now * 1.1 + h * 25) * 2;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(px + i * 3, py + 8);
        ctx.quadraticCurveTo(px + i * 4 + sway, py - 4, px + i * 5 + sway, py - 12 + Math.abs(i) * 3);
        ctx.stroke();
      }
    } else if (o.ty === 'pulse_bush') {
      shadow(ctx, px, py + 7, 10, 4);
      ctx.fillStyle = '#3f6b47';
      ctx.beginPath(); ctx.arc(px, py - 2, 10, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(px - 7, py + 2, 7, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(px + 7, py + 2, 7, 0, TAU); ctx.fill();
      if (o.ready !== false) {
        const pulse = 0.7 + Math.sin(now * 2.4 + h * 12) * 0.3; // the fruit pulses — hence the name
        ctx.fillStyle = `rgba(230,90,160,${pulse})`;
        for (const [dx, dy] of [[-5, -4], [3, -7], [6, 0], [-1, 1]]) {
          ctx.beginPath(); ctx.arc(px + dx, py + dy, 2.6, 0, TAU); ctx.fill();
        }
      }
    } else if (o.ty === 'glowshroom') {
      const glow = 0.55 + Math.sin(now * 1.7 + h * 14) * 0.25;
      ctx.fillStyle = `rgba(120,230,185,${0.22 * glow})`;
      ctx.beginPath(); ctx.arc(px, py, 15, 0, TAU); ctx.fill();
      for (const [dx, dy, s] of [[-6, 2, 1], [4, -2, 1.25], [7, 5, 0.7]]) {
        ctx.fillStyle = '#d8d2c0';
        ctx.fillRect(px + dx - 1.5 * s, py + dy - 2, 3 * s, 6);
        ctx.fillStyle = `rgba(110,225,180,${glow})`;
        ctx.beginPath(); ctx.arc(px + dx, py + dy - 3, 5 * s, Math.PI, 0); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    return;
  }

  const s = STRUCTURES[o.ty];
  if (s) { drawStructure(ctx, o, px, py, now, h); return; }

  if (o.ty === 'wormhole') {
    const t = now * 1.2;
    shadow(ctx, px, py + 10, 18, 6);
    for (let i = 4; i > 0; i--) {
      ctx.strokeStyle = `rgba(127,212,239,${0.14 * i})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 7]);
      ctx.lineDashOffset = t * 14 * (i % 2 ? 1 : -1);
      ctx.beginPath(); ctx.arc(px, py, 9 + i * 7 + Math.sin(t + i) * 2.5, 0, TAU); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.lineWidth = 1;
    const g = ctx.createRadialGradient(px, py, 0, px, py, 12);
    g.addColorStop(0, state.team?.win ? '#d9f6ff' : '#0a1a28');
    g.addColorStop(1, '#2a6a8a');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(px, py, 10, 0, TAU); ctx.fill();
    for (let k = 0; k < 3; k++) { // orbiting motes
      const a = t * (0.8 + k * 0.3) + k * 2.1;
      ctx.fillStyle = 'rgba(180,235,255,.8)';
      ctx.beginPath(); ctx.arc(px + Math.cos(a) * (16 + k * 6), py + Math.sin(a) * (16 + k * 6) * 0.5, 1.8, 0, TAU); ctx.fill();
    }
    return;
  }
  if (o.ty === 'bag') {
    shadow(ctx, px, py + 5, 8, 3);
    ctx.fillStyle = '#a8834f';
    ctx.beginPath(); ctx.arc(px, py, 7, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#6a5232'; ctx.stroke();
    ctx.fillStyle = '#6a5232';
    ctx.fillRect(px - 3, py - 9, 6, 4);
    ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('❕', px, py - 12);
  }
}

function drawStructure(ctx, o, px, py, now, h) {
  switch (o.ty) {
    case 'campfire': {
      shadow(ctx, px, py + 7, 12, 4);
      ctx.strokeStyle = '#54422e'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(px - 8, py + 6); ctx.lineTo(px + 8, py + 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px - 8, py + 2); ctx.lineTo(px + 8, py + 6); ctx.stroke();
      ctx.lineWidth = 1;
      if (o.lit) {
        const f = Math.sin(now * 9 + h * 9) * 2 + Math.sin(now * 17) * 1.2;
        for (const [c, sc] of [['#e85c2a', 1], ['#f2a03c', 0.65], ['#ffe08a', 0.35]]) {
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.moveTo(px - 7 * sc, py + 3);
          ctx.quadraticCurveTo(px - 4 * sc + f * sc, py - 8 * sc, px + f * sc, py - 15 * sc - f);
          ctx.quadraticCurveTo(px + 4 * sc + f * sc, py - 8 * sc, px + 7 * sc, py + 3);
          ctx.closePath(); ctx.fill();
        }
        if (Math.random() < 0.25) spark(o.x + 0.5 + (Math.random() - 0.5) * 0.3, o.y + 0.4, (Math.random() - 0.5) * 0.3, -0.7 - Math.random() * 0.5, 0.9, '#ffcf6a', 1.5);
      } else {
        ctx.fillStyle = '#3a3a3a';
        ctx.beginPath(); ctx.arc(px, py, 5, 0, TAU); ctx.fill();
      }
      break;
    }
    case 'wall':
      ctx.fillStyle = '#7a6142'; ctx.fillRect(px - 19, py - 19, 38, 38);
      ctx.strokeStyle = '#54422e'; ctx.lineWidth = 2; ctx.strokeRect(px - 19, py - 19, 38, 38);
      ctx.beginPath(); ctx.moveTo(px - 19, py - 6); ctx.lineTo(px + 19, py - 6);
      ctx.moveTo(px - 19, py + 7); ctx.lineTo(px + 19, py + 7);
      ctx.moveTo(px - 6, py - 19); ctx.lineTo(px - 6, py - 6);
      ctx.moveTo(px + 6, py - 6); ctx.lineTo(px + 6, py + 7);
      ctx.moveTo(px - 6, py + 7); ctx.lineTo(px - 6, py + 19);
      ctx.stroke(); ctx.lineWidth = 1;
      break;
    case 'door':
      ctx.fillStyle = o.open ? 'rgba(58,47,34,.45)' : '#9a7a4a';
      ctx.fillRect(px - 19, py - 19, 38, 38);
      ctx.strokeStyle = '#c9a86a'; ctx.lineWidth = 2;
      ctx.strokeRect(px - 14, py - 14, 28, 28);
      if (!o.open) { ctx.fillStyle = '#54422e'; ctx.beginPath(); ctx.arc(px + 8, py, 2.5, 0, TAU); ctx.fill(); }
      ctx.lineWidth = 1;
      break;
    case 'crate':
      shadow(ctx, px, py + 12, 14, 5);
      ctx.fillStyle = '#8a6a3a'; ctx.fillRect(px - 13, py - 11, 26, 24);
      ctx.strokeStyle = '#c9a86a'; ctx.lineWidth = 2; ctx.strokeRect(px - 13, py - 11, 26, 24);
      ctx.beginPath(); ctx.moveTo(px - 13, py - 11); ctx.lineTo(px + 13, py + 13);
      ctx.moveTo(px + 13, py - 11); ctx.lineTo(px - 13, py + 13); ctx.stroke(); ctx.lineWidth = 1;
      break;
    case 'bench':
      shadow(ctx, px, py + 11, 16, 5);
      ctx.fillStyle = '#54422e'; ctx.fillRect(px - 14, py - 2, 4, 12); ctx.fillRect(px + 10, py - 2, 4, 12);
      ctx.fillStyle = '#4a6a8a'; ctx.fillRect(px - 16, py - 10, 32, 10);
      ctx.fillStyle = '#7fd4ef'; ctx.fillRect(px - 6, py - 8, 8, 5);
      ctx.fillStyle = `rgba(127,212,239,${0.4 + Math.sin(now * 2.4) * 0.3})`;
      ctx.beginPath(); ctx.arc(px + 9, py - 13, 2.5, 0, TAU); ctx.fill();
      break;
    case 'cookpot': {
      shadow(ctx, px, py + 10, 13, 5);
      ctx.fillStyle = '#3c3c42';
      ctx.beginPath(); ctx.ellipse(px, py, 12, 9, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2a2a30';
      ctx.beginPath(); ctx.ellipse(px, py - 5, 10, 4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#7a5a3a';
      ctx.beginPath(); ctx.ellipse(px, py - 5, 8, 3, 0, 0, TAU); ctx.fill();
      const b = now * 3 + h * 9; // bubbles
      ctx.fillStyle = 'rgba(240,220,180,.8)';
      ctx.beginPath(); ctx.arc(px - 4 + Math.sin(b) * 2, py - 5, 1.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(px + 3, py - 6 + Math.sin(b * 1.4) * 1.5, 1.1, 0, TAU); ctx.fill();
      break;
    }
    case 'bed':
      shadow(ctx, px, py + 13, 13, 5);
      ctx.fillStyle = '#54422e'; ctx.fillRect(px - 11, py - 15, 22, 30);
      ctx.fillStyle = '#6a5a7a'; ctx.fillRect(px - 9, py - 13, 18, 26);
      ctx.fillStyle = '#d8d2c0'; ctx.fillRect(px - 9, py - 13, 18, 8);
      break;
    case 'condenser': {
      shadow(ctx, px, py + 10, 11, 4);
      ctx.fillStyle = '#4a7a8a';
      ctx.beginPath(); ctx.moveTo(px - 10, py + 8); ctx.lineTo(px - 6, py - 8); ctx.lineTo(px + 6, py - 8); ctx.lineTo(px + 10, py + 8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = `rgba(160,225,240,${0.5 + Math.sin(now * 1.5) * 0.3})`;
      ctx.beginPath(); ctx.arc(px, py - 1, 4.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(200,240,255,.5)';
      ctx.beginPath(); ctx.arc(px, py - 12 + Math.sin(now * 2) * 2, 2, 0, TAU); ctx.stroke();
      break;
    }
  }
}

// ---------- creatures ----------
function drawCreature(ctx, e, px, py, now) {
  const def = CREATURES[e.sp];
  const R = def.r * TILE;
  const wob = Math.sin(now * 6 + e.id) * 1.5;

  if (e.sp === 'phantasm') { // translucent horror, no shadow
    const wobble = Math.sin(now * 3 + e.id) * 3;
    ctx.globalAlpha = 0.62 + Math.sin(now * 2.2 + e.id) * 0.18;
    ctx.fillStyle = '#181226';
    ctx.beginPath();
    ctx.moveTo(px - R, py + R * 0.7);
    ctx.quadraticCurveTo(px - R * 1.3 + wobble, py - R, px, py - R * 1.5 + wobble);
    ctx.quadraticCurveTo(px + R * 1.3 - wobble, py - R, px + R, py + R * 0.7);
    ctx.quadraticCurveTo(px, py + R * 0.3, px - R, py + R * 0.7);
    ctx.fill();
    ctx.fillStyle = '#cfd6ff';
    ctx.beginPath(); ctx.arc(px - 4, py - 6 + wobble * 0.4, 2.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(px + 5, py - 5 + wobble * 0.4, 1.7, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    hpBar(ctx, e, def, px, py, R);
    return;
  }

  shadow(ctx, px, py + R * 0.8, R, R * 0.4);

  if (e.sp === 'crystal_wisp') {
    const glow = 0.5 + Math.sin(now * 3 + e.id) * 0.3;
    ctx.fillStyle = `rgba(160,230,245,${0.25 * glow})`;
    ctx.beginPath(); ctx.arc(px, py, R * 1.8, 0, TAU); ctx.fill();
    ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.arc(px, py + wob * 0.5, R, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(px - 2, py - 2 + wob * 0.5, R * 0.35, 0, TAU); ctx.fill();
    return;
  }

  if (e.sp === 'spinehound') {
    ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.ellipse(px, py, R * 1.25, R * 0.85, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#7a2c24'; // spines
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(px + i * 5 - 3, py - R * 0.5);
      ctx.lineTo(px + i * 5, py - R * 1.5 - Math.abs(Math.sin(now * 8 + i)) * 2);
      ctx.lineTo(px + i * 5 + 3, py - R * 0.5);
      ctx.closePath(); ctx.fill();
    }
    eyes(ctx, px, py - 2, 5, '#ffd27f', 2);
    return;
  }
  if (e.sp === 'grazer') {
    ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.ellipse(px, py, R * 1.15, R * 0.85, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(px + R * 0.9, py - R * 0.5, R * 0.45, 0, TAU); ctx.fill(); // head
    ctx.strokeStyle = '#d8cfe8'; ctx.lineWidth = 2; // antler stalks
    ctx.beginPath(); ctx.moveTo(px + R * 0.9, py - R * 0.85); ctx.lineTo(px + R * 1.1, py - R * 1.5);
    ctx.moveTo(px + R * 0.75, py - R * 0.85); ctx.lineTo(px + R * 0.6, py - R * 1.45); ctx.stroke();
    ctx.lineWidth = 1;
    eyes(ctx, px + R * 0.9, py - R * 0.5, 3, '#2a2438', 1.4);
    return;
  }
  if (e.sp === 'marsh_lurker') {
    ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.ellipse(px, py, R * 1.3, R * 0.7, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3e6a42';
    for (let i = -1; i <= 1; i++) { // back ridges
      ctx.beginPath(); ctx.moveTo(px + i * 8 - 4, py - R * 0.4); ctx.lineTo(px + i * 8, py - R * 0.95); ctx.lineTo(px + i * 8 + 4, py - R * 0.4); ctx.closePath(); ctx.fill();
    }
    eyes(ctx, px, py - 3, 6, '#e8e15a', 2);
    return;
  }
  // skitterling
  ctx.strokeStyle = '#8a7a3a'; ctx.lineWidth = 1.5; // legs
  for (let i = -1; i <= 1; i++) {
    const lp = Math.sin(now * 12 + i * 2 + e.id) * 3;
    ctx.beginPath(); ctx.moveTo(px - R, py + i * 3); ctx.lineTo(px - R - 5, py + i * 4 + lp); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px + R, py + i * 3); ctx.lineTo(px + R + 5, py + i * 4 - lp); ctx.stroke();
  }
  ctx.lineWidth = 1;
  ctx.fillStyle = def.color;
  ctx.beginPath(); ctx.ellipse(px, py + wob * 0.3, R * 1.1, R * 0.8, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#a89448';
  ctx.beginPath(); ctx.moveTo(px - 2, py - R * 0.6); ctx.lineTo(px - 5, py - R * 1.4);
  ctx.moveTo(px + 2, py - R * 0.6); ctx.lineTo(px + 5, py - R * 1.4); ctx.stroke(); // antennae
  eyes(ctx, px, py, 4, '#2a2438', 1.3);
  hpBar(ctx, e, def, px, py, R);
}
function eyes(ctx, px, py, gap, color, r) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(px - gap / 2, py, r, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(px + gap / 2, py, r, 0, TAU); ctx.fill();
}
function hpBar(ctx, e, def, px, py, R) {
  if (e.hp >= def.hp) return;
  ctx.fillStyle = 'rgba(20,5,5,.75)'; ctx.fillRect(px - 13, py - R - 11, 26, 4);
  ctx.fillStyle = '#e04a3a'; ctx.fillRect(px - 12, py - R - 10, 24 * Math.max(0, e.hp) / def.hp, 2);
}

// ---------- players ----------
function drawPlayer(ctx, e, px, py, state, now) {
  const me = e.id === state.id;
  if (e.d) { // ghost drifting over the body site
    const bob = Math.sin(now * 2 + e.id) * 3;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#dfe8f2';
    ctx.beginPath();
    ctx.arc(px, py - 8 + bob, 9, Math.PI, 0);
    ctx.quadraticCurveTo(px + 9, py + 6 + bob, px + 5, py + 4 + bob);
    ctx.quadraticCurveTo(px + 2, py + 7 + bob, px - 2, py + 4 + bob);
    ctx.quadraticCurveTo(px - 5, py + 7 + bob, px - 9, py + 4 + bob);
    ctx.quadraticCurveTo(px - 9, py - 4 + bob, px - 9, py - 8 + bob);
    ctx.fill();
    ctx.fillStyle = '#5a6a7a';
    ctx.beginPath(); ctx.arc(px - 3, py - 9 + bob, 1.6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(px + 3, py - 9 + bob, 1.6, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }
  shadow(ctx, px, py + 12, 10, 4);
  const a = me ? state.aim : e.a;
  const bob = Math.sin(now * 9 + e.id) * ((e.x !== e._lx || e.y !== e._ly) ? 1 : 0);

  // body: field suit
  ctx.fillStyle = e.f ? '#ff6a5a' : me ? '#d8955a' : '#5a8ad8';
  ctx.beginPath(); ctx.ellipse(px, py + 3 + bob, 8, 10, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(20,15,10,.5)'; ctx.stroke();
  // backpack
  ctx.fillStyle = '#6a5232';
  ctx.beginPath(); ctx.ellipse(px - Math.cos(a) * 6, py + 2 - Math.sin(a) * 3 + bob, 4.5, 6, 0, 0, TAU); ctx.fill();
  // head + visor
  ctx.fillStyle = '#e8cfa8';
  ctx.beginPath(); ctx.arc(px, py - 9 + bob, 7, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(20,15,10,.5)'; ctx.stroke();
  ctx.fillStyle = 'rgba(127,212,239,.85)'; // visor toward aim
  ctx.beginPath();
  ctx.arc(px + Math.cos(a) * 2.5, py - 9.5 + bob + Math.sin(a) * 1.2, 4, a - 1, a + 1);
  ctx.fill();
  // arm + held item
  const hx = px + Math.cos(a) * 13, hy = py - 1 + Math.sin(a) * 13;
  ctx.strokeStyle = '#c9a071'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(px + Math.cos(a) * 6, py + Math.sin(a) * 6); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.lineWidth = 1;
  if (e.h) {
    ctx.font = '15px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(ITEMS[e.h]?.emoji || '', hx + Math.cos(a) * 5, hy + Math.sin(a) * 5 + 5);
  }
  // sleeping
  if (e.sl) {
    ctx.font = '13px sans-serif'; ctx.fillStyle = '#cfd6ff'; ctx.textAlign = 'center';
    ctx.fillText('💤', px + 10, py - 18 + Math.sin(now * 1.5) * 2);
  }
  // name + hp
  ctx.font = "12px 'Segoe Print','Comic Sans MS',cursive"; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(10,8,5,.7)';
  ctx.fillText(e.n, px + 1, py - 21);
  ctx.fillStyle = me ? '#ffe9b8' : '#d8e8f8';
  ctx.fillText(e.n, px, py - 22);
  ctx.fillStyle = 'rgba(20,5,5,.75)'; ctx.fillRect(px - 13, py - 19, 26, 4);
  ctx.fillStyle = '#6ac95a'; ctx.fillRect(px - 12, py - 18, 24 * Math.max(0, e.hp) / 100, 2);
  e._lx = e.x; e._ly = e.y;
}
