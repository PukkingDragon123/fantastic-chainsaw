// DOM UI: circular stat badges, segmented day clock, left crafting sidebar,
// emoji inventory with freshness/durability, catalogue, crate/campfire panels,
// chat, and full-screen effect overlays.
import {
  ITEMS, RECIPES, STRUCTURES, CREATURES, RESOURCES, SEASONS, SEASON_ICON,
  TIER_RP, WORMHOLE_PARTS, CRAFT_MENU, recipeById, phaseOf,
} from '/shared/defs.js';
import { state, act, send, nearestInteractable, myPos } from '/main.js';

const $ = id => document.getElementById(id);

export function onJoined() {
  for (const id of ['topright', 'help', 'bottom', 'craftbar']) $(id).style.display = '';
  buildCraftbar();
  log('sys', 'Transit failure. You are stranded. Stay in the light after dark — the darkness is not empty.');
  log('sys', '[E] interact · [F] scan lifeforms · [C] craft. Repair the wormhole to go home.');
}

// ---------- helpers ----------
function countItem(id) {
  return (state.you?.inv || []).reduce((a, s) => a + (s && s.id === id ? s.n : 0), 0);
}
function nearStation(ty) {
  for (const o of state.objects.values())
    if (o.ty === ty && (o.x + 0.5 - myPos.x) ** 2 + (o.y + 0.5 - myPos.y) ** 2 < 9) return true;
  return false;
}
function costLine(cost) {
  return Object.entries(cost).map(([k, n]) => `${ITEMS[k].emoji}${n}`).join(' ');
}

// ---------- HUD ----------
const BADGES = [
  ['hp', '#c9403a'], ['hunger', '#c98a3a'], ['thirst', '#3a8ac9'], ['sanity', '#9a6ac9'],
];
export function refreshHUD() {
  const y = state.you;
  if (!y) return;
  for (const [key, color] of BADGES) {
    const v = Math.max(0, Math.min(100, y[key]));
    const el = $('bd-' + key);
    el.style.background = `conic-gradient(${color} ${v * 3.6}deg, rgba(20,16,12,.9) 0)`;
    el.querySelector('.v').textContent = Math.round(v);
    el.classList.toggle('pulse', v < 22);
  }
  $('stambar').firstElementChild.style.width = Math.max(0, y.stam) + '%';

  const t = y.temp;
  $('temppill').textContent = `🌡 ${t.toFixed(1)}°C`;
  $('temppill').style.color = t < 33 ? '#8ac6ff' : t > 39.5 ? '#ff9a6a' : 'var(--ink)';

  const fx = [];
  if (y.sleeping) fx.push('💤 sleeping');
  if (y.fx.bleed) fx.push('🩸 bleeding');
  if (y.fx.parasites) fx.push('🦠 parasites');
  if (y.fx.spore) fx.push('🍄 spore sickness');
  if (y.fx.infection) fx.push('🤒 infection');
  $('fx').textContent = fx.join(' · ');

  drawClock();
  refreshInv();
  refreshOverlays();

  $('deathmsg').style.display = state.dead ? 'flex' : 'none';
  if (state.dead) $('deathtimer').textContent = `respawning in ${Math.max(0, state.respawnIn).toFixed(0)}s…`;

  if ($('craftpanel').style.display === 'block') refreshCraftPanel();
}

// segmented day/dusk/night clock with a rotating hand
function drawClock() {
  const cv = $('clockcv'), c = cv.getContext('2d');
  const e = state.env, R = 52, cx = 55, cy = 55;
  c.clearRect(0, 0, 110, 110);
  const seg = (a0, a1, color) => {
    c.beginPath(); c.moveTo(cx, cy);
    c.arc(cx, cy, R, a0 * Math.PI * 2 - Math.PI / 2, a1 * Math.PI * 2 - Math.PI / 2);
    c.closePath(); c.fillStyle = color; c.fill();
  };
  seg(0.80, 1.22, '#1b2338');           // night (wraps midnight)
  seg(0.22, 0.62, '#e8c15a');           // day
  seg(0.62, 0.80, '#d07a3a');           // dusk
  c.beginPath(); c.arc(cx, cy, R, 0, 7); c.lineWidth = 3; c.strokeStyle = '#4a3b28'; c.stroke();
  // hand
  const a = e.tod * Math.PI * 2 - Math.PI / 2;
  c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6));
  c.lineWidth = 2.5; c.strokeStyle = '#f5eede'; c.stroke();
  // center disc
  c.beginPath(); c.arc(cx, cy, 28, 0, 7); c.fillStyle = 'rgba(24,19,14,.95)'; c.fill();
  c.lineWidth = 2; c.strokeStyle = '#4a3b28'; c.stroke();
  c.fillStyle = '#e8ddc8'; c.textAlign = 'center';
  c.font = '13px sans-serif';
  c.fillText(SEASON_ICON[e.season] + ' ' + (e.day + 1), cx, cy - 2);
  c.font = '10px sans-serif'; c.fillStyle = '#a89878';
  c.fillText(SEASONS[e.season], cx, cy + 11);
  cv.title = `Day ${e.day + 1}, ${SEASONS[e.season]} — ambient ${e.amb}°C · Tier ${state.team?.tier} · ${state.team?.rp} RP`;
}

