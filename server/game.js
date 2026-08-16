// Authoritative game simulation: world state, survival stats, creatures, crafting,
// building, research, and the wormhole objective. The server owns all truth;
// clients only send inputs/actions and render snapshots.
import {
  T, TILE_INFO, WORLD_W, WORLD_H, DAY_LENGTH, DAYS_PER_SEASON, SEASONS, SEASON_TEMP,
  ITEMS, RECIPES, STRUCTURES, CREATURES, RESOURCES, WORMHOLE_PARTS, TIER_RP,
  INV_SLOTS, recipeById,
} from '../shared/defs.js';
import { generateWorld, mulberry32 } from './worldgen.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

export class Game {
  constructor(save) {
    this.seed = save?.seed ?? (Math.random() * 2 ** 31) | 0;
    const gen = generateWorld(this.seed);
    this.tiles = gen.tiles;
    this.wormhole = gen.wormhole;
    this.nextId = save?.nextId ?? gen.nextId;
    this.t = save?.t ?? DAY_LENGTH * 0.3; // start mid-morning of day 0
    this.team = save?.team ?? { rp: 0, tier: 1, catalogue: {}, parts: {}, win: false };

    this.objects = new Map();
    const objList = save?.objects ?? gen.objects;
    for (const o of objList) this.objects.set(o.i, o);
    if (!save) {
      // the wormhole itself is a world object
      const wh = { i: this.nextId++, ty: 'wormhole', x: this.wormhole.x, y: this.wormhole.y };
      this.objects.set(wh.i, wh);
    }

    this.blocked = new Map(); // "x,y" -> object id, for blocking objects
    for (const o of this.objects.values()) this.refreshBlock(o);

    this.players = new Map();          // id -> live player
    this.savedPlayers = save?.players ?? {}; // name -> persisted player state
    this.creatures = new Map();
    this.rng = mulberry32(this.seed ^ 0x9e3779b9);
    this.events = [];                  // broadcast queue, flushed each snapshot
    this.spawnTimer = 0;
    this.sweepTimer = 0;
    this.nextPid = 1;

    this.populateCreatures();
  }

  // ---------- helpers ----------
  tileAt(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return T.DEEP;
    return this.tiles[ty * WORLD_W + tx];
  }
  isBlocking(o) {
    if (o.ty === 'wormhole') return true;
    if (o.ty === 'bag') return false;
    const s = STRUCTURES[o.ty];
    if (s) return s.door ? !o.open : s.block;
    const r = RESOURCES[o.ty];
    return r ? (r.block && o.ready !== false) : false;
  }
  refreshBlock(o) {
    const key = o.x + ',' + o.y;
    if (this.isBlocking(o)) this.blocked.set(key, o.i);
    else if (this.blocked.get(key) === o.i) this.blocked.delete(key);
  }
  walkable(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return false;
    if (!TILE_INFO[this.tiles[ty * WORLD_W + tx]].walk) return false;
    return !this.blocked.has(tx + ',' + ty);
  }
  emit(ev) { this.events.push(ev); }
  msg(p, m) { p.mail.push({ t: 'msg', m }); }
  objPatch(o, patch) { Object.assign(o, patch); this.refreshBlock(o); this.emit({ t: 'obj*', i: o.i, p: patch }); }
  addObject(o) { this.objects.set(o.i, o); this.refreshBlock(o); this.emit({ t: 'obj+', o: this.serObj(o) }); return o; }
  delObject(o) {
    this.objects.delete(o.i);
    const key = o.x + ',' + o.y;
    if (this.blocked.get(key) === o.i) this.blocked.delete(key);
    this.emit({ t: 'obj-', i: o.i });
  }
  serObj(o) {
    const s = { i: o.i, ty: o.ty, x: o.x, y: o.y };
    if (o.ready === false) s.ready = false;
    if (o.lit) s.lit = true;
    if (o.open) s.open = true;
    return s;
  }

  // ---------- time / environment ----------
  get day() { return Math.floor(this.t / DAY_LENGTH); }
  get tod() { return (this.t % DAY_LENGTH) / DAY_LENGTH; } // 0 = midnight
  get seasonIdx() { return Math.floor(this.day / DAYS_PER_SEASON) % 4; }
  get isNight() { const td = this.tod; return td < 0.22 || td > 0.78; }
  ambientAt(x, y) {
    const base = SEASON_TEMP[this.seasonIdx];
    const diurnal = Math.sin((this.tod - 0.25) * Math.PI * 2) * 7;
    const mod = TILE_INFO[this.tileAt(x, y)].tempMod || 0;
    return base + diurnal + mod;
  }
  nearLitFire(x, y) {
    for (const o of this.objects.values())
      if (o.ty === 'campfire' && o.lit && dist2(o.x + 0.5, o.y + 0.5, x, y) < 16) return true;
    return false;
  }
  nearStructure(p, ty, r = 3) {
    for (const o of this.objects.values())
      if (o.ty === ty && dist2(o.x + 0.5, o.y + 0.5, p.x, p.y) < r * r) return o;
    return null;
  }

