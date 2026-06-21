// main.js — entry module. Wires the fixed-order update loop and runs the boot
// sequence exactly as the original single-file build did at the end of its script.
//
// THREE is the global CDN build; if it failed to load, the inline guard in
// index.html already painted the offline card, so we bail before touching it.
//
// Importing the system modules pulls in their singletons. Several modules (GFX,
// Input) run side effects at import time (create the renderer, attach DOM/input
// listeners) — the import graph guarantees GFX evaluates before Input. The rest
// are plain singletons whose cross-references only fire at runtime, so the
// circular dependencies between systems resolve fine through ES live bindings.

import { THREE } from "./three.js";
import { S, MODE, Clock } from "./state.js";
import { GFX } from "./gfx.js";
import { Audio } from "./audio.js";
import { Status } from "./status.js";
import { Player } from "./player.js";
import { Weapons } from "./weapons.js";
import { Enemies } from "./enemies.js";
import { Allies } from "./allies.js";
import { Projectiles } from "./projectiles.js";
import { Loot } from "./loot.js";
import { Harvest } from "./harvest.js";
import { World } from "./world.js";
import { FX } from "./fx.js";
import { Minimap } from "./minimap.js";
import { UI } from "./ui.js";
import { Input } from "./input.js";
import { Account } from "./account.js";

if(!THREE){
  // index.html's offline guard already rendered the error; nothing to boot.
} else {

/* ████████████████████████████████████████████████████████████████████████████
   ENGINE.LOOP — fixed update order -> render. Add a system = add one update() call.
   ████████████████████████████████████████████████████████████████████████████ */
let last=performance.now();
const _lp=new THREE.Vector3(), _lf=new THREE.Vector3();  // scratch: listener pos + forward (reused per frame)
function loop(){
  requestAnimationFrame(loop);
  const now=performance.now(); let dt=Math.min((now-last)/1000,0.05); last=now; Clock.now+=dt;
  document.body.classList.toggle('playing', S.mode===MODE.HUB||S.mode===MODE.RAID);
  // fixed system order:
  Status.update(dt);
  Player.update(dt);
  Weapons.update(dt);
  Enemies.update(dt);
  Allies.update(dt);
  Projectiles.update(dt);
  Loot.update(dt);
  Harvest.update(dt);
  World.update(dt);
  FX.update(dt);
  Minimap.update(dt);
  // keep the positional-audio listener glued to the camera so enemy SFX pan/attenuate
  // by where the player is actually looking (feat/audio-minimap). Cheap; runs every frame.
  Audio.setListener(GFX.camera.getWorldPosition(_lp), GFX.camera.getWorldDirection(_lf));
  GFX.tickShake(dt);     // decay the camera-shake impulse before compositing in render()
  GFX.render();
}

/* ████████████████████████████████████████████████████████████████████████████
   BOOT
   ████████████████████████████████████████████████████████████████████████████ */
// Optional shared cross-game account layer. No-op if the Firebase SDK is absent
// (offline / blocked) — the game boots and runs identically without it. Init early
// so the persisted session is restored before the menu paints its account row.
Account.init();
Weapons.buildViewmodel();
UI.renderStart();
Minimap.init();
(function(){ const r=()=>{ Audio.resume();
    if(Input.isTouch){ try{ const el=document.documentElement; if(el.requestFullscreen) el.requestFullscreen({navigationUI:'hide'}).catch(()=>{}); else if(el.webkitRequestFullscreen) el.webkitRequestFullscreen(); }catch(e){}
      try{ if(screen.orientation&&screen.orientation.lock) screen.orientation.lock('landscape').catch(()=>{}); }catch(e){} }
    removeEventListener('pointerdown',r); removeEventListener('keydown',r); };
  addEventListener('pointerdown',r); addEventListener('keydown',r); })();
addEventListener('orientationchange',()=>setTimeout(()=>dispatchEvent(new Event('resize')),250));
loop();

}