// screen-edge effect overlays
function refreshOverlays() {
  const y = state.you;
  $('coldfx').style.opacity = y.temp < 34 ? Math.min(1, (34 - y.temp) / 5) : 0;
  $('hotfx').style.opacity = y.temp > 39 ? Math.min(1, (y.temp - 39) / 3) : 0;
  $('sanefx').style.opacity = y.sanity < 40 ? Math.min(1, (40 - y.sanity) / 35) : 0;
  $('hurtfx').style.opacity = (state.hurtFlash || 0) > 0 ? 0.9 : (y.hp < 25 ? 0.45 : 0);
  $('darkfx').style.opacity = y.dark ? 0.65 : 0;
  if (state.hurtFlash > 0) state.hurtFlash -= 0.34;
}
let lastHp = 100;
export function noteDamage(hp) {
  if (hp < lastHp - 0.5) { state.hurtFlash = 1; state.shake = Math.min(1.4, (lastHp - hp) / 12); }
  lastHp = hp;
}

// a whisper drifts across the screen when sanity frays
export function showWhisper(text) {
  const d = document.createElement('div');
  d.className = 'whisper';
  d.textContent = text;
  d.style.left = (15 + Math.random() * 55) + '%';
  d.style.top = (20 + Math.random() * 45) + '%';
  d.style.transform = `rotate(${(Math.random() - 0.5) * 8}deg)`;
  document.body.appendChild(d);
  setTimeout(() => d.classList.add('fade'), 60);
  setTimeout(() => d.remove(), 6200);
}

// ---------- inventory + equip ----------
let lastInvJson = '';
function slotEl(s, cls, onLeft, onRight, label) {
  const d = document.createElement('div');
  d.className = 'slot' + (cls ? ' ' + cls : '');
  if (label) d.innerHTML = `<span class="lb">${label}</span>`;
  if (s) {
    const def = ITEMS[s.id];
    d.innerHTML += def.emoji;
    if (s.n > 1) d.innerHTML += `<span class="n">${s.n}</span>`;
    if (s.uses != null && def.tool) {
      const pct = Math.max(0, s.uses / def.tool.uses * 100);
      d.innerHTML += `<span class="m"><i style="width:${pct}%;background:#7fd4ef"></i></span>`;
    } else if (s.fresh != null) {
      const pct = Math.max(0, s.fresh * 100);
      const col = s.fresh > 0.5 ? '#8ade7a' : s.fresh > 0.25 ? '#e8c15a' : '#c9403a';
      d.innerHTML += `<span class="m"><i style="width:${pct}%;background:${col}"></i></span>`;
    }
    d.title = itemTip(s);
  }
  d.onclick = onLeft || null;
  d.oncontextmenu = (e) => { e.preventDefault(); onRight && onRight(); };
  // touch: long-press to drop
  let holdT = null;
  d.addEventListener('touchstart', () => {
    holdT = setTimeout(() => { holdT = null; onRight && onRight(); }, 550);
  }, { passive: true });
  const cancelHold = () => { if (holdT) clearTimeout(holdT); };
  d.addEventListener('touchend', cancelHold, { passive: true });
  d.addEventListener('touchmove', cancelHold, { passive: true });
  return d;
}
function refreshInv() {
  const y = state.you;
  const json = JSON.stringify([y.inv, y.handSlot, y.bodySlot, state.crate?.i]);
  if (json === lastInvJson) return;
  lastInvJson = json;
  const el = $('invbar');
  el.innerHTML = '';
  y.inv.forEach((s, i) => {
    el.appendChild(slotEl(s, (i === y.handSlot || i === y.bodySlot) ? 'eq' : '',
      () => { if (!s) return; state.crate ? act('store', { obj: state.crate.i, slot: i }) : act('use', { slot: i }); },
      () => { if (s) act('drop', { slot: i }); }));
  });
  const eq = $('equipbar');
  eq.innerHTML = '';
  const hand = y.handSlot >= 0 ? y.inv[y.handSlot] : null;
  const body = y.bodySlot >= 0 ? y.inv[y.bodySlot] : null;
  eq.appendChild(slotEl(hand, hand ? 'eq' : '', () => hand && act('use', { slot: y.handSlot }), null, 'hand'));
  eq.appendChild(slotEl(body, body ? 'eq' : '', () => body && act('use', { slot: y.bodySlot }), null, 'body'));
}
function itemTip(s) {
  const d = ITEMS[s.id];
  const bits = [];
  if (d.food) bits.push(`${d.food > 0 ? '+' : ''}${d.food} hunger`);
  if (d.water) bits.push(`+${d.water} thirst`);
  if (d.hp) bits.push(`+${d.hp} hp`);
  if (d.sanity) bits.push(`${d.sanity > 0 ? '+' : ''}${d.sanity} sanity`);
  if (d.sickRisk) bits.push(`${Math.round(d.sickRisk * 100)}% parasite risk`);
  if (d.tool) bits.push(`${d.tool.dmg} dmg`);
  if (d.warm) bits.push(`+${d.warm}° warmth`);
  if (d.light) bits.push('holds back the darkness');
  if (d.bandage) bits.push('stops bleeding');
  if (d.cure) bits.push('cures diseases');
  if (d.part) bits.push('wormhole component');
  if (s.fresh != null) bits.push(`${Math.round(s.fresh * 100)}% fresh`);
  return `${d.name}${bits.length ? '\n' + bits.join(', ') : ''}\nLeft-click: use/equip · Right-click: drop`;
}