  // ---------- inventory ----------
  addItem(inv, id, n, uses) {
    const def = ITEMS[id];
    for (let i = 0; i < inv.length && n > 0; i++) {
      const s = inv[i];
      if (s && s.id === id && def.stack > 1 && s.n < def.stack) {
        const add = Math.min(n, def.stack - s.n); s.n += add; n -= add;
      }
    }
    for (let i = 0; i < inv.length && n > 0; i++) {
      if (!inv[i]) {
        const put = Math.min(n, def.stack);
        inv[i] = { id, n: put };
        if (def.tool) inv[i].uses = uses ?? def.tool.uses;
        n -= put;
      }
    }
    return n; // leftover that didn't fit
  }
  countItem(inv, id) { return inv.reduce((a, s) => a + (s && s.id === id ? s.n : 0), 0); }
  removeItem(inv, id, n) {
    for (let i = 0; i < inv.length && n > 0; i++) {
      const s = inv[i];
      if (s && s.id === id) {
        const take = Math.min(n, s.n); s.n -= take; n -= take;
        if (s.n <= 0) inv[i] = null;
      }
    }
  }
  canAfford(inv, cost) { return Object.entries(cost).every(([id, n]) => this.countItem(inv, id) >= n); }
  payCost(inv, cost) { for (const [id, n] of Object.entries(cost)) this.removeItem(inv, id, n); }

  // ---------- players ----------
  spawnPoint() { return { x: this.wormhole.x + 2.5, y: this.wormhole.y + 2.5 }; }

  addPlayer(name) {
    const saved = this.savedPlayers[name];
    const sp = saved?.spawn ?? this.spawnPoint();
    const p = saved ? { ...saved } : {
      name, x: sp.x, y: sp.y, spawn: { ...sp },
      hp: 100, hunger: 100, thirst: 100, stam: 100, temp: 37,
      fx: { bleed: false, bleedT: 0, parasites: false, spore: false, infection: false },
      inv: Array(INV_SLOTS).fill(null), handSlot: -1, bodySlot: -1,
      dead: false, respawnIn: 0,
    };
    p.id = this.nextPid++;
    p.input = { mx: 0, my: 0, sprint: false };
    p.aim = 0;
    p.cool = 0;           // action cooldown
    p.hitCool = 0;        // last hit flash (client)
    p.mail = [];          // private messages this snapshot
    p.exposure = 0;
    this.players.set(p.id, p);
    return p;
  }
  removePlayer(p) {
    this.savedPlayers[p.name] = this.persistPlayer(p);
    this.players.delete(p.id);
  }
  persistPlayer(p) {
    const { name, x, y, spawn, hp, hunger, thirst, stam, temp, fx, inv, handSlot, bodySlot, dead, respawnIn } = p;
    return { name, x, y, spawn, hp, hunger, thirst, stam, temp, fx, inv, handSlot, bodySlot, dead, respawnIn };
  }
  equipped(p, slotField) {
    const idx = p[slotField];
    return idx >= 0 ? p.inv[idx] : null;
  }
  handTool(p) {
    const s = this.equipped(p, 'handSlot');
    return s ? ITEMS[s.id]?.tool : null;
  }
  useTool(p) {
    const idx = p.handSlot;
    const s = idx >= 0 ? p.inv[idx] : null;
    if (!s || !ITEMS[s.id].tool) return;
    s.uses--;
    if (s.uses <= 0) {
      this.msg(p, `${ITEMS[s.id].name} broke!`);
      p.inv[idx] = null; p.handSlot = -1;
    }
  }
  killPlayer(p, cause) {
    p.dead = true; p.respawnIn = 8;
    p.hp = 0;
    // drop everything in a loot bag
    const items = p.inv.filter(Boolean);
    if (items.length) {
      this.addObject({
        i: this.nextId++, ty: 'bag',
        x: Math.floor(p.x), y: Math.floor(p.y), inv: items,
      });
    }
    p.inv = Array(INV_SLOTS).fill(null); p.handSlot = -1; p.bodySlot = -1;
    this.emit({ t: 'chat', from: '☠', m: `${p.name} died (${cause}).` });
  }
  respawn(p) {
    p.dead = false;
    p.hp = 60; p.hunger = 55; p.thirst = 55; p.stam = 80; p.temp = 37;
    p.fx = { bleed: false, bleedT: 0, parasites: false, spore: false, infection: false };
    p.x = p.spawn.x; p.y = p.spawn.y;
    // if their bed was destroyed, fall back to the wormhole
    if (!this.walkable(p.x, p.y)) { const s = this.spawnPoint(); p.x = s.x; p.y = s.y; }
  }

