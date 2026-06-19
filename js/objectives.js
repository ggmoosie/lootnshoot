// objectives.js — SYS: Objectives. Optional per-raid tasks that pay bonus bag
// value. Driven by events (kills, rare caches, materials). Summary feeds the HUD
// objective line.
import { DATA } from "./data.js";
import { S, Events } from "./state.js";
import { UI } from "./ui.js";

export const Objectives = (function(){
  function generate(){
    const i=S.run.stopIndex;
    S.run.objectives = [...DATA.objectives].sort(()=>Math.random()-0.5).slice(0,2).map(t=>{
      const o=t.make(i); o.id=t.id; o.kind=t.kind; o.prog=0; o.done=false; return o; });
  }
  function bump(kind,n){
    if(!S.run||!S.run.objectives) return; n=n||1;
    for(const o of S.run.objectives){ if(o.done||o.kind!==kind) continue; o.prog+=n;
      if(o.prog>=o.need){ o.done=true; S.run.bagValue+=o.reward; UI.toast(`Objective complete +${o.reward}c`,'pos'); Events.emit('progress:changed'); } }
  }
  Events.on('enemy:killed', ()=>bump('kill',1));
  Events.on('obj:rare',     ()=>bump('rare',1));
  Events.on('obj:material', n=>bump('material',n));
  function summary(){ if(!S.run||!S.run.objectives||!S.run.objectives.length) return ''; return S.run.objectives.map(o=>`${o.done?'✓':'•'} ${o.label}`).join('   '); }
  return { generate, summary };
})();