// ---------- crafting sidebar ----------
let activeCat = -1;
function buildCraftbar() {
  const bar = $('craftbar');
  bar.innerHTML = '';
  CRAFT_MENU.forEach((cat, i) => {
    const b = document.createElement('button');
    b.className = 'cattab';
    b.textContent = cat.icon;
    b.title = cat.name;
    b.onclick = () => openCat(activeCat === i ? -1 : i);
    bar.appendChild(b);
  });
}
export function openCat(i) {
  activeCat = i;
  [...$('craftbar').children].forEach((el, k) => el.classList.toggle('active', k === i));
  $('craftpanel').style.display = i < 0 ? 'none' : 'block';
  if (i >= 0) refreshCraftPanel();
}
function refreshCraftPanel() {
  if (activeCat < 0) return;
  const cat = CRAFT_MENU[activeCat];
  const el = $('craftpanel');
  const tier = state.team?.tier ?? 1;
  el.innerHTML = `<h3>${cat.icon} ${cat.name.toUpperCase()}</h3>`;
  for (const [kind, id] of cat.entries) {
    const def = kind === 'r' ? recipeById(id) : STRUCTURES[id];
    const item = kind === 'r' ? ITEMS[id] : STRUCTURES[id];
    const afford = Object.entries(def.cost).every(([k, n]) => countItem(k) >= n);
    let why = '';
    if (tier < def.tier) why = `research tier ${def.tier} needed`;
    else if (kind === 'r' && def.station && !nearStation(def.station))
      why = `stand near a ${STRUCTURES[def.station]?.name || def.station}`;
    else if (!afford) why = 'missing materials';
    const b = document.createElement('button');
    b.className = 'rec' + (why ? ' off' : '');
    b.innerHTML = `<span class="ic">${item.emoji}</span>
      <span><span class="nm">${item.name}</span><br>
      <span class="cost">${costLine(def.cost)}</span>
      ${why ? `<br><span class="why">${why}</span>` : ''}</span>`;
    b.onclick = () => {
      if (tier < def.tier) return;
      if (kind === 'r') act('craft', { id });
      else {
        state.buildSel = id;
        openCat(-1);
        log('sys', `Placing ${item.name} — click a tile (Shift-click for more, Esc to cancel).`);
      }
    };
    el.appendChild(b);
  }
}

// ---------- panels ----------
const PANELS = ['catalogue', 'cratebox', 'firebox'];
export function togglePanel(id) {
  if (id === 'craft') { openCat(activeCat >= 0 ? -1 : 0); return; }
  if (id === 'buildmenu') { openCat(5); return; }
  const show = $(id).style.display !== 'block';
  closeAll();
  if (show) { $(id).style.display = 'block'; if (id === 'catalogue') refreshPanels(); }
}
export function closeAll() {
  PANELS.forEach(p => $(p).style.display = 'none');
  openCat(-1);
  state.crate = null;
}