  // ---------- creatures ----------
  populateCreatures() {
    let placed = 0, guard = 0;
    while (placed < 90 && guard++ < 4000) {
      const x = 1 + this.rng() * (WORLD_W - 2), y = 1 + this.rng() * (WORLD_H - 2);
      const tile = this.tileAt(x, y);
      const opts = Object.entries(CREATURES).filter(([, c]) => !c.night && c.tiles.includes(tile));
      if (!opts.length || !this.walkable(x, y)) continue;
      const [sp] = opts[Math.floor(this.rng() * opts.length)];
      this.spawnCreature(sp, x, y);
      placed++;
    }
  }
  spawnCreature(sp, x, y) {
    const def = CREATURES[sp];
    const c = {
      i: this.nextId++, sp, x, y, hp: def.hp,
      state: 'idle', tx: x, ty: y, think: this.rng() * 2, atkCool: 0, target: 0,
      home: { x, y },
    };
    this.creatures.set(c.i, c);
    return c;
  }
  killCreature(c, killer) {
    const def = CREATURES[c.sp];
    if (killer) {
      for (const d of def.drops)
        if (this.rng() < d.p) {
          const left = this.addItem(killer.inv, d.item, d.n);
          if (left) this.addObject({ i: this.nextId++, ty: 'bag', x: Math.floor(c.x), y: Math.floor(c.y), inv: [{ id: d.item, n: left }] });
        }
      this.msg(killer, `${def.name} killed.`);
    }
    this.creatures.delete(c.i);
  }
  tickCreature(c, dt) {
    const def = CREATURES[c.sp];
    c.think -= dt; c.atkCool -= dt;

    // daybreak: night stalkers dissolve
    if (def.night && !this.isNight) { this.creatures.delete(c.i); return; }

    if (c.think <= 0) {
      c.think = 0.4 + this.rng() * 0.5;
      // find nearest living player
      let best = null, bd = Infinity;
      for (const p of this.players.values()) {
        if (p.dead) continue;
        const d = dist2(p.x, p.y, c.x, c.y);
        if (d < bd) { bd = d; best = p; }
      }
      const d = Math.sqrt(bd);
      if (c.state === 'flee') {
        if (d > 12 || !best) c.state = 'idle';
        else { c.tx = c.x + (c.x - best.x) / d * 6; c.ty = c.y + (c.y - best.y) / d * 6; }
      } else if (c.state === 'chase') {
        if (!best || d > 14) { c.state = 'idle'; }
        else { c.tx = best.x; c.ty = best.y; c.target = best.id; }
      } else {
        if (best && def.aggro && d < def.aggro) { c.state = 'chase'; }
        else if (this.rng() < 0.3) { // wander near home
          c.tx = c.home.x + (this.rng() - 0.5) * 8;
          c.ty = c.home.y + (this.rng() - 0.5) * 8;
        }
      }
    }

    // movement toward (tx,ty)
    const dx = c.tx - c.x, dy = c.ty - c.y;
    const d = Math.hypot(dx, dy);
    const spd = def.speed * (c.state === 'idle' ? 0.5 : 1);
    if (d > 0.15) {
      const nx = c.x + (dx / d) * spd * dt, ny = c.y + (dy / d) * spd * dt;
      if (this.walkable(nx, c.y)) c.x = nx;
      if (this.walkable(c.x, ny)) c.y = ny;
    }

    // melee
    if (c.state === 'chase' && c.atkCool <= 0) {
      const p = this.players.get(c.target);
      if (p && !p.dead && dist2(p.x, p.y, c.x, c.y) < 1.1) {
        c.atkCool = 1.2;
        this.hurtPlayer(p, def.dmg, def.name);
        if (this.rng() < 0.3 && !p.fx.bleed) { p.fx.bleed = true; p.fx.bleedT = 0; this.msg(p, 'You are bleeding! Use a bandage.'); }
      }
    }
  }
  hurtPlayer(p, dmg, cause) {
    if (p.dead) return;
    p.hp -= dmg;
    p.hitCool = 0.4;
    if (p.hp <= 0) this.killPlayer(p, cause);
  }
  hurtCreature(c, dmg, attacker) {
    c.hp -= dmg;
    if (c.hp <= 0) { this.killCreature(c, attacker); return; }
    const def = CREATURES[c.sp];
    if (def.flee) c.state = 'flee';
    else if (def.retaliate || def.aggro) { c.state = 'chase'; c.target = attacker.id; }
    c.think = 0;
  }
  spawnPass(dt) {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = 6;
    // night hostiles near players
    if (this.isNight) {
      for (const p of this.players.values()) {
        if (p.dead) continue;
        let near = 0;
        for (const c of this.creatures.values())
          if (CREATURES[c.sp].night && dist2(c.x, c.y, p.x, p.y) < 30 * 30) near++;
        if (near < 2 && this.rng() < 0.35) {
          const ang = this.rng() * Math.PI * 2, r = 11 + this.rng() * 4;
          const x = p.x + Math.cos(ang) * r, y = p.y + Math.sin(ang) * r;
          if (this.walkable(x, y)) this.spawnCreature('spinehound', x, y);
        }
      }
    }
    // keep ambient wildlife population up
    let ambient = 0;
    for (const c of this.creatures.values()) if (!CREATURES[c.sp].night) ambient++;
    if (ambient < 90 && this.rng() < 0.6) {
      const x = 1 + this.rng() * (WORLD_W - 2), y = 1 + this.rng() * (WORLD_H - 2);
      const tile = this.tileAt(x, y);
      let farEnough = true;
      for (const p of this.players.values())
        if (dist2(p.x, p.y, x, y) < 24 * 24) farEnough = false;
      if (farEnough && this.walkable(x, y)) {
        const opts = Object.entries(CREATURES).filter(([, c]) => !c.night && c.tiles.includes(tile));
        if (opts.length) this.spawnCreature(opts[Math.floor(this.rng() * opts.length)][0], x, y);
      }
    }
  }

