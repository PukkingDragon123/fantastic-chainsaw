// DOM-based UI: HUD bars, inventory, craft/build/catalogue panels, crate/campfire menus, chat.
import { ITEMS, RECIPES, STRUCTURES, CREATURES, RESOURCES, SEASONS, TIER_RP, WORMHOLE_PARTS } from '/shared/defs.js';
import { state, act, send, nearestInteractable } from '/main.js';

const $ = id => document.getElementById(id);

export function onJoined() {
  for (const id of ['hud', 'clock', 'help', 'invbar']) $(id).style.display = '';
  $('invbar').style.display = 'flex';
  refreshPanels();
  log('sys', 'Transit failure. You are stranded — survive and repair the wormhole. [E] interact, [F] scan lifeforms.');
}

// ---------- HUD ----------
export function refreshHUD() {
  const y = state.you;
  if (!y) return;
  bar('hp', y.hp, 100, Math.round(y.hp));
  bar('hunger', y.hunger, 100, Math.round(y.hunger));
  bar('thirst', y.thirst, 100, Math.round(y.thirst));
  bar('stam', y.stam, 100, Math.round(y.stam));
  bar('temp', (y.temp - 25) / 20 * 100, 100, y.temp.toFixed(1) + '°C');
  $('b-temp').style.background = y.temp < 33 ? '#5ab8f0' : y.temp > 39.5 ? '#f05a3a' : '#c9c93a';

  const fx = [];
  if (y.fx.bleed) fx.push('🩸 bleeding');
  if (y.fx.parasites) fx.push('🦠 parasites');
  if (y.fx.spore) fx.push('🍄 spore sickness');
  if (y.fx.infection) fx.push('🤒 infection');
  $('fx').textContent = fx.join(' · ');

  const e = state.env;
  const hour = Math.floor(e.tod * 24), min = Math.floor((e.tod * 24 % 1) * 60);
  $('c-season').textContent = `${SEASONS[e.season]}${e.night ? ' 🌙' : ' ☀'}`;
  $('c-day').textContent = `Day ${e.day + 1} — ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  $('c-temp').textContent = `Ambient ${e.amb}°C`;
  $('c-rp').textContent = `Tier ${state.team?.tier ?? 1} · ${state.team?.rp ?? 0} RP`;

  refreshInv();
  $('deathmsg').style.display = state.dead ? 'flex' : 'none';
  if (state.dead) $('deathtimer').textContent = `respawning in ${Math.max(0, state.respawnIn).toFixed(0)}s…`;
}

function bar(id, v, max, label) {
  $('b-' + id).style.width = Math.max(0, Math.min(100, v / max * 100)) + '%';
  $('t-' + id).textContent = label;
}

// ---------- inventory ----------
let lastInvJson = '';
function refreshInv() {
  const y = state.you;
  const json = JSON.stringify([y.inv, y.handSlot, y.bodySlot, state.crate?.i]);
  if (json === lastInvJson) return;
  lastInvJson = json;
  const el = $('invbar');
  el.innerHTML = '';
  y.inv.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'slot' + ((i === y.handSlot || i === y.bodySlot) ? ' eq' : '');
    if (s) {
      const def = ITEMS[s.id];
      d.textContent = def.name;
      if (s.n > 1) d.innerHTML += `<span class="n">${s.n}</span>`;
      if (s.uses != null) d.innerHTML += `<span class="u">${s.uses}</span>`;
      d.title = itemTip(s);
    }
    d.onclick = () => {
      if (!s) return;
      if (state.crate) act('store', { obj: state.crate.i, slot: i });
      else act('use', { slot: i });
    };
    d.oncontextmenu = (e) => { e.preventDefault(); if (s) act('drop', { slot: i }); };
    el.appendChild(d);
  });
}
function itemTip(s) {
  const d = ITEMS[s.id];
  const bits = [];
  if (d.food) bits.push(`+${d.food} hunger`);
  if (d.water) bits.push(`+${d.water} thirst`);
  if (d.sickRisk) bits.push(`${Math.round(d.sickRisk * 100)}% parasite risk`);
  if (d.tool) bits.push(`${d.tool.dmg} dmg`);
  if (d.warm) bits.push(`+${d.warm}° warmth`);
  if (d.bandage) bits.push('stops bleeding');
  if (d.cure) bits.push('cures diseases');
  if (d.part) bits.push('wormhole component');
  return `${d.name}${bits.length ? ' — ' + bits.join(', ') : ''}\nLeft-click: use/equip · Right-click: drop`;
}

// ---------- panels ----------
const PANELS = ['craft', 'buildmenu', 'catalogue', 'cratebox'];
export function togglePanel(id) {
  const show = $(id).style.display !== 'block';
  closeAll();
  if (show) { $(id).style.display = 'block'; refreshPanels(); }
}
export function closeAll() { PANELS.forEach(p => $(p).style.display = 'none'); state.crate = null; }

export function refreshPanels() {
  const tier = state.team?.tier ?? 1;

  // craft list
  const cl = $('craftlist'); cl.innerHTML = '';
  for (const r of RECIPES) {
    const b = document.createElement('button');
    const locked = tier < r.tier;
    b.className = 'rowbtn' + (locked ? ' off' : '');
    const cost = Object.entries(r.cost).map(([k, n]) => `${n} ${ITEMS[k].name}`).join(', ');
    b.innerHTML = `${ITEMS[r.id].name}<small>${cost}${r.station ? ` · at ${r.station}` : ''}${locked ? ` · tier ${r.tier}` : ''}</small>`;
    b.onclick = () => act('craft', { id: r.id });
    cl.appendChild(b);
  }

  // build list
  const bl = $('buildlist'); bl.innerHTML = '';
  for (const [id, s] of Object.entries(STRUCTURES)) {
    const b = document.createElement('button');
    const locked = tier < s.tier;
    b.className = 'rowbtn' + (locked ? ' off' : '');
    const cost = Object.entries(s.cost).map(([k, n]) => `${n} ${ITEMS[k].name}`).join(', ');
    b.innerHTML = `${s.name}<small>${cost}${locked ? ` · tier ${s.tier}` : ''}</small>`;
    b.onclick = () => { state.buildSel = id; closeAll(); log('sys', `Placing ${s.name} — click a tile (Shift-click for multiple, Esc to cancel).`); };
    bl.appendChild(b);
  }

  // catalogue
  const cat = $('cataloguelist'); cat.innerHTML = '';
  const entries = { ...Object.fromEntries(Object.entries(CREATURES).map(([k, v]) => ['c:' + k, v.name + ' (fauna)'])),
    ...Object.fromEntries(Object.entries(RESOURCES).map(([k, v]) => ['o:' + k, v.name + ' (flora/geo)'])),
    'o:wormhole': 'Wormhole anomaly' };
  let done = 0, total = Object.keys(entries).length;
  for (const [key, label] of Object.entries(entries)) {
    const who = state.team?.catalogue?.[key];
    if (who) done++;
    const d = document.createElement('div');
    d.className = 'rowbtn' + (who ? '' : ' off');
    d.innerHTML = who ? `✓ ${label}<small>catalogued by ${who}</small>` : `? ${'Unknown specimen'}<small>scan with [F]</small>`;
    cat.appendChild(d);
  }
  const head = document.createElement('div');
  head.innerHTML = `<small>${done}/${total} catalogued · ${state.team?.rp ?? 0} RP · next tier at ${TIER_RP[Math.min(3, (state.team?.tier ?? 1) + 1)]} RP</small>`;
  const parts = WORMHOLE_PARTS.map(p => (state.team?.parts?.[p] ? '✓ ' : '✗ ') + ITEMS[p].name).join('<br>');
  head.innerHTML += `<div style="margin-top:6px;color:#7fd4ef">Wormhole repair:<br>${parts}</div>`;
  cat.prepend(head);
}

// ---------- crate ----------
export function showCrate() {
  const crate = state.crate; // closeAll() clears it
  closeAll();
  state.crate = crate;
  const box = $('cratebox');
  box.style.display = 'block';
  const el = $('crateinv'); el.innerHTML = '';
  if (!state.crate) return;
  if (!state.crate.inv.length) el.innerHTML = '<small style="color:#9ab">Empty. Click items in your inventory to store them.</small>';
  state.crate.inv.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'rowbtn';
    b.textContent = `${ITEMS[s.id].name} ×${s.n}`;
    b.onclick = () => act('take', { obj: state.crate.i, slot: i });
    el.appendChild(b);
  });
}
export function hideCrate() { $('cratebox').style.display = 'none'; }

// ---------- campfire menu ----------
export function showCampfire(objId) {
  closeAll();
  const box = $('craft');
  box.style.display = 'block';
  const cl = $('craftlist');
  cl.innerHTML = '<h3>CAMPFIRE</h3>';
  const actions = [
    ['Cook raw meat', () => act('cook', { obj: objId })],
    ['Boil murky flask', () => act('boil', { obj: objId })],
    ['Add fuel (wood/fiber)', () => act('fuel', { obj: objId })],
  ];
  for (const [label, fn] of actions) {
    const b = document.createElement('button');
    b.className = 'rowbtn'; b.textContent = label; b.onclick = fn;
    cl.appendChild(b);
  }
  const note = document.createElement('small');
  note.style.color = '#9ab';
  note.textContent = 'Craft menu is back on [C].';
  cl.appendChild(note);
}

// ---------- hint line ----------
export function refreshHint() {
  const o = nearestInteractable();
  const el = $('hint');
  if (!o || state.dead) { el.style.display = 'none'; return; }
  const name = RESOURCES[o.ty]?.name || STRUCTURES[o.ty]?.name ||
    (o.ty === 'wormhole' ? 'Wormhole' : o.ty === 'bag' ? 'Dropped items' : o.ty);
  let verb = 'interact';
  if (RESOURCES[o.ty]) verb = o.ready === false ? 'depleted' : 'gather';
  else if (o.ty === 'campfire') verb = 'cook/boil/fuel';
  else if (o.ty === 'crate') verb = 'open';
  else if (o.ty === 'door') verb = o.open ? 'close' : 'open';
  else if (o.ty === 'bed') verb = 'set respawn';
  else if (o.ty === 'wormhole') verb = 'install parts / activate';
  else if (o.ty === 'bag') verb = 'pick up';
  el.textContent = `[E] ${name} — ${verb}`;
  el.style.display = 'block';
}

// ---------- chat & log ----------
export function log(cls, m) {
  const el = $('log');
  const d = document.createElement('div');
  if (cls === 'sys') d.className = 'sys';
  d.textContent = m;
  el.appendChild(d);
  while (el.children.length > 9) el.removeChild(el.firstChild);
  setTimeout(() => { if (d.parentNode) d.style.opacity = 0.55; }, 8000);
}
export function chatFocused() { return document.activeElement === $('chattext'); }
export function toggleChat(sendIt) {
  const box = $('chatin'), input = $('chattext');
  if (box.style.display === 'block') {
    if (sendIt && input.value.trim()) send({ t: 'chat', m: input.value.trim() });
    input.value = ''; box.style.display = 'none'; input.blur();
  } else {
    box.style.display = 'block'; input.focus();
  }
}
export function showWin() {
  $('winmsg').style.display = 'flex';
  setTimeout(() => $('winmsg').style.display = 'none', 12000);
}
