// Shared game definitions — used by both the Node server and the browser client.
// All visuals are procedurally drawn placeholders; emoji stand in for item icons.

export const SAVE_VERSION = 2;
export const TILE = 40;            // px per tile (client rendering)
export const WORLD_W = 200;        // tiles
export const WORLD_H = 200;
export const DAY_LENGTH = 480;     // real seconds per in-game day
export const DAYS_PER_SEASON = 6;
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const SEASON_ICON = ['🌱', '☀️', '🍂', '❄️'];
export const SEASON_TEMP = [12, 27, 8, -9];   // ambient base °C per season
export const TICK_RATE = 20;       // server sim Hz
export const SNAP_RATE = 10;       // snapshot Hz

// day/dusk/night phases (tod: 0 = midnight)
export const PHASE = { DAY: 'day', DUSK: 'dusk', NIGHT: 'night' };
export function phaseOf(tod) {
  if (tod >= 0.22 && tod < 0.62) return PHASE.DAY;
  if (tod >= 0.62 && tod < 0.80) return PHASE.DUSK;
  return PHASE.NIGHT;
}

// ---- terrain tiles ----
export const T = {
  DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, MEADOW: 4,
  SPORE: 5, MARSH: 6, ROCK: 7, CRYSTAL: 8,
};
export const TILE_INFO = {
  [T.DEEP]:    { name: 'Deep water',      color: '#123a5c', walk: false, water: true },
  [T.WATER]:   { name: 'Shallow water',   color: '#1d6d9e', walk: false, water: true },
  [T.SAND]:    { name: 'Ashen shore',     color: '#cbb375', walk: true },
  [T.GRASS]:   { name: 'Pale sward',      color: '#7ba05b', walk: true },
  [T.MEADOW]:  { name: 'Violet meadow',   color: '#8d80b8', walk: true },
  [T.SPORE]:   { name: 'Spore forest',    color: '#47654e', walk: true, tempMod: 1, sporeRisk: true },
  [T.MARSH]:   { name: 'Breathing marsh', color: '#566b42', walk: true, tempMod: 2, slow: 0.6, sporeRisk: true },
  [T.ROCK]:    { name: 'Grey barrens',    color: '#7d7d84', walk: true, tempMod: -2 },
  [T.CRYSTAL]: { name: 'Crystal flats',   color: '#6c93ad', walk: true, tempMod: -4 },
};

// ---- items ----
// food/water/hp/sanity: restored on consume (can be negative); sickRisk: parasite chance
// tool: {kind, dmg, uses}; equip: 'hand'|'body'; fuel: campfire seconds
// perish: game-seconds until the item rots into spoiled_mush (freshness tracked per stack)
export const ITEMS = {
  wood:         { name: 'Veilwood log',     emoji: '🪵', stack: 20, fuel: 45 },
  stone:        { name: 'Stone',            emoji: '🪨', stack: 20 },
  fiber:        { name: 'Silkgrass fiber',  emoji: '🌾', stack: 30, fuel: 8 },
  crystal:      { name: 'Resonant crystal', emoji: '💎', stack: 20 },
  alloy:        { name: 'Alloy fragment',   emoji: '🔩', stack: 20 },
  hide:         { name: 'Chitin hide',      emoji: '🐚', stack: 20 },
  raw_meat:     { name: 'Raw meat',         emoji: '🥩', stack: 10, food: 14, sanity: -8, sickRisk: 0.35, perish: 700 },
  cooked_meat:  { name: 'Cooked meat',      emoji: '🍖', stack: 10, food: 34, perish: 1400 },
  pulse_fruit:  { name: 'Pulse-fruit',      emoji: '🫐', stack: 15, food: 12, water: 6, sanity: 2, perish: 1000 },
  glow_spores:  { name: 'Glow spores',      emoji: '🍄', stack: 20, food: 4, sanity: 2, perish: 1600 },
  spoiled_mush: { name: 'Spoiled mush',     emoji: '🍂', stack: 20, food: 6, sanity: -12, sickRisk: 0.4 },
  hearty_stew:  { name: 'Hearty stew',      emoji: '🍲', stack: 5, food: 55, hp: 6, sanity: 6, perish: 900 },
  forest_medley:{ name: 'Forest medley',    emoji: '🥗', stack: 5, food: 24, hp: 3, sanity: 12, perish: 900 },
  glow_jelly:   { name: 'Glow jelly',       emoji: '🍮', stack: 5, food: 16, sanity: 20, perish: 900 },
  remedy:       { name: 'Spore remedy',     emoji: '🧪', stack: 5,  cure: true },
  bandage:      { name: 'Bandage',          emoji: '🩹', stack: 10, bandage: true },
  flask_empty:  { name: 'Flask (empty)',    emoji: '🫙', stack: 3 },
  flask_dirty:  { name: 'Flask (murky)',    emoji: '🥃', stack: 3, water: 40, sickRisk: 0.25, toFlask: 'flask_empty' },
  flask_clean:  { name: 'Flask (purified)', emoji: '💧', stack: 3, water: 55, toFlask: 'flask_empty' },
  axe:          { name: 'Field axe',        emoji: '🪓', stack: 1, tool: { kind: 'axe',  dmg: 10, uses: 60 }, equip: 'hand' },
  pickaxe:      { name: 'Geo pick',         emoji: '⛏️', stack: 1, tool: { kind: 'pick', dmg: 8,  uses: 60 }, equip: 'hand' },
  spear:        { name: 'Alloy spear',      emoji: '🔱', stack: 1, tool: { kind: 'spear', dmg: 16, uses: 50 }, equip: 'hand' },
  torch:        { name: 'Spore torch',      emoji: '🕯️', stack: 1, tool: { kind: 'torch', dmg: 4, uses: 45 }, equip: 'hand', warm: 4, light: true, burns: true },
  coat:         { name: 'Chitin coat',      emoji: '🧥', stack: 1, equip: 'body', warm: 9 },
  stabilizer_core: { name: 'Stabilizer core',  emoji: '⚙️', stack: 1, part: true },
  focus_lens:      { name: 'Focus lens array', emoji: '🔍', stack: 1, part: true },
  power_cell:      { name: 'Bio power cell',   emoji: '🔋', stack: 1, part: true },
};

