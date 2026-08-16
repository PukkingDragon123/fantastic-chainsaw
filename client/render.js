// Canvas renderer. Everything is a placeholder shape (circles/rects) — real art later.
import { TILE, TILE_INFO, T, RESOURCES, STRUCTURES, CREATURES } from '/shared/defs.js';
import { lerpedEnts, myPos, mouseTile } from '/main.js';

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

const SEASON_TINT = ['rgba(120,200,120,0)', 'rgba(255,210,120,0.05)', 'rgba(200,120,60,0.08)', 'rgba(190,215,255,0.16)'];

export function render(ctx, canvas, state) {
  const W = canvas.width, H = canvas.height;
  const camX = myPos.x * TILE - W / 2, camY = myPos.y * TILE - H / 2;

  // ---- terrain ----
  const x0 = Math.max(0, Math.floor(camX / TILE)), y0 = Math.max(0, Math.floor(camY / TILE));
  const x1 = Math.min(state.w - 1, Math.ceil((camX + W) / TILE)), y1 = Math.min(state.h - 1, Math.ceil((camY + H) / TILE));
  ctx.fillStyle = '#05080c'; ctx.fillRect(0, 0, W, H);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const t = state.tiles[y * state.w + x];
      ctx.fillStyle = TILE_INFO[t].color;
      ctx.fillRect(x * TILE - camX, y * TILE - camY, TILE + 1, TILE + 1);
      // winter frosting on land
      if (state.env.season === 3 && t >= T.SAND) {
        ctx.fillStyle = 'rgba(220,235,255,0.28)';
        ctx.fillRect(x * TILE - camX, y * TILE - camY, TILE + 1, TILE + 1);
      }
    }

  const sx = wx => wx * TILE - camX, sy = wy => wy * TILE - camY;

  // ---- objects ----
  for (const o of state.objects.values()) {
    if (o.x < x0 - 1 || o.x > x1 + 1 || o.y < y0 - 1 || o.y > y1 + 1) continue;
    const px = sx(o.x + 0.5), py = sy(o.y + 0.5);
    drawObject(ctx, o, px, py, state);
  }

  // ---- build ghost ----
  if (state.buildSel) {
    const [tx, ty] = mouseTile();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#7fd4ef';
    ctx.fillRect(sx(tx), sy(ty), TILE, TILE);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(sx(tx), sy(ty), TILE, TILE);
  }

  // ---- entities ----
  for (const e of lerpedEnts()) {
    const px = sx(e.x), py = sy(e.y);
    if (e.k === 'c') drawCreature(ctx, e, px, py);
    else drawPlayer(ctx, e, px, py, state);
  }

  // ---- darkness & lights ----
  const darkness = nightAlpha(state.env.tod);
  if (darkness > 0.02) {
    ctx.fillStyle = `rgba(4,8,18,${darkness})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'destination-out';
    for (const o of state.objects.values()) {
      if (o.ty === 'campfire' && o.lit) light(ctx, sx(o.x + 0.5), sy(o.y + 0.5), TILE * 6, darkness);
      if (o.ty === 'wormhole') light(ctx, sx(o.x + 0.5), sy(o.y + 0.5), TILE * 5, darkness * 0.8);
    }
    for (const e of lerpedEnts())
      if (e.k === 'p' && !e.d) light(ctx, sx(e.x), sy(e.y), e.h === 'torch' ? TILE * 5.5 : TILE * 2.2, darkness * (e.h === 'torch' ? 1 : 0.7));
    ctx.globalCompositeOperation = 'source-over';
  }
  // season tint
  ctx.fillStyle = SEASON_TINT[state.env.season];
  ctx.fillRect(0, 0, W, H);

  // ---- minimap ----
  if (miniDone) {
    const m = miniEl.getContext('2d');
    m.drawImage(mini, 0, 0, 150, 150);
    m.fillStyle = '#fff';
    m.fillRect(myPos.x / state.w * 150 - 2, myPos.y / state.h * 150 - 2, 4, 4);
    m.fillStyle = '#7fd4ef';
    const wh = state.wormhole;
    m.fillRect(wh.x / state.w * 150 - 2, wh.y / state.h * 150 - 2, 4, 4);
  }
}

function nightAlpha(tod) {
  // 0 at midday, up to .82 at midnight, smooth dawn/dusk
  const d = Math.cos(tod * Math.PI * 2) * 0.5 + 0.5; // 1 at midnight, 0 at noon
  return Math.max(0, d - 0.25) * 1.1;
}

function light(ctx, x, y, r, strength) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(0,0,0,${Math.min(1, strength + 0.1)})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
}

function drawObject(ctx, o, px, py, state) {
  const r = RESOURCES[o.ty];
  if (r) {
    ctx.globalAlpha = o.ready === false ? 0.28 : 1;
    ctx.fillStyle = r.color;
    if (o.ty === 'tree') {
      ctx.fillStyle = '#5a4632'; ctx.fillRect(px - 3, py - 2, 6, 10);
      ctx.fillStyle = r.color;
      ctx.beginPath(); ctx.arc(px, py - 8, 13, 0, 7); ctx.fill();
    } else if (o.ty === 'boulder' || o.ty === 'debris') {
      ctx.beginPath();
      ctx.moveTo(px - 11, py + 8); ctx.lineTo(px - 5, py - 9); ctx.lineTo(px + 8, py - 6); ctx.lineTo(px + 11, py + 8);
      ctx.closePath(); ctx.fill();
    } else if (o.ty === 'crystal_node') {
      ctx.beginPath(); ctx.moveTo(px, py - 12); ctx.lineTo(px + 8, py + 6); ctx.lineTo(px - 8, py + 6); ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(px, py, 8, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    return;
  }
  const s = STRUCTURES[o.ty];
  if (s) {
    switch (o.ty) {
      case 'campfire':
        ctx.fillStyle = '#5a4632'; ctx.fillRect(px - 8, py + 2, 16, 5);
        ctx.fillStyle = o.lit ? '#ff9a3a' : '#444';
        ctx.beginPath(); ctx.arc(px, py - 2, o.lit ? 7 + Math.sin(performance.now() / 90) * 1.5 : 5, 0, 7); ctx.fill();
        break;
      case 'wall': ctx.fillStyle = '#7a6142'; ctx.fillRect(px - 15, py - 15, 30, 30);
        ctx.strokeStyle = '#5a4632'; ctx.strokeRect(px - 15, py - 15, 30, 30); break;
      case 'door': ctx.fillStyle = o.open ? '#3a2f22' : '#9a7a4a'; ctx.fillRect(px - 15, py - 15, 30, 30);
        ctx.strokeStyle = '#c9a86a'; ctx.strokeRect(px - 12, py - 12, 24, 24); break;
      case 'crate': ctx.fillStyle = '#8a6a3a'; ctx.fillRect(px - 11, py - 11, 22, 22);
        ctx.strokeStyle = '#c9a86a'; ctx.strokeRect(px - 11, py - 11, 22, 22); break;
      case 'bench': ctx.fillStyle = '#4a6a8a'; ctx.fillRect(px - 13, py - 9, 26, 18);
        ctx.fillStyle = '#7fd4ef'; ctx.fillRect(px - 5, py - 5, 10, 6); break;
      case 'bed': ctx.fillStyle = '#6a5a7a'; ctx.fillRect(px - 9, py - 13, 18, 26);
        ctx.fillStyle = '#c9c9e0'; ctx.fillRect(px - 9, py - 13, 18, 8); break;
      case 'condenser': ctx.fillStyle = '#4a7a8a';
        ctx.beginPath(); ctx.arc(px, py, 10, 0, 7); ctx.fill();
        ctx.fillStyle = '#9adfef'; ctx.beginPath(); ctx.arc(px, py, 4, 0, 7); ctx.fill(); break;
    }
    return;
  }
  if (o.ty === 'wormhole') {
    const t = performance.now() / 600;
    for (let i = 3; i > 0; i--) {
      ctx.strokeStyle = `rgba(127,212,239,${0.25 * i})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(px, py, 10 + i * 7 + Math.sin(t + i) * 3, 0, 7); ctx.stroke();
    }
    ctx.lineWidth = 1;
    ctx.fillStyle = state.team?.win ? '#aef' : '#123';
    ctx.beginPath(); ctx.arc(px, py, 9, 0, 7); ctx.fill();
    return;
  }
  if (o.ty === 'bag') {
    ctx.fillStyle = '#c9a86a';
    ctx.beginPath(); ctx.arc(px, py, 6, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.stroke();
  }
}

