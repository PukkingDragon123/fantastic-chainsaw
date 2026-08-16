// Shared game definitions — used by both the Node server and the browser client.
// All visuals are placeholder shapes/colors; real assets come later.

export const TILE = 32;            // px per tile (client rendering)
export const WORLD_W = 200;        // tiles
export const WORLD_H = 200;
export const DAY_LENGTH = 480;     // real seconds per in-game day
export const DAYS_PER_SEASON = 6;
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const SEASON_TEMP = [12, 27, 8, -9];   // ambient base °C per season
export const TICK_RATE = 20;       // server sim Hz
export const SNAP_RATE = 10;       // snapshot Hz

// ---- terrain tiles ----
export const T = {
  DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, MEADOW: 4,
  SPORE: 5, MARSH: 6, ROCK: 7, CRYSTAL: 8,
};
export const TILE_INFO = {
  [T.DEEP]:    { name: 'Deep water',      color: '#0b2d4d', walk: false, water: true },
  [T.WATER]:   { name: 'Shallow water',   color: '#155d8a', walk: false, water: true },
  [T.SAND]:    { name: 'Ashen shore',     color: '#b8a06a', walk: true },
  [T.GRASS]:   { name: 'Pale sward',      color: '#6d8f4e', walk: true },
  [T.MEADOW]:  { name: 'Violet meadow',   color: '#7a6fa0', walk: true },
  [T.SPORE]:   { name: 'Spore forest',    color: '#3f5a45', walk: true, tempMod: 1, sporeRisk: true },
  [T.MARSH]:   { name: 'Breathing marsh', color: '#4a5d3a', walk: true, tempMod: 2, slow: 0.6, sporeRisk: true },
  [T.ROCK]:    { name: 'Grey barrens',    color: '#6f6f75', walk: true, tempMod: -2 },
  [T.CRYSTAL]: { name: 'Crystal flats',   color: '#5f7f95', walk: true, tempMod: -4 },
};

// ---- items ----
// food: hunger restored; water: thirst restored; heal: hp; sickRisk: chance of parasites on consume
// tool: {kind, dmg, uses}; equip: 'hand'|'body'; fuel: campfire seconds
export const ITEMS = {
  wood:         { name: 'Veilwood log',     stack: 20, fuel: 45 },
  stone:        { name: 'Stone',            stack: 20 },
  fiber:        { name: 'Silkgrass fiber',  stack: 30, fuel: 8 },
  crystal:      { name: 'Resonant crystal', stack: 20 },
  alloy:        { name: 'Alloy fragment',   stack: 20 },
  hide:         { name: 'Chitin hide',      stack: 20 },
  raw_meat:     { name: 'Raw meat',         stack: 10, food: 14, sickRisk: 0.35 },
  cooked_meat:  { name: 'Cooked meat',      stack: 10, food: 38 },
  pulse_fruit:  { name: 'Pulse-fruit',      stack: 15, food: 13, water: 6 },
  glow_spores:  { name: 'Glow spores',      stack: 20, food: 4 },
  remedy:       { name: 'Spore remedy',     stack: 5,  cure: true },
  bandage:      { name: 'Bandage',          stack: 10, bandage: true },
  flask_empty:  { name: 'Flask (empty)',    stack: 3 },
  flask_dirty:  { name: 'Flask (murky)',    stack: 3, water: 40, sickRisk: 0.25, toFlask: 'flask_empty' },
  flask_clean:  { name: 'Flask (purified)', stack: 3, water: 55, toFlask: 'flask_empty' },
  axe:          { name: 'Field axe',        stack: 1, tool: { kind: 'axe',  dmg: 10, uses: 60 }, equip: 'hand' },
  pickaxe:      { name: 'Geo pick',         stack: 1, tool: { kind: 'pick', dmg: 8,  uses: 60 }, equip: 'hand' },
  spear:        { name: 'Alloy spear',      stack: 1, tool: { kind: 'spear', dmg: 16, uses: 50 }, equip: 'hand' },
  torch:        { name: 'Spore torch',      stack: 1, tool: { kind: 'torch', dmg: 4, uses: 40 }, equip: 'hand', warm: 4 },
  coat:         { name: 'Chitin coat',      stack: 1, equip: 'body', warm: 9 },
  stabilizer_core: { name: 'Stabilizer core',    stack: 1, part: true },
  focus_lens:      { name: 'Focus lens array',   stack: 1, part: true },
  power_cell:      { name: 'Bio power cell',     stack: 1, part: true },
};

// ---- crafting recipes ----
// station: null (anywhere) | 'campfire' | 'bench'; tier: research tier required (1..3)
export const RECIPES = [
  { id: 'axe',        cost: { wood: 2, fiber: 2, stone: 1 }, tier: 1, station: null },
  { id: 'pickaxe',    cost: { wood: 2, fiber: 2, stone: 2 }, tier: 1, station: null },
  { id: 'spear',      cost: { wood: 2, fiber: 1, stone: 1 }, tier: 1, station: null },
  { id: 'torch',      cost: { wood: 1, fiber: 1, glow_spores: 1 }, tier: 1, station: null },
  { id: 'bandage',    cost: { fiber: 3 }, tier: 1, station: null },
  { id: 'flask_empty',cost: { fiber: 4, hide: 1 }, tier: 1, station: null },
  { id: 'remedy',     cost: { glow_spores: 2, pulse_fruit: 1 }, tier: 1, station: 'campfire' },
  { id: 'coat',       cost: { hide: 4, fiber: 6 }, tier: 2, station: 'bench' },
  { id: 'stabilizer_core', cost: { alloy: 4, crystal: 6 }, tier: 3, station: 'bench' },
  { id: 'focus_lens',      cost: { crystal: 8, stone: 4 }, tier: 3, station: 'bench' },
  { id: 'power_cell',      cost: { alloy: 5, crystal: 3, glow_spores: 6 }, tier: 3, station: 'bench' },
];