// ---- crafting recipes ----
// station: null (anywhere) | 'campfire' | 'bench' | 'cookpot'; tier: research tier required
export const RECIPES = [
  { id: 'axe',        cost: { wood: 2, fiber: 2, stone: 1 }, tier: 1, station: null },
  { id: 'pickaxe',    cost: { wood: 2, fiber: 2, stone: 2 }, tier: 1, station: null },
  { id: 'spear',      cost: { wood: 2, fiber: 1, stone: 1 }, tier: 1, station: null },
  { id: 'torch',      cost: { wood: 1, fiber: 1, glow_spores: 1 }, tier: 1, station: null },
  { id: 'bandage',    cost: { fiber: 3 }, tier: 1, station: null },
  { id: 'flask_empty',cost: { fiber: 4, hide: 1 }, tier: 1, station: null },
  { id: 'remedy',     cost: { glow_spores: 2, pulse_fruit: 1 }, tier: 1, station: 'campfire' },
  { id: 'coat',       cost: { hide: 4, fiber: 6 }, tier: 2, station: 'bench' },
  { id: 'hearty_stew',  cost: { raw_meat: 2, pulse_fruit: 1 }, tier: 2, station: 'cookpot' },
  { id: 'forest_medley',cost: { pulse_fruit: 2, glow_spores: 1, fiber: 1 }, tier: 2, station: 'cookpot' },
  { id: 'glow_jelly',   cost: { glow_spores: 3, pulse_fruit: 1 }, tier: 2, station: 'cookpot' },
  { id: 'stabilizer_core', cost: { alloy: 4, crystal: 6 }, tier: 3, station: 'bench' },
  { id: 'focus_lens',      cost: { crystal: 8, stone: 4 }, tier: 3, station: 'bench' },
  { id: 'power_cell',      cost: { alloy: 5, crystal: 3, glow_spores: 6 }, tier: 3, station: 'bench' },
];

// ---- buildable structures ----
export const STRUCTURES = {
  campfire:  { name: 'Campfire',        emoji: '🔥', cost: { wood: 5, stone: 3 },  tier: 1, block: false, hp: 50 },
  crate:     { name: 'Storage crate',   emoji: '📦', cost: { wood: 6, fiber: 2 },  tier: 1, block: true,  hp: 80 },
  bench:     { name: 'Research bench',  emoji: '🔬', cost: { wood: 8, stone: 4, crystal: 2 }, tier: 1, block: true, hp: 100 },
  cookpot:   { name: 'Cook pot',        emoji: '🫕', cost: { stone: 5, wood: 3, crystal: 1 }, tier: 2, block: true, hp: 80 },
  wall:      { name: 'Timber wall',     emoji: '🧱', cost: { wood: 4 },            tier: 2, block: true,  hp: 200 },
  door:      { name: 'Timber door',     emoji: '🚪', cost: { wood: 5, fiber: 1 },  tier: 2, block: true,  hp: 150, door: true },
  bed:       { name: 'Field cot',       emoji: '🛏️', cost: { wood: 4, fiber: 6, hide: 2 }, tier: 2, block: true, hp: 60 },
  condenser: { name: 'Dew condenser',   emoji: '🫧', cost: { wood: 4, fiber: 4, stone: 2 }, tier: 2, block: true, hp: 80 },
};

