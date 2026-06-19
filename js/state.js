// state.js — shared mutable game state + the few cross-cutting singletons every
// system reads/writes. In the original single-file build these were top-level
// consts in one closure; here they live in ONE module that all systems import,
// preserving the shared-global behavior safely across files.

/* ENGINE.EVENTS — tiny pub/sub bus. Systems never call each other directly for
   game events; they emit/subscribe. e.g. Enemies emit 'enemy:killed'; Progression
   listens and grants XP; UI listens and updates. */
export const Events = (function(){
  const map = {};
  return {
    on(e,fn){ (map[e]||(map[e]=[])).push(fn); return ()=>this.off(e,fn); },
    off(e,fn){ if(map[e]) map[e]=map[e].filter(f=>f!==fn); },
    emit(e,p){ if(map[e]) for(const fn of map[e].slice()) fn(p); },
  };
})();

/* ENGINE.STATE — single source of truth.
     S.mode    : current high-level mode (state machine)
     S.profile : PERSISTENT (saved): credits, level, skills, equipment, stash
     S.run     : PER-RAID (volatile): stopIndex, kills, etc.
     S.player  : runtime body (health/stamina/ads). Position lives on GFX rig. */
export const MODE = { BOOT:'boot', HUB:'hub', RAID:'raid', MENU:'menu', PAUSE:'pause', RESULT:'result' };
export const S = {
  mode: MODE.BOOT,
  profile: null,           // built by Save.newProfile / Save.load
  run: null,               // built by Raid.deploy
  player: { health:100, maxHealth:100, stamina:100, maxStamina:100, ads:false, activeSlot:'primary' },
  setMode(m){ S.mode=m; Events.emit('mode',m); },
};

// equipment slots (order = doll layout + serialization order)
export const EQUIP_SLOTS = ['primary','secondary','helmet','armor','rig','backpack'];

// global frame clock — Clock.now is wall-time seconds, advanced by the main loop.
export const Clock = { now:0 };

// instance-id generator: each item instance carries its own uid (serialize/stacking).
let _uid = 1;
export const uid = ()=> _uid++;