// ---- buildable structures ----
export const STRUCTURES = {
  campfire:  { name: 'Campfire',        cost: { wood: 5, stone: 3 },  tier: 1, block: false, hp: 50 },
  crate:     { name: 'Storage crate',   cost: { wood: 6, fiber: 2 },  tier: 1, block: true,  hp: 80 },
  bench:     { name: 'Research bench',  cost: { wood: 8, stone: 4, crystal: 2 }, tier: 1, block: true, hp: 100 },
  wall:      { name: 'Timber wall',     cost: { wood: 4 },            tier: 2, block: true,  hp: 200 },
  door:      { name: 'Timber door',     cost: { wood: 5, fiber: 1 },  tier: 2, block: true,  hp: 150, door: true },
  bed:       { name: 'Field cot',       cost: { wood: 4, fiber: 6, hide: 2 }, tier: 2, block: true, hp: 60 },
  condenser: { name: 'Dew condenser',   cost: { wood: 4, fiber: 4, stone: 2 }, tier: 2, block: true, hp: 80 },
};

// ---- creatures ----
// aggro: 0 = passive; retaliate: fights back when hit; night: only spawns at night
export const CREATURES = {
  skitterling: { name: 'Skitterling',   hp: 20, speed: 3.2, dmg: 0,  aggro: 0, flee: true,
    drops: [{ item: 'raw_meat', n: 1, p: 1 }, { item: 'hide', n: 1, p: 0.5 }],
    tiles: [T.GRASS, T.MEADOW], rp: 15, color: '#c9b458', r: 0.35 },
  grazer:      { name: 'Duskgrazer',    hp: 60, speed: 2.4, dmg: 8,  aggro: 0, retaliate: true,
    drops: [{ item: 'raw_meat', n: 2, p: 1 }, { item: 'hide', n: 2, p: 0.8 }],
    tiles: [T.MEADOW, T.GRASS], rp: 15, color: '#9a7bb5', r: 0.55 },
  spinehound:  { name: 'Spinehound',    hp: 45, speed: 4.2, dmg: 12, aggro: 8, night: true,
    drops: [{ item: 'raw_meat', n: 1, p: 1 }, { item: 'hide', n: 1, p: 0.6 }],
    tiles: [T.GRASS, T.MEADOW, T.SPORE, T.ROCK], rp: 20, color: '#b0453a', r: 0.45 },
  marsh_lurker:{ name: 'Marsh lurker',  hp: 70, speed: 3.0, dmg: 15, aggro: 5,
    drops: [{ item: 'raw_meat', n: 2, p: 1 }, { item: 'glow_spores', n: 2, p: 1 }],
    tiles: [T.MARSH], rp: 20, color: '#4f7a52', r: 0.55 },
  crystal_wisp:{ name: 'Crystal wisp',  hp: 30, speed: 4.6, dmg: 0,  aggro: 0, flee: true,
    drops: [{ item: 'crystal', n: 2, p: 1 }],
    tiles: [T.CRYSTAL, T.ROCK], rp: 20, color: '#8fd7e8', r: 0.35 },
};

// ---- world resource objects ----
// tool: required tool kind (null = hands); hits: strikes to deplete; drop per hit
export const RESOURCES = {
  tree:       { name: 'Veilwood tree',     tool: 'axe',  hits: 4, drop: { wood: 2 },  regrow: 300, block: true,  rp: 8, color: '#3a6b3f' },
  boulder:    { name: 'Stone outcrop',     tool: 'pick', hits: 4, drop: { stone: 2 }, regrow: 420, block: true,  rp: 8, color: '#8b8b90' },
  crystal_node:{ name: 'Crystal node',     tool: 'pick', hits: 3, drop: { crystal: 1 }, regrow: 600, block: true, rp: 10, color: '#7fd4ef' },
  fiber_plant:{ name: 'Silkgrass tuft',    tool: null,   hits: 1, drop: { fiber: 3 }, regrow: 180, block: false, rp: 8, color: '#a4c26b' },
  pulse_bush: { name: 'Pulse-fruit bush',  tool: null,   hits: 1, drop: { pulse_fruit: 2 }, regrow: 240, block: false, rp: 8, color: '#c05a92' },
  glowshroom: { name: 'Glowshroom ring',   tool: null,   hits: 1, drop: { glow_spores: 2 }, regrow: 260, block: false, rp: 8, color: '#79e0b8' },
  debris:     { name: 'Wormhole debris',   tool: 'pick', hits: 3, drop: { alloy: 1 }, regrow: 0, block: true, rp: 10, color: '#c88d3c' },
};

// wormhole repair — all three parts must be installed, then activated
export const WORMHOLE_PARTS = ['stabilizer_core', 'focus_lens', 'power_cell'];

// research tiers: RP thresholds (tier 1 is free)
export const TIER_RP = [0, 0, 60, 150];

export const INV_SLOTS = 24;

export function recipeById(id) { return RECIPES.find(r => r.id === id); }
