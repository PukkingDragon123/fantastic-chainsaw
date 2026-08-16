// Seeded procedural world generation: elevation + moisture + strangeness noise -> biomes,
// then per-biome resource object placement. Deterministic for a given seed.
import { T, WORLD_W, WORLD_H, RESOURCES } from '../shared/defs.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth value noise from a coarse random grid.
function makeNoise(rng, gridStep) {
  const gw = Math.ceil(WORLD_W / gridStep) + 2;
  const gh = Math.ceil(WORLD_H / gridStep) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const fade = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x / gridStep, gy = y / gridStep;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = fade(gx - x0), fy = fade(gy - y0);
    const v = (xx, yy) => g[yy * gw + xx];
    const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * fx;
    const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * fx;
    return a + (b - a) * fy;
  };
}

export function generateWorld(seed) {
  const rng = mulberry32(seed);
  const elev1 = makeNoise(rng, 24), elev2 = makeNoise(rng, 8);
  const moist = makeNoise(rng, 18);
  const strange = makeNoise(rng, 14);

  const tiles = new Uint8Array(WORLD_W * WORLD_H);
  const cx = WORLD_W / 2, cy = WORLD_H / 2;

  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      // island falloff so the map edge is ocean
      const dx = (x - cx) / cx, dy = (y - cy) / cy;
      const edge = Math.max(0, 1 - (dx * dx + dy * dy) * 1.15);
      const e = (elev1(x, y) * 0.7 + elev2(x, y) * 0.3) * edge;
      const m = moist(x, y);
      const s = strange(x, y);
      let t;
      if (e < 0.16) t = T.DEEP;
      else if (e < 0.24) t = T.WATER;
      else if (e < 0.29) t = T.SAND;
      else if (e > 0.62) t = s > 0.55 ? T.CRYSTAL : T.ROCK;
      else if (m > 0.68 && e < 0.42) t = T.MARSH;
      else if (m > 0.52 && s > 0.5) t = T.SPORE;
      else if (s > 0.58) t = T.MEADOW;
      else t = T.GRASS;
      tiles[y * WORLD_W + x] = t;
    }
  }

  // Flatten a landing zone around the wormhole at map center.
  const wx = Math.floor(cx), wy = Math.floor(cy);
  for (let y = wy - 6; y <= wy + 6; y++)
    for (let x = wx - 6; x <= wx + 6; x++)
      tiles[y * WORLD_W + x] = T.GRASS;

  // ---- resource object placement ----
  const objects = [];
  let nextId = 1;
  const occupied = new Set();
  const place = (ty, x, y) => {
    const key = x + ',' + y;
    if (occupied.has(key)) return;
    occupied.add(key);
    objects.push({ i: nextId++, ty, x, y, hp: RESOURCES[ty].hits, ready: true });
  };

  const density = {
    [T.GRASS]:   [['tree', 0.045], ['fiber_plant', 0.03], ['pulse_bush', 0.012], ['boulder', 0.008]],
    [T.MEADOW]:  [['tree', 0.03], ['pulse_bush', 0.03], ['fiber_plant', 0.025], ['glowshroom', 0.01]],
    [T.SPORE]:   [['tree', 0.09], ['glowshroom', 0.035], ['fiber_plant', 0.015]],
    [T.MARSH]:   [['glowshroom', 0.04], ['fiber_plant', 0.03]],
    [T.ROCK]:    [['boulder', 0.06], ['crystal_node', 0.008]],
    [T.CRYSTAL]: [['crystal_node', 0.05], ['boulder', 0.02]],
    [T.SAND]:    [['fiber_plant', 0.008]],
  };

  for (let y = 1; y < WORLD_H - 1; y++) {
    for (let x = 1; x < WORLD_W - 1; x++) {
      // keep the landing zone clear
      if (Math.abs(x - wx) <= 6 && Math.abs(y - wy) <= 6) continue;
      const list = density[tiles[y * WORLD_W + x]];
      if (!list) continue;
      const roll = rng();
      let acc = 0;
      for (const [ty, p] of list) {
        acc += p;
        if (roll < acc) { place(ty, x, y); break; }
      }
    }
  }

  // Wormhole debris fields: alloy comes only from scattered crash debris.
  for (let k = 0; k < 26; k++) {
    const ang = rng() * Math.PI * 2, dist = 15 + rng() * 70;
    const x = Math.round(wx + Math.cos(ang) * dist), y = Math.round(wy + Math.sin(ang) * dist);
    if (x < 1 || y < 1 || x >= WORLD_W - 1 || y >= WORLD_H - 1) continue;
    const t = tiles[y * WORLD_W + x];
    if (t === T.DEEP || t === T.WATER) continue;
    place('debris', x, y);
  }

  return { tiles, objects, nextId, wormhole: { x: wx, y: wy } };
}
