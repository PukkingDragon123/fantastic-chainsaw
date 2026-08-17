# EXO-TERRA

A 2D top-down **co-op survival exploration game** inspired by *Don't Starve Together* and *Project Zomboid*.

You are corporate researchers stranded through a damaged wormhole on an alternate Earth full of alien
plants, creatures, and living ecosystems. Explore, gather, build research bases, catalogue wildlife,
and survive realistic hunger, thirst, stamina, injuries, diseases, temperature, and changing seasons —
while trying to repair the wormhole and return home.

> **Status:** core mechanics complete. All visuals are placeholder shapes/colors — real art assets come later.

## Run

```bash
npm install
npm start          # -> http://localhost:3000  (PORT env var to change)
```

Open the URL in one browser tab per player (works over LAN — friends connect to your IP).
The server is authoritative; the world auto-saves to `save.json` every minute and on shutdown,
and players rejoin by name with their character intact.

### Solo build (no server, playable from any static host)

`index.html` at the repo root is a self-contained **single-player** build: the whole simulation
runs in the browser, progress saves to localStorage (add `?fresh` to the URL for a new world).
Play it straight from a CDN, e.g. `https://rawcdn.githack.com/<user>/<repo>/<commit>/index.html`.
Regenerate it after changing game code with:

```bash
node scripts/build-static.js
```

## Controls

| Key | Action |
|---|---|
| WASD / arrows | Move (Shift = sprint, drains stamina) |
| Left-click / Space | Attack (toward mouse) |
| E | Interact: gather, loot, doors, bed, campfire, crate, wormhole |
| F | Scan nearest lifeform/specimen → research points |
| Q / G | Drink from water (risky) / fill empty flask with murky water |
| C / B / N | Craft menu / Build menu / Catalogue & wormhole status |
| Left/right-click item | Use, eat, or equip / drop |
| Enter | Chat |

## Core mechanics

- **Survival stats** — health, hunger, thirst, stamina, **sanity**, and **body temperature** (°C).
  Starvation, dehydration, hypothermia, and overheating all kill. Health regenerates only when fed,
  hydrated, and healthy.
- **Sanity & the dark** — night and lurking monsters erode your mind; campfires, daylight, good meals,
  and sleep restore it. Below 30 sanity, **phantasms** peel out of the shadows and hunt you (killing
  one steadies your mind). In **total darkness at night something bites** — carry a torch or stay by fire.
- **Day / dusk / night** — a segmented day clock with distinct phases and color grading. 8-minute days,
  4 six-day seasons (winter nights hit ‑16°C and flora lies dormant). Predatory **spinehounds** hunt at
  night, and every few days a **howling pack raid** comes for you wherever you are.
- **Food spoilage & cooking** — perishables rot into spoiled mush (cold weather and crates slow it).
  Cook meat and boil water at campfires; combine ingredients at the **cook pot** for hearty stews,
  medleys, and sanity-restoring glow jelly.
- **Injuries & disease** — bleeding → infection if untreated; parasites from raw meat/unboiled water;
  spore sickness in marshes and spore forests. Bandages and remedies cure.
- **Sleep** — field cots set your respawn point; sleeping restores sanity, and if the whole expedition
  sleeps, the night passes.
- **Procedural alien world** — seeded island, 9 biomes, regrowing flora, finite wormhole-debris alloy.
- **Gathering & crafting** — DST-style category sidebar; tools with durability; three research tiers.
- **Base building** — campfires (fuel), walls/doors, shared crates, research bench, cook pot, cots,
  dew condensers.
- **Research & cataloguing** — scan every species for team research points; RP unlocks crafting tiers
  up to wormhole components.
- **The objective** — craft and install the stabilizer core, focus lens array, and bio power cell at
  the wormhole, then activate it to open the way home.
- **Co-op** — authoritative WebSocket server, shared team research/catalogue, chat, loot-drop-on-death,
  persistent characters.
- **Horror atmosphere** — close claustrophobic camera (mouse-wheel zoom), murky palette, drifting
  ground fog, film grain, camera shake on damage, and a swaying viewpoint as sanity fails, with
  whispered text only the nearly-mad can see. **Whisper monoliths** dot the map — big research
  rewards, but standing near one erodes your mind.
- **Creature behaviors** — marsh lurkers ambush from beneath the surface (watch for ripples),
  crystal wisps blink away when hunted, spinehounds prowl in circling arcs before they commit,
  duskgrazers roam in herds.
- **Mobile / touch controls** — virtual joystick, attack (auto-aim), interact, scan, drink, and
  sprint-toggle buttons; tap to use items, long-press to drop; compact HUD on small screens.

## Architecture

```
shared/defs.js      All game data (items, recipes, creatures, biomes, balance) — one source of truth
server/worldgen.js  Seeded value-noise terrain + resource placement
server/game.js      Authoritative simulation: stats, AI, actions, crafting, research, win condition
server/index.js     HTTP static host + WebSocket gateway + 20 Hz game loop + persistence
client/main.js      Socket, input, snapshot interpolation
client/render.js    Canvas renderer (placeholder shapes), lighting, minimap
client/ui.js        DOM HUD, inventory, craft/build/catalogue panels, chat
```

Protocol: clients stream inputs (20 Hz) and discrete actions; the server simulates at 20 Hz and sends
10 Hz snapshots (entities near you + your full state) plus event deltas for world objects.

## Roadmap (not yet built)

- Sprite/tile art, audio, animations (assets to be provided)
- More creatures, boss fauna, ecosystem simulation (predation/migration)
- Farming, cooking recipes, weather events
- Larger worlds with chunk streaming