export function refreshPanels() {
  const cat = $('cataloguelist');
  if (!cat) return;
  cat.innerHTML = '';
  const head = document.createElement('div');
  const parts = WORMHOLE_PARTS.map(p =>
    `${state.team?.parts?.[p] ? '✅' : '⬜'} ${ITEMS[p].emoji} ${ITEMS[p].name}`).join('<br>');
  head.innerHTML = `<small style="color:var(--dim)">Tier ${state.team?.tier} · ${state.team?.rp} RP
    · next tier at ${TIER_RP[Math.min(3, (state.team?.tier ?? 1) + 1)]} RP</small>
    <div style="margin:6px 0;color:var(--teal)">🌀 Wormhole repair<br>${parts}</div>`;
  cat.appendChild(head);
  const entries = [
    ...Object.entries(CREATURES).map(([k, v]) => ['c:' + k, v.emoji, v.name, 'fauna']),
    ...Object.entries(RESOURCES).map(([k, v]) => ['o:' + k, v.emoji, v.name, 'flora/geo']),
    ['o:wormhole', '🌀', 'Wormhole anomaly', 'anomaly'],
  ];
  let done = 0;
  for (const [key, emoji, label, kind] of entries) {
    const who = state.team?.catalogue?.[key];
    if (who) done++;
    const d = document.createElement('div');
    d.className = 'rowbtn' + (who ? '' : ' off');
    d.innerHTML = who ? `${emoji} ${label}<small>${kind} · catalogued by ${who}</small>`
      : `❓ Unknown specimen<small>scan with [F]</small>`;
    cat.appendChild(d);
  }
  head.innerHTML = `<small style="color:var(--dim)">${done}/${entries.length} catalogued</small>` + head.innerHTML;
}

// ---------- crate ----------
export function showCrate() {
  const crate = state.crate; // closeAll() clears it
  closeAll();
  state.crate = crate;
  $('cratebox').style.display = 'block';
  const el = $('crateinv'); el.innerHTML = '';
  if (!crate) return;
  if (!crate.inv.length) el.innerHTML = '<small style="color:var(--dim)">Empty. Click items in your inventory to store them.</small>';
  crate.inv.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'rowbtn';
    let extra = '';
    if (s.fresh != null) extra = ` · ${Math.round(s.fresh * 100)}% fresh`;
    b.innerHTML = `${ITEMS[s.id].emoji} ${ITEMS[s.id].name} ×${s.n}<small>click to take${extra}</small>`;
    b.onclick = () => act('take', { obj: crate.i, slot: i });
    el.appendChild(b);
  });
}
export function hideCrate() { $('cratebox').style.display = 'none'; }

// ---------- campfire ----------
export function showCampfire(objId) {
  closeAll();
  $('firebox').style.display = 'block';
  const el = $('firelist'); el.innerHTML = '';
  const actions = [
    ['🥩→🍖 Cook raw meat', () => act('cook', { obj: objId })],
    ['🥃→💧 Boil murky flask', () => act('boil', { obj: objId })],
    ['🪵 Add fuel (wood/fiber)', () => act('fuel', { obj: objId })],
  ];
  for (const [label, fn] of actions) {
    const b = document.createElement('button');
    b.className = 'rowbtn'; b.textContent = label; b.onclick = fn;
    el.appendChild(b);
  }
}

// ---------- hint line ----------
export function refreshHint() {
  const o = nearestInteractable();
  const el = $('hint');
  if (!o || state.dead) { el.style.display = 'none'; return; }
  const info = RESOURCES[o.ty] || STRUCTURES[o.ty];
  const emoji = info?.emoji || (o.ty === 'wormhole' ? '🌀' : o.ty === 'bag' ? '🎒' : '');
  const name = info?.name || (o.ty === 'wormhole' ? 'Wormhole' : o.ty === 'bag' ? 'Dropped items' : o.ty);
  let verb = 'interact';
  if (RESOURCES[o.ty]) verb = o.ready === false ? 'depleted' : 'gather';
  else if (o.ty === 'campfire') verb = 'cook / boil / fuel';
  else if (o.ty === 'cookpot') verb = 'craft meals here [C → 🍲]';
  else if (o.ty === 'crate') verb = 'open';
  else if (o.ty === 'door') verb = o.open ? 'close' : 'open';
  else if (o.ty === 'bed') verb = state.you?.sleeping ? 'wake up' : 'sleep / set respawn';
  else if (o.ty === 'wormhole') verb = 'install parts / activate';
  else if (o.ty === 'bag') verb = 'pick up';
  el.innerHTML = `[E] ${emoji} ${name} — ${verb}`;
  el.style.display = 'block';
}

// ---------- chat & log ----------
export function log(cls, m) {
  const el = $('log');
  const d = document.createElement('div');
  if (cls === 'sys') d.className = 'sys';
  d.textContent = m;
  el.appendChild(d);
  while (el.children.length > 8) el.removeChild(el.firstChild);
  setTimeout(() => { if (d.parentNode) d.style.opacity = 0.5; }, 9000);
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
