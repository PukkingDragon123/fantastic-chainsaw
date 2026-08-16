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

- **Survival stats** — health, hunger, thirst, stamina, and **body temperature** (°C). Starvation,
  dehydration, hypothermia, and overheating all kill. Health regenerates only when fed, hydrated, and healthy.
- **Injuries & disease** — creature hits cause **bleeding** (bandage it, or it becomes an **infection**);
  raw meat and unboiled water risk **parasites**; spore forests and marshes cause **spore sickness**.
  Craft remedies at a campfire to cure.
- **Time, seasons, day/night** — 8-minute days, 4 six-day seasons with real temperature swings
  (winter nights hit ‑16°C — you need fire and a chitin coat). Predatory **spinehounds** hunt at night.
- **Procedural alien world** — seeded island with 9 biomes (violet meadows, spore forests, breathing
  marshes, crystal flats…), regrowing flora, finite wormhole-debris alloy fields.
- **Gathering & crafting** — tools with durability (axe/pick/spear/torch), cooking, water purification,
  three research tiers of recipes.
- **Base building** — campfires (fuel management), walls/doors, storage crates (shared), research bench,
  field cots (respawn points), dew condensers.
- **Research & cataloguing** — scan every species of fauna/flora for team research points; RP unlocks
  crafting tiers up to wormhole components.
- **The objective** — craft and install the stabilizer core, focus lens array, and bio power cell at the
  wormhole, then activate it to open the way home.
- **Co-op** — authoritative WebSocket server, shared team research/catalogue, chat, loot-drop-on-death,
  persistent characters.

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
