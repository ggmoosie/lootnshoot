// status.js — SYS: Status. Timed player effects (bleed damage-over-time, speed
// buffs). One authority for all effects; Player/meds/stims push into it.
import { S, MODE, Events } from "./state.js";
import { Raid } from "./raid.js";

export const Status = (function(){
  let fx={}; // kind -> { dur, mag }
  function apply(kind,dur,mag){ fx[kind]={ dur, mag:mag||1 }; Events.emit('status:changed'); }
  function clear(kind){ if(fx[kind]){ delete fx[kind]; Events.emit('status:changed'); } }
  function clearAll(){ fx={}; Events.emit('status:changed'); }
  function has(kind){ return !!fx[kind]; }
  function speedMult(){ return fx.speed?(1+0.35*fx.speed.mag):1; }
  function update(dt){
    if(S.mode!==MODE.RAID) return;
    for(const k in fx){ const f=fx[k]; f.dur-=dt;
      if(k==='bleed'){ S.player.health-=f.mag*dt; if(S.player.health<=0){ S.player.health=0; Raid.onDeath(); } Events.emit('player:changed'); }
      if(f.dur<=0) delete fx[k];
    }
  }
  return { apply, clear, clearAll, has, speedMult, update };
})();
