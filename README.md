# LootNShoot

A browser-based 3D extraction shooter built on [Three.js](https://threejs.org/).
Gear up in a safehouse, ride a train to a procedurally generated hostile stop,
clear it, loot, then **extract** to bank your run or **push deeper** for bigger
risk and reward. Spatial inventory, gunsmith, vendor, crafting, skills, stealth,
and a minimap. Progress saves to `localStorage`.

This is the modular ES-module refactor of the original single-file
`lootnshoot.html` — same game, reorganized by system.

## Run it

It's a static site with no build step.

- **Easiest:** open `index.html` in a modern browser. (It fetches Three.js from a
  CDN, so it needs an internet connection the first time.)
- **Or serve the folder** (recommended for module scripts):

  ```
  npx serve .
  # or
  python -m http.server 8000
  ```

  then open the printed URL.

Controls: **WASD** move · **Space** jump · **C** crouch · **L-click** fire ·
**R-click** ADS · **R** reload · **F** pick up · **E** loot/interact · **Tab**
inventory. Rebind everything in Settings. Touch controls appear on touch devices.

## Structure

```
index.html            shell: HUD/overlay markup, links CSS, loads Three CDN then js/main.js
css/styles.css         all styles (extracted from the original <style>)
js/
  three.js             shim exposing the global Three.js CDN build to modules
  state.js             shared mutable state S, Events bus, MODE, Clock, uid
  data.js              pure data tables (items, weapons, enemies, loot, …)
  util.js              pure helpers (clamp, RNG, icons)
  gfx.js               renderer / scene / camera rig (runs on import)
  audio.js             WebAudio SFX
  input.js             keyboard / mouse / touch input (runs on import)
  inventory.js         Grid class + item factory + Inventory
  save.js progression.js weapons.js projectiles.js player.js enemies.js
  loot.js world.js raid.js vendor.js crafting.js perception.js status.js
  allies.js harvest.js objectives.js transit.js minimap.js fx.js ui.js
  main.js              entry: update loop + boot sequence
scripts/gen-codemap.mjs  regenerates CODEMAP.md (node scripts/gen-codemap.mjs)
CODEMAP.md             auto-generated index of every exported symbol
CLAUDE.md              architecture notes for contributors / agents
```

Three.js stays the global CDN build — modules import it via `js/three.js`, not as
an npm package. See `CLAUDE.md` for the full architecture and conventions.
