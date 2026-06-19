// transit.js — SYS: Transit. Seam for the train ride between stops. Today it
// passes straight through (duration 0). Set Transit.duration to add the
// moving-train sequence later without touching Raid/World call sites.
import { UI } from "./ui.js";

export const Transit = (function(){
  let DURATION=0;
  function run(label, cb){ UI.toast(label||'En route…','neu'); if(DURATION<=0){ cb(); return; } setTimeout(cb, DURATION*1000); }
  return { run, get duration(){ return DURATION; }, set duration(v){ DURATION=v; } };
})();