  // ---------- survival stats ----------
  tickPlayer(p, dt) {
    if (p.dead) {
      p.respawnIn -= dt;
      if (p.respawnIn <= 0) this.respawn(p);
      return;
    }
    p.cool = Math.max(0, p.cool - dt);
    p.hitCool = Math.max(0, p.hitCool - dt);

    // --- movement ---
    const { mx, my, sprint } = p.input;
    const moving = mx || my;
    const tile = this.tileAt(p.x, p.y);
    const sprinting = sprint && moving && p.stam > 1;
    let spd = sprinting ? 6.4 : 4.2;
    if (TILE_INFO[tile].slow) spd *= TILE_INFO[tile].slow;
    if (p.hp < 25) spd *= 0.8;
    if (moving) {
      const len = Math.hypot(mx, my) || 1;
      const nx = p.x + (mx / len) * spd * dt, ny = p.y + (my / len) * spd * dt;
      if (this.walkable(nx, p.y)) p.x = nx;
      if (this.walkable(p.x, ny)) p.y = ny;
      p.x = clamp(p.x, 0.5, WORLD_W - 0.5); p.y = clamp(p.y, 0.5, WORLD_H - 0.5);
    }

    // --- temperature ---
    let eff = this.ambientAt(p.x, p.y);
    if (this.nearLitFire(p.x, p.y)) eff += 14;
    const body = this.equipped(p, 'bodySlot');
    const hand = this.equipped(p, 'handSlot');
    if (eff < 18) { // insulation only matters against cold
      if (body && ITEMS[body.id].warm) eff += ITEMS[body.id].warm;
      if (hand && ITEMS[hand.id].warm) eff += ITEMS[hand.id].warm;
    }
    const target = 37 + (eff - 18) * 0.30;
    p.temp += (target - p.temp) * (dt / 50);
    const cold = p.temp < 33, hot = p.temp > 39.5;

    // --- hunger / thirst / stamina ---
    const par = p.fx.parasites ? 1.7 : 1;
    p.hunger -= (100 / (22 * 60)) * par * (sprinting ? 1.6 : 1) * dt;
    p.thirst -= (100 / (13 * 60)) * par * (hot ? 2 : 1) * (sprinting ? 1.5 : 1) * dt;
    p.hunger = clamp(p.hunger, 0, 100); p.thirst = clamp(p.thirst, 0, 100);

    const stamMax = p.fx.spore ? 60 : 100;
    if (sprinting) p.stam -= 13 * dt;
    else if (!cold && p.hunger > 12) p.stam += (moving ? 4 : 9) * dt;
    p.stam = clamp(p.stam, 0, stamMax);

    // --- health ---
    let dhp = 0;
    if (p.hunger <= 0) dhp -= 0.6;
    if (p.thirst <= 0) dhp -= 1.0;
    if (cold) dhp -= p.temp < 30 ? 1.2 : 0.5;
    if (p.temp > 40.5) dhp -= 0.4;
    if (p.fx.bleed) {
      dhp -= 0.4;
      p.fx.bleedT += dt;
      if (p.fx.bleedT > 120 && !p.fx.infection) {
        p.fx.infection = true;
        this.msg(p, 'Your wound is infected. Craft a remedy!');
      }
    }
    if (p.fx.infection) dhp -= 0.3;
    if (p.fx.spore) dhp -= 0.1;
    if (dhp === 0 && p.hunger > 60 && p.thirst > 60 && !p.fx.infection && !p.fx.parasites) dhp = 0.5; // regen
    p.hp = clamp(p.hp + dhp * dt, 0, 100);
    if (p.hp <= 0) {
      const cause = p.thirst <= 0 ? 'dehydration' : p.hunger <= 0 ? 'starvation'
        : cold ? 'hypothermia' : p.fx.infection ? 'infection' : 'their injuries';
      this.killPlayer(p, cause);
      return;
    }

    // --- environmental disease exposure ---
    if (TILE_INFO[tile].sporeRisk && !p.fx.spore) {
      p.exposure += dt;
      if (p.exposure > 20 && this.rng() < 0.004) {
        p.fx.spore = true; p.exposure = 0;
        this.msg(p, 'You inhaled alien spores — spore sickness sets in (stamina crippled). Craft a remedy.');
      }
    } else if (!TILE_INFO[tile].sporeRisk) p.exposure = Math.max(0, p.exposure - dt);
  }

