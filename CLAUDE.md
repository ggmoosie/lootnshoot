# LootNShoot — project context for agents

## What this is
**LootNShoot** is a single-page, browser-based 3D extraction shooter built on
**Three.js** (classic r128, loaded from a CDN). Gear up in a safehouse, ride a
train to a procedurally generated hostile "stop", clear enemies, loot, then choose
to extract (bank your run) or push the train one stop deeper for bigger
risk/reward. Tarkov-style spatial inventory, a gunsmith, vendor, crafting, skills,
stealth (noise/perception), and a minimap. Persistence is `localStorage`.

It was originally one big HTML file (`lootnshoot.html`); this repo is the same
game, **refactored into ES modules by system**. Behavior is intended to be
identical — the refactor only reorganized code, it did not change game logic.

## How it's wired (the important part)
- `index.html` is the shell: the HUD/touch/overlay markup, the linked stylesheet,
  the Three.js **r128 CDN `<script>`** (classic build — sets the global
  `window.THREE`), and finally `<script type="module" src="./js/main.js">`.
  The CDN script MUST stay **before** the module. An inline offline guard paints
  an error card if the CDN failed; `main.js` then bails before booting.
- **Three.js is NOT an ES module here.** It stays the global CDN build. Modules
  reach it through the shim `js/three.js`, which re-exports it:
  `import { T } from "./three.js"` (`T` is the original code's alias; `THREE` is
  also exported). Do not try to migrate Three to ESM.
- **Shared mutable state lives in `js/state.js`** — the single `S` object
  (mode + persistent `profile` + per-raid `run` + runtime `player`), the `Events`
  pub/sub bus, the `MODE` enum, the global `Clock`, `EQUIP_SLOTS`, and the `uid`
  generator. Every system imports from here and reads/writes the same `S`,
  preserving the original single-scope shared-global behavior across files.
- **Each system is its own module** exporting a singleton (or a class/helpers).
  Cross-system calls are explicit `import`s. Many systems form circular import
  chains (e.g. Input ↔ Weapons ↔ Player ↔ World ↔ UI), which is fine because the
  references only fire at **runtime** (inside `update()`/handlers), not at module
  top-level — ES live bindings resolve them.
- Two modules run **side effects at import time**: `js/gfx.js` (creates the WebGL
  renderer and appends it to `#app`) and `js/input.js` (attaches keyboard/mouse/
  touch listeners, reads `GFX.dom`). The import graph guarantees `gfx.js`
  evaluates before `input.js`. `#app` must exist before the module script — it
  does (declared in `index.html` body).

## Where each system lives (`js/`)
- `three.js` — shim: `export const THREE/T = window.THREE` (global CDN build).
- `state.js` — shared `S`, `Events`, `MODE`, `Clock`, `EQUIP_SLOTS`, `uid`.
- `util.js` — pure helpers: `clamp`, `keyName`, `mulberry` (seeded RNG),
  `rarityColor`, `iconFor`.
- `data.js` — `DATA.*` pure tables (items, weapons, attachments, enemies, loot,
  containers, recipes, skills, vendor, noise, allies, objectives, icons, binds,
  stops). Tune the game here; no logic.
- `gfx.js` — `GFX`: scene/camera/renderer/yaw-pitch rig (runs at import).
- `audio.js` — `Audio`: WebAudio blip layer.
- `inventory.js` — `Grid` class + item factory/serialization
  (`newItem`/`serItem`/`desItem`/`defaultInst`) + `Inventory` singleton.
- `save.js` — `Save`: localStorage profile persistence + starter loadout.
- `progression.js` — `Progression`: XP/level/skills + derived stats.
- `input.js` — `Input`: keyboard/mouse/touch -> intents (runs at import).
- `weapons.js` — `Weapons`: active weapon, attachment stats, reload, ADS,
  hitscan fire, viewmodel.
- `projectiles.js` — `Projectiles`: grenades (arc + radius).
- `player.js` — `Player`: movement, stamina, health, damage, death.
- `enemies.js` — `Enemies`: role-driven AI, alerts, return fire.
- `loot.js` — `Loot`: roll tables, pickups, corpses, searchable containers.
- `world.js` — `World`: hub + procedural raid geometry, colliders/solids, doors,
  extract pad, interaction.
- `raid.js` — `Raid`: deploy/extract/death + multi-stop push-deeper loop.
- `vendor.js` / `crafting.js` — `Vendor` (buy/sell), `Crafting` (recipes).
- `perception.js` — `Perception`: stealth noise bus.
- `status.js` — `Status`: timed player effects (bleed, speed buff).
- `allies.js` — `Allies`: deployable recon drone.
- `harvest.js` — `Harvest`: resource nodes.
- `objectives.js` — `Objectives`: optional per-raid tasks.
- `transit.js` — `Transit`: train-ride seam between stops.
- `minimap.js` — `Minimap`: radar canvas + compass.
- `fx.js` — `FX` (impact sparks) + `fxTracer` (shared tracer line helper).
- `ui.js` — `UI`: HUD + every menu screen (start, inventory drag/drop, gunsmith,
  vendor, crafting, skills, deploy, extract, result, pause, settings).
- `main.js` — entry: imports the systems, defines the fixed-order update `loop()`,
  and runs the boot sequence (`Weapons.buildViewmodel()` → `UI.renderStart()` →
  `Minimap.init()` → first-input audio/fullscreen handler → `loop()`).

## Conventions
- **ES modules only**, explicit `import`/`export`. No bundler, no npm deps, no
  build step. Open `index.html` and it runs.
- **Three via the shim/global** — never `import` Three from a package; use
  `import { T } from "./three.js"`.
- **Shared state via `state.js`** — read/write the one `S` object; communicate
  across systems with `Events.emit`/`Events.on` where the original did.
- Keep diffs behavioral no-ops when reorganizing. Don't rename game
  variables/functions unless an export requires it.
- Preserve initialization order and DOM-ready timing (the boot sequence in
  `main.js` mirrors the original).

## How to run / verify
There is no automated test suite. To verify:
1. Open `index.html` in a browser (it needs internet the first time to fetch the
   Three.js CDN). Or serve the folder (`npx serve`, `python -m http.server`) and
   open it — module scripts need http(s)/`file:` with module support.
2. The start card should appear; "Enter Safehouse" boots the hub; you should be
   able to move (WASD), open inventory (Tab), drag/drop gear, board the train,
   fight, loot, and extract — exactly like the original single-file build.
3. Static gate before committing structural changes: every module must pass
   `node --check` and the codemap must be regenerated (below).

## CODEMAP
`CODEMAP.md` is auto-generated by `scripts/gen-codemap.mjs` (no deps). It indexes
every top-level exported symbol in `js/*.js`. **Re-run it after moving or renaming
any exported symbol:**

```
node scripts/gen-codemap.mjs
```

A stale map sends the next agent to the wrong place — keep it honest.