// DST-style crafting sidebar categories (r = recipe, s = structure)
export const CRAFT_MENU = [
  { icon: '🪓', name: 'Tools',     entries: [['r', 'axe'], ['r', 'pickaxe'], ['r', 'spear']] },
  { icon: '🔥', name: 'Light',     entries: [['r', 'torch'], ['s', 'campfire']] },
  { icon: '⛑️', name: 'Survival',  entries: [['r', 'bandage'], ['r', 'remedy'], ['r', 'flask_empty'], ['r', 'coat']] },
  { icon: '🍲', name: 'Food',      entries: [['s', 'cookpot'], ['r', 'hearty_stew'], ['r', 'forest_medley'], ['r', 'glow_jelly']] },
  { icon: '🔬', name: 'Science',   entries: [['s', 'bench'], ['s', 'condenser'], ['r', 'stabilizer_core'], ['r', 'focus_lens'], ['r', 'power_cell']] },
  { icon: '🏠', name: 'Structures', entries: [['s', 'wall'], ['s', 'door'], ['s', 'crate'], ['s', 'bed']] },
];

// ---- creatures ----
// aggro: 0 = passive; retaliate: fights back; night: only spawns at night;
// shadow: sanity phantasm (ignores walls, tied to insane players)
export const CREATURES = {
  skitterling: { name: 'Skitterling',   emoji: '🦗', hp: 20, speed: 3.2, dmg: 0,  aggro: 0, flee: true,
    drops: [{ item: 'raw_meat', n: 1, p: 1 }, { item: 'hide', n: 1, p: 0.5 }],
    tiles: [T.GRASS, T.MEADOW], rp: 15, color: '#c9b458', r: 0.35 },
  grazer:      { name: 'Duskgrazer',    emoji: '🦌', hp: 60, speed: 2.4, dmg: 8,  aggro: 0, retaliate: true,
    drops: [{ item: 'raw_meat', n: 2, p: 1 }, { item: 'hide', n: 2, p: 0.8 }],
    tiles: [T.MEADOW, T.GRASS], rp: 15, color: '#a284c9', r: 0.55 },
  spinehound:  { name: 'Spinehound',    emoji: '🐺', hp: 45, speed: 4.2, dmg: 12, aggro: 8, night: true,
    drops: [{ item: 'raw_meat', n: 1, p: 1 }, { item: 'hide', n: 1, p: 0.6 }],
    tiles: [T.GRASS, T.MEADOW, T.SPORE, T.ROCK], rp: 20, color: '#b0453a', r: 0.45 },
  marsh_lurker:{ name: 'Marsh lurker',  emoji: '🐊', hp: 70, speed: 3.0, dmg: 15, aggro: 5,
    drops: [{ item: 'raw_meat', n: 2, p: 1 }, { item: 'glow_spores', n: 2, p: 1 }],
    tiles: [T.MARSH], rp: 20, color: '#5a8a5e', r: 0.55 },
  crystal_wisp:{ name: 'Crystal wisp',  emoji: '✨', hp: 30, speed: 4.6, dmg: 0,  aggro: 0, flee: true,
    drops: [{ item: 'crystal', n: 2, p: 1 }],
    tiles: [T.CRYSTAL, T.ROCK], rp: 20, color: '#9fe3f2', r: 0.35 },
  phantasm:    { name: 'Phantasm',      emoji: '🌑', hp: 40, speed: 4.8, dmg: 10, aggro: 12, shadow: true,
    drops: [{ item: 'crystal', n: 1, p: 0.5 }],
    tiles: [], rp: 25, color: '#211b30', r: 0.5 },
};

// ---- world resource objects ----
export const RESOURCES = {
  tree:       { name: 'Veilwood tree',     emoji: '🌳', tool: 'axe',  hits: 4, drop: { wood: 2 },  regrow: 300, block: true,  rp: 8, color: '#3f7347' },
  boulder:    { name: 'Stone outcrop',     emoji: '🪨', tool: 'pick', hits: 4, drop: { stone: 2 }, regrow: 420, block: true,  rp: 8, color: '#93939b' },
  crystal_node:{ name: 'Crystal node',     emoji: '💠', tool: 'pick', hits: 3, drop: { crystal: 1 }, regrow: 600, block: true, rp: 10, color: '#8fdcf5' },
  fiber_plant:{ name: 'Silkgrass tuft',    emoji: '🌾', tool: null,   hits: 1, drop: { fiber: 3 }, regrow: 180, block: false, rp: 8, color: '#b3cf79', seasonal: true },
  pulse_bush: { name: 'Pulse-fruit bush',  emoji: '🫐', tool: null,   hits: 1, drop: { pulse_fruit: 2 }, regrow: 240, block: false, rp: 8, color: '#c9639c', seasonal: true },
  glowshroom: { name: 'Glowshroom ring',   emoji: '🍄', tool: null,   hits: 1, drop: { glow_spores: 2 }, regrow: 260, block: false, rp: 8, color: '#84e8c0', seasonal: true },
  debris:     { name: 'Wormhole debris',   emoji: '🛸', tool: 'pick', hits: 3, drop: { alloy: 1 }, regrow: 0, block: true, rp: 10, color: '#d29a45' },
};

// wormhole repair — all three parts must be installed, then activated
export const WORMHOLE_PARTS = ['stabilizer_core', 'focus_lens', 'power_cell'];

// research tiers: RP thresholds (tier 1 is free)
export const TIER_RP = [0, 0, 60, 150];

export const INV_SLOTS = 20;

export function recipeById(id) { return RECIPES.find(r => r.id === id); }