  // ---------- structures with ongoing behavior ----------
  sweepObjects(dt) {
    this.sweepTimer -= dt;
    if (this.sweepTimer > 0) return;
    const step = 1; this.sweepTimer = step;
    for (const o of this.objects.values()) {
      if (o.ty === 'campfire' && o.lit) {
        o.fuel -= step;
        if (o.fuel <= 0) { o.fuel = 0; this.objPatch(o, { lit: false }); }
      } else if (o.ty === 'condenser') {
        o.water = Math.min(3, (o.water || 0) + step / 45);
      } else if (RESOURCES[o.ty] && o.ready === false && this.t >= o.regrowAt) {
        o.hp = RESOURCES[o.ty].hits;
        this.objPatch(o, { ready: true });
      }
    }
  }

  // ---------- actions ----------
  findObj(id, p, r = 2.2) {
    const o = this.objects.get(id);
    if (!o) return null;
    return dist2(o.x + 0.5, o.y + 0.5, p.x, p.y) <= r * r ? o : null;
  }

  action(p, a) {
    if (p.dead) return;
    switch (a.k) {
      case 'attack': return this.doAttack(p, a);
      case 'interact': return this.doInteract(p, a);
      case 'scan': return this.doScan(p);
      case 'use': return this.doUse(p, a.slot | 0);
      case 'drop': return this.doDrop(p, a.slot | 0);
      case 'craft': return this.doCraft(p, a.id);
      case 'build': return this.doBuild(p, a);
      case 'cook': return this.doCook(p, a, 'raw_meat', 'cooked_meat', 'Meat cooked.');
      case 'boil': return this.doCook(p, a, 'flask_dirty', 'flask_clean', 'Water purified.');
      case 'fuel': return this.doFuel(p, a);
      case 'open': { const o = this.findObj(a.obj, p); if (o?.ty === 'crate') p.mail.push({ t: 'crate', i: o.i, inv: o.inv }); return; }
      case 'store': return this.doStore(p, a);
      case 'take': return this.doTake(p, a);
    }
  }

  doAttack(p, a) {
    if (p.cool > 0 || p.stam < 4) return;
    p.cool = 0.5; p.stam -= 6;
    p.aim = a.aim ?? p.aim;
    const tool = this.handTool(p);
    const dmg = tool ? tool.dmg : 5;
    const fx = Math.cos(p.aim), fy = Math.sin(p.aim);
    // creatures first
    let best = null, bd = Infinity, bestIsObj = false;
    for (const c of this.creatures.values()) {
      const dx = c.x - p.x, dy = c.y - p.y, d = Math.hypot(dx, dy);
      if (d < 1.8 && (dx * fx + dy * fy) / (d || 1) > 0.3 && d < bd) { best = c; bd = d; }
    }
    if (!best) { // then structures (demolition)
      for (const o of this.objects.values()) {
        if (!STRUCTURES[o.ty]) continue;
        const dx = o.x + 0.5 - p.x, dy = o.y + 0.5 - p.y, d = Math.hypot(dx, dy);
        if (d < 1.8 && (dx * fx + dy * fy) / (d || 1) > 0.3 && d < bd) { best = o; bd = d; bestIsObj = true; }
      }
    }
    if (!best) return;
    this.useTool(p);
    if (bestIsObj) {
      best.hp -= dmg;
      if (best.hp <= 0) {
        if (best.inv) for (const s of best.inv) if (s) this.addItem(p.inv, s.id, s.n, s.uses);
        this.delObject(best);
        this.msg(p, `${STRUCTURES[best.ty].name} demolished.`);
      }
    } else this.hurtCreature(best, dmg, p);
  }

  doInteract(p, a) {
    const o = this.findObj(a.obj, p);
    if (!o || p.cool > 0) return;

    if (RESOURCES[o.ty]) return this.doGather(p, o);

    switch (o.ty) {
      case 'bag': {
        for (const s of o.inv) if (s) this.addItem(p.inv, s.id, s.n, s.uses);
        this.delObject(o);
        this.msg(p, 'Picked up dropped items.');
        return;
      }
      case 'door': this.objPatch(o, { open: !o.open }); return;
      case 'bed':
        p.spawn = { x: o.x + 0.5, y: o.y + 1.5 };
        this.msg(p, 'Respawn point set to this cot.');
        return;
      case 'condenser': {
        if ((o.water || 0) < 1) return this.msg(p, `Condenser still collecting dew (${Math.floor((o.water || 0) * 100)}%).`);
        if (this.countItem(p.inv, 'flask_empty') < 1) return this.msg(p, 'You need an empty flask.');
        this.removeItem(p.inv, 'flask_empty', 1);
        this.addItem(p.inv, 'flask_clean', 1);
        o.water -= 1;
        this.msg(p, 'Flask filled with purified water.');
        return;
      }
      case 'wormhole': return this.doWormhole(p);
      case 'campfire': case 'crate': case 'bench': return; // handled via dedicated actions / client UI
    }

    // drinking from adjacent water tiles is handled by 'interact' with obj=0 + client fallback
  }