function drawCreature(ctx, e, px, py) {
  const def = CREATURES[e.sp];
  ctx.fillStyle = def.color;
  ctx.beginPath(); ctx.arc(px, py, def.r * TILE, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.stroke();
  if (e.hp < def.hp) { // hp bar
    ctx.fillStyle = '#300'; ctx.fillRect(px - 12, py - def.r * TILE - 8, 24, 3);
    ctx.fillStyle = '#e33'; ctx.fillRect(px - 12, py - def.r * TILE - 8, 24 * e.hp / def.hp, 3);
  }
}

function drawPlayer(ctx, e, px, py, state) {
  if (e.d) { // dead marker
    ctx.strokeStyle = '#888'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px - 6, py - 6); ctx.lineTo(px + 6, py + 6);
    ctx.moveTo(px + 6, py - 6); ctx.lineTo(px - 6, py + 6); ctx.stroke(); ctx.lineWidth = 1;
    return;
  }
  const me = e.id === state.id;
  ctx.fillStyle = e.f ? '#ff6a5a' : me ? '#e8e4d8' : '#c9d8e8';
  ctx.beginPath(); ctx.arc(px, py, 11, 0, 7); ctx.fill();
  ctx.strokeStyle = me ? '#7fd4ef' : '#5a6a7a'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
  // facing / held tool
  const a = me ? state.aim : e.a;
  ctx.strokeStyle = e.h ? '#ffd27f' : '#9ab';
  ctx.beginPath(); ctx.moveTo(px + Math.cos(a) * 8, py + Math.sin(a) * 8);
  ctx.lineTo(px + Math.cos(a) * (e.h ? 18 : 13), py + Math.sin(a) * (e.h ? 18 : 13)); ctx.stroke();
  // name + hp
  ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = '#fff'; ctx.fillText(e.n, px, py - 18);
  ctx.fillStyle = '#300'; ctx.fillRect(px - 12, py - 16, 24, 3);
  ctx.fillStyle = '#5ac96a'; ctx.fillRect(px - 12, py - 16, 24 * e.hp / 100, 3);
}