  // drink straight from a water tile (risky) or fill an empty flask with murky water
  drinkWater(p, fill) {
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]].some(([dx, dy]) =>
      TILE_INFO[this.tileAt(p.x + dx, p.y + dy)].water);
    if (!near) return this.msg(p, 'No water nearby.');
    if (fill) {
      if (this.countItem(p.inv, 'flask_empty') < 1) return this.msg(p, 'No empty flask.');
      this.removeItem(p.inv, 'flask_empty', 1);
      this.addItem(p.inv, 'flask_dirty', 1);
      return this.msg(p, 'Flask filled with murky water — boil it at a campfire.');
    }
    p.thirst = clamp(p.thirst + 30, 0, 100);
    if (!p.fx.parasites && this.rng() < 0.25) {
      p.fx.parasites = true;
      this.msg(p, 'The water tasted wrong… parasites! (hunger & thirst drain fast). Craft a remedy.');
    } else this.msg(p, 'You drink from the stream.');
    p.cool = 0.8;
  }

  doGather(p, o) {
    const def = RESOURCES[o.ty];
    if (o.ready === false) return this.msg(p, `${def.name} is depleted.`);
    if (p.stam < 4) return this.msg(p, 'Too exhausted.');
    const tool = this.handTool(p);
    if (def.tool && (!tool || tool.kind !== def.tool))
      return this.msg(p, `You need a ${def.tool === 'axe' ? 'field axe' : 'geo pick'} for that.`);
    p.cool = 0.55; p.stam -= 5;
    if (def.tool) this.useTool(p);
    for (const [id, n] of Object.entries(def.drop)) {
      const left = this.addItem(p.inv, id, n);
      if (left) this.msg(p, 'Inventory full!');
    }
    o.hp = (o.hp ?? def.hits) - 1;
    if (o.hp <= 0) {
      if (def.regrow > 0) { o.regrowAt = this.t + def.regrow; this.objPatch(o, { ready: false }); }
      else this.delObject(o); // debris is finite
    }
  }

  doScan(p) {
    if (p.cool > 0) return;
    p.cool = 1;
    // nearest unscanned species: creatures (3.5 tiles) then flora/objects (2.5)
    let sp = null, rp = 0, label = '';
    let bd = 3.5 * 3.5;
    for (const c of this.creatures.values()) {
      const d = dist2(c.x, c.y, p.x, p.y);
      if (d < bd) { bd = d; sp = 'c:' + c.sp; rp = CREATURES[c.sp].rp; label = CREATURES[c.sp].name; }
    }
    if (!sp) {
      bd = 2.5 * 2.5;
      for (const o of this.objects.values()) {
        const isScannable = RESOURCES[o.ty] || o.ty === 'wormhole';
        if (!isScannable) continue;
        const d = dist2(o.x + 0.5, o.y + 0.5, p.x, p.y);
        if (d < bd) {
          bd = d; sp = 'o:' + o.ty;
          rp = o.ty === 'wormhole' ? 12 : RESOURCES[o.ty].rp;
          label = o.ty === 'wormhole' ? 'Wormhole anomaly' : RESOURCES[o.ty].name;
        }
      }
    }
    if (!sp) return this.msg(p, 'Nothing in scanner range.');
    if (this.team.catalogue[sp]) return this.msg(p, `${label}: already catalogued.`);
    this.team.catalogue[sp] = p.name;
    this.team.rp += rp;
    while (this.team.tier < 3 && this.team.rp >= TIER_RP[this.team.tier + 1]) {
      this.team.tier++;
      this.emit({ t: 'chat', from: '📡', m: `Research tier ${this.team.tier} unlocked!` });
    }
    this.emit({ t: 'team', team: this.team });
    this.emit({ t: 'chat', from: '📡', m: `${p.name} catalogued ${label} (+${rp} RP).` });
  }

  doUse(p, slot) {
    const s = p.inv[slot];
    if (!s) return;
    const def = ITEMS[s.id];
    if (def.equip) { // toggle equip
      const field = def.equip === 'hand' ? 'handSlot' : 'bodySlot';
      p[field] = p[field] === slot ? -1 : slot;
      return;
    }
    if (def.bandage) {
      if (!p.fx.bleed) return this.msg(p, 'No bleeding to treat.');
      p.fx.bleed = false; p.fx.bleedT = 0;
      s.n--; if (s.n <= 0) p.inv[slot] = null;
      return this.msg(p, 'Bleeding stopped.');
    }
    if (def.cure) {
      if (!p.fx.parasites && !p.fx.spore && !p.fx.infection) return this.msg(p, 'You are not sick.');
      p.fx.parasites = p.fx.spore = p.fx.infection = false;
      s.n--; if (s.n <= 0) p.inv[slot] = null;
      return this.msg(p, 'The remedy purges the sickness.');
    }
    if (def.food || def.water) {
      if (def.food) p.hunger = clamp(p.hunger + def.food, 0, 100);
      if (def.water) p.thirst = clamp(p.thirst + def.water, 0, 100);
      if (def.sickRisk && !p.fx.parasites && this.rng() < def.sickRisk) {
        p.fx.parasites = true;
        this.msg(p, 'That was a mistake… parasites! Craft a remedy.');
      }
      s.n--; if (s.n <= 0) p.inv[slot] = null;
      if (p.inv[slot] === null && p.handSlot === slot) p.handSlot = -1;
      if (def.toFlask) this.addItem(p.inv, def.toFlask, 1);
      return;
    }
  }

  doDrop(p, slot) {
    const s = p.inv[slot];
    if (!s) return;
    p.inv[slot] = null;
    if (p.handSlot === slot) p.handSlot = -1;
    if (p.bodySlot === slot) p.bodySlot = -1;
    // merge into an existing bag on this tile if any
    const tx = Math.floor(p.x), ty = Math.floor(p.y);
    for (const o of this.objects.values())
      if (o.ty === 'bag' && o.x === tx && o.y === ty) { o.inv.push(s); return; }
    this.addObject({ i: this.nextId++, ty: 'bag', x: tx, y: ty, inv: [s] });
  }

  doCraft(p, id) {
    const r = recipeById(id);
    if (!r) return;
    if (this.team.tier < r.tier) return this.msg(p, `Requires research tier ${r.tier}.`);
    if (r.station === 'campfire' && !this.nearStructure(p, 'campfire')) return this.msg(p, 'Must be near a campfire.');
    if (r.station === 'bench' && !this.nearStructure(p, 'bench')) return this.msg(p, 'Must be near a research bench.');
    if (!this.canAfford(p.inv, r.cost)) return this.msg(p, 'Missing materials.');
    this.payCost(p.inv, r.cost);
    const left = this.addItem(p.inv, id, 1);
    if (left) { this.addObject({ i: this.nextId++, ty: 'bag', x: Math.floor(p.x), y: Math.floor(p.y), inv: [{ id, n: 1 }] }); }
    this.msg(p, `Crafted ${ITEMS[id].name}.`);
  }

  doBuild(p, a) {
    const s = STRUCTURES[a.s];
    if (!s) return;
    const tx = a.tx | 0, ty = a.ty | 0;
    if (this.team.tier < s.tier) return this.msg(p, `Requires research tier ${s.tier}.`);
    if (dist2(tx + 0.5, ty + 0.5, p.x, p.y) > 5 * 5) return this.msg(p, 'Too far away.');
    if (!TILE_INFO[this.tileAt(tx + 0.5, ty + 0.5)].walk) return this.msg(p, "Can't build there.");
    if (this.blocked.has(tx + ',' + ty)) return this.msg(p, 'Something is in the way.');
    for (const o of this.objects.values())
      if (o.x === tx && o.y === ty && o.ty !== 'bag') return this.msg(p, 'Something is in the way.');
    if (Math.floor(p.x) === tx && Math.floor(p.y) === ty && s.block) return this.msg(p, "You're standing there.");
    if (!this.canAfford(p.inv, s.cost)) return this.msg(p, 'Missing materials.');
    this.payCost(p.inv, s.cost);
    const o = { i: this.nextId++, ty: a.s, x: tx, y: ty, hp: s.hp };
    if (a.s === 'campfire') { o.fuel = 60; o.lit = true; }
    if (a.s === 'crate') o.inv = [];
    if (a.s === 'condenser') o.water = 0;
    this.addObject(o);
    this.msg(p, `${s.name} built.`);
  }

  doCook(p, a, from, to, okMsg) {
    const o = this.findObj(a.obj, p);
    if (!o || o.ty !== 'campfire') return;
    if (!o.lit) return this.msg(p, 'The fire is out — add fuel.');
    if (this.countItem(p.inv, from) < 1) return this.msg(p, `Nothing to ${from === 'raw_meat' ? 'cook' : 'boil'}.`);
    if (p.cool > 0) return;
    p.cool = 0.6;
    this.removeItem(p.inv, from, 1);
    this.addItem(p.inv, to, 1);
    this.msg(p, okMsg);
  }

  doFuel(p, a) {
    const o = this.findObj(a.obj, p);
    if (!o || o.ty !== 'campfire') return;
    const use = this.countItem(p.inv, 'wood') ? 'wood' : this.countItem(p.inv, 'fiber') ? 'fiber' : null;
    if (!use) return this.msg(p, 'No fuel (wood or fiber) in inventory.');
    this.removeItem(p.inv, use, 1);
    o.fuel = Math.min(300, (o.fuel || 0) + ITEMS[use].fuel);
    if (!o.lit) this.objPatch(o, { lit: true });
    this.msg(p, `Fire fueled (${Math.round(o.fuel)}s).`);
  }

  doStore(p, a) {
    const o = this.findObj(a.obj, p);
    if (!o || o.ty !== 'crate') return;
    const s = p.inv[a.slot | 0];
    if (!s) return;
    if (o.inv.length >= 12) return this.msg(p, 'Crate is full.');
    p.inv[a.slot | 0] = null;
    if (p.handSlot === (a.slot | 0)) p.handSlot = -1;
    if (p.bodySlot === (a.slot | 0)) p.bodySlot = -1;
    o.inv.push(s);
    p.mail.push({ t: 'crate', i: o.i, inv: o.inv });
  }
  doTake(p, a) {
    const o = this.findObj(a.obj, p);
    if (!o || o.ty !== 'crate') return;
    const s = o.inv[a.slot | 0];
    if (!s) return;
    const left = this.addItem(p.inv, s.id, s.n, s.uses);
    if (left) { s.n = left; }
    else o.inv.splice(a.slot | 0, 1);
    p.mail.push({ t: 'crate', i: o.i, inv: o.inv });
  }

  doWormhole(p) {
    if (this.team.win) return this.msg(p, 'The wormhole is stable. You can go home.');
    // install any carried part
    for (const part of WORMHOLE_PARTS) {
      if (!this.team.parts[part] && this.countItem(p.inv, part) > 0) {
        this.removeItem(p.inv, part, 1);
        this.team.parts[part] = true;
        this.emit({ t: 'team', team: this.team });
        this.emit({ t: 'chat', from: '🌀', m: `${p.name} installed the ${ITEMS[part].name}!` });
        return;
      }
    }
    const missing = WORMHOLE_PARTS.filter(x => !this.team.parts[x]);
    if (missing.length) {
      return this.msg(p, `Wormhole unstable. Missing: ${missing.map(x => ITEMS[x].name).join(', ')} (tier 3 research, crafted at a bench).`);
    }
    this.team.win = true;
    this.emit({ t: 'team', team: this.team });
    this.emit({ t: 'win', by: p.name });
  }

  // ---------- main tick ----------
  tick(dt) {
    this.t += dt;
    for (const p of this.players.values()) this.tickPlayer(p, dt);
    for (const c of this.creatures.values()) this.tickCreature(c, dt);
    this.spawnPass(dt);
    this.sweepObjects(dt);
  }

  // ---------- serialization ----------
  welcome(p) {
    return {
      t: 'welcome', id: p.id, name: p.name,
      w: WORLD_W, h: WORLD_H, seed: this.seed,
      tiles: Buffer.from(this.tiles).toString('base64'),
      objects: [...this.objects.values()].map(o => this.serObj(o)),
      wormhole: this.wormhole,
      team: this.team,
    };
  }
  snapshotFor(p) {
    const ents = [];
    for (const q of this.players.values())
      ents.push({
        k: 'p', id: q.id, n: q.name, x: +q.x.toFixed(2), y: +q.y.toFixed(2),
        a: +q.aim.toFixed(2), hp: Math.round(q.hp), d: q.dead ? 1 : 0,
        h: this.equipped(q, 'handSlot')?.id || null, f: q.hitCool > 0 ? 1 : 0,
      });
    for (const c of this.creatures.values())
      if (dist2(c.x, c.y, p.x, p.y) < 28 * 28)
        ents.push({ k: 'c', id: c.i, sp: c.sp, x: +c.x.toFixed(2), y: +c.y.toFixed(2), hp: Math.round(c.hp) });
    const you = {
      x: p.x, y: p.y, hp: p.hp, hunger: p.hunger, thirst: p.thirst, stam: p.stam,
      temp: p.temp, fx: p.fx, inv: p.inv, handSlot: p.handSlot, bodySlot: p.bodySlot,
      dead: p.dead, respawnIn: p.respawnIn,
    };
    const snap = {
      t: 's', tod: +this.tod.toFixed(4), day: this.day, season: this.seasonIdx,
      amb: Math.round(this.ambientAt(p.x, p.y)), night: this.isNight,
      you, ents,
    };
    if (p.mail.length) { snap.mail = p.mail; p.mail = []; }
    return snap;
  }
  save() {
    for (const p of this.players.values()) this.savedPlayers[p.name] = this.persistPlayer(p);
    return {
      seed: this.seed, t: this.t, nextId: this.nextId,
      objects: [...this.objects.values()],
      team: this.team, players: this.savedPlayers,
    };
  }
}
