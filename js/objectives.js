// objectives.js — SYS: Objectives. Per-raid tasks. Each stop gets ONE *primary*
// objective (clear / rescue / defuse) that GATES extraction, plus a couple of
// optional *bonus* tasks that pay extra bag value. A soft countdown timer adds
// pressure: when it runs out the area goes HOT (no hard fail — bag-value penalty +
// HUD warning). The summary feeds the raid HUD objective line.
//
// world.js spawns the props the primary needs (hostage NPC for rescue, planted
// device for defuse) and calls the register/advance hooks below; raid.js seeds
// generate() on deploy and checks canExtract() before banking. Kept simpler than
// a full mission system on purpose — a small flavor of tasks, generated per stop.
import { DATA } from "./data.js";
import { S, Events, Clock } from "./state.js";
import { UI } from "./ui.js";

export const Objectives = (function(){
  // weighted pick from a [{weight(i), ...}] table using a 0..1 roll
  function pick(table, i, r){
    const ws=table.map(t=>Math.max(0, (typeof t.weight==='function'?t.weight(i):t.weight)||0));
    const tot=ws.reduce((a,b)=>a+b,0)||1; let x=(r==null?Math.random():r)*tot;
    for(let k=0;k<table.length;k++){ x-=ws[k]; if(x<=0) return table[k]; }
    return table[table.length-1];
  }

  // ---- generation ---------------------------------------------------------
  // Builds S.run.primary (the gating objective) + S.run.objectives (bonus tasks),
  // and arms the soft timer. Called once per stop from raid deploy/pushDeeper via
  // World.buildRaid (which also reads primary.kind to spawn the matching prop).
  function generate(){
    const i=S.run.stopIndex;
    const def=pick(DATA.raidObjectives, i);
    const p=def.make(i);
    p.id=def.id; p.kind=def.kind; p.gate=def.gate!==false;
    p.done=false;                                    // nothing pre-completed
    p.prog=0;                                         // generic progress (defuse hold sec, etc.)
    p.freed=false;                                    // rescue: hostage interacted/freed
    p.extracted=false;                                // rescue: hostage delivered to pad
    p.lost=false;                                     // rescue: hostage died
    S.run.primary=p;

    // bonus tasks (the original optional-task pool) — never gate, just pay extra.
    S.run.objectives = [...DATA.objectives].sort(()=>Math.random()-0.5).slice(0,2).map(t=>{
      const o=t.make(i); o.id=t.id; o.kind=t.kind; o.prog=0; o.done=false; return o; });

    // arm soft timer
    const T=DATA.raidTimer;
    S.run.timer = { total:T.base + T.perStop*i, left:T.base + T.perStop*i, hot:false, last:Clock.now };
  }

  // ---- bonus task progress (kills / rare caches / materials) ---------------
  function bump(kind,n){
    if(!S.run||!S.run.objectives) return; n=n||1;
    for(const o of S.run.objectives){ if(o.done||o.kind!==kind) continue; o.prog+=n;
      if(o.prog>=o.need){ o.done=true; S.run.bagValue+=o.reward; UI.toast(`Bonus objective +${o.reward}c`,'pos'); Events.emit('progress:changed'); } }
  }
  Events.on('enemy:killed', ()=>bump('kill',1));
  Events.on('obj:rare',     ()=>bump('rare',1));
  Events.on('obj:material', n=>bump('material',n));

  // ---- primary completion helpers (called by world.js) --------------------
  function complete(p){
    if(!p||p.done) return; p.done=true;
    S.run.bagValue += p.reward||0;
    UI.toast(`Objective complete +${p.reward||0}c`,'pos');
    UI.banner('Objective Complete', p.label||'');
    Events.emit('obj:primary-done'); Events.emit('progress:changed');
    refreshLine();
  }

  // clear: when the sector is empty AND clear is the primary, it's satisfied.
  Events.on('raid:cleared', ()=>{ const p=S.run&&S.run.primary; if(p&&p.kind==='clear') complete(p); });

  // rescue: hostage freed (reached + interacted). Sets the "now escort" state.
  function freeHostage(){
    const p=S.run&&S.run.primary; if(!p||p.kind!=='rescue'||p.freed) return;
    p.freed=true; UI.toast('Hostage freed — get them to extract','pos'); UI.banner('Hostage Freed','Escort them to the extract pad'); refreshLine();
  }
  // rescue: hostage delivered onto the pad → objective done.
  function deliverHostage(){
    const p=S.run&&S.run.primary; if(!p||p.kind!=='rescue'||!p.freed||p.extracted) return;
    p.extracted=true; complete(p);
  }
  // rescue: hostage killed → objective lost (extraction stays gated; soft-fail).
  function loseHostage(){
    const p=S.run&&S.run.primary; if(!p||p.kind!=='rescue'||p.lost||p.done) return;
    p.lost=true; UI.toast('Hostage down — rescue failed','neg'); UI.banner('Hostage Lost','The rescue cannot be completed'); refreshLine();
  }

  // defuse: advance the interact-hold by dt while the player holds at the device.
  // Returns the clamped progress fraction so world.js can paint a prompt ring.
  function advanceDefuse(dt){
    const p=S.run&&S.run.primary; if(!p||p.kind!=='defuse'||p.done) return p?(p.prog/(p.hold||1)):0;
    p.prog=Math.min(p.hold, p.prog+dt);
    if(p.prog>=p.hold) complete(p);
    return p.prog/(p.hold||1);
  }
  function resetDefuse(){ const p=S.run&&S.run.primary; if(p&&p.kind==='defuse'&&!p.done) p.prog=0; }
  function defuseFrac(){ const p=S.run&&S.run.primary; return (p&&p.kind==='defuse')?p.prog/(p.hold||1):0; }

  // ---- gating -------------------------------------------------------------
  // extraction is allowed only when the gating primary is done (or it isn't a
  // gating objective). rescue can't complete if the hostage is lost → stays gated.
  function canExtract(){ const p=S.run&&S.run.primary; if(!p||!p.gate) return true; return !!p.done; }
  function gateReason(){
    const p=S.run&&S.run.primary; if(!p||!p.gate||p.done) return '';
    if(p.kind==='clear')  return 'Eliminate all hostiles first';
    if(p.kind==='rescue') return p.lost?'Hostage lost — extraction blocked':(p.freed?'Get the hostage to the pad':'Reach & free the hostage first');
    if(p.kind==='defuse') return 'Defuse the device first';
    return 'Finish the objective first';
  }

  // ---- soft timer ---------------------------------------------------------
  // Drained each frame by World.update(dt). Crossing zero flips the run HOT once:
  // a one-time bag-value shave + a HUD warning. Does NOT end the raid.
  function tick(dt){
    const tm=S.run&&S.run.timer; if(!tm||tm.hot) return;
    const before=Math.ceil(tm.left);
    tm.left=Math.max(0, tm.left-dt);
    if(tm.left<=0){ tm.hot=true; S.run.bagValue=Math.round(S.run.bagValue*(DATA.raidTimer.hotPenalty||1));
      UI.toast('Time up — area is HOT','neg'); UI.banner('Area HOT','Reinforcements alerted — extract now'); Events.emit('progress:changed'); refreshLine(); return; }
    // only repaint the HUD line when the displayed whole-second changes (no per-frame DOM thrash)
    if(Math.ceil(tm.left)!==before) refreshLine();
  }
  function timerText(){
    const tm=S.run&&S.run.timer; if(!tm) return '';
    if(tm.hot) return '⏱ HOT';
    const s=Math.ceil(tm.left), m=Math.floor(s/60), ss=String(s%60).padStart(2,'0');
    const warn = tm.left<=(DATA.raidTimer.warnAt||0);
    return `${warn?'⏱! ':'⏱ '}${m}:${ss}`;
  }

  // ---- HUD line -----------------------------------------------------------
  // primary first (★), then bonus dots, then the timer. world.js seeds the first
  // line on build; this keeps it fresh as state changes.
  function summary(){
    if(!S.run) return '';
    const parts=[];
    const p=S.run.primary;
    if(p){ const mark = p.done?'✓':(p.lost?'✗':'★'); parts.push(`${mark} ${p.label}`); }
    if(S.run.objectives&&S.run.objectives.length) parts.push(S.run.objectives.map(o=>`${o.done?'✓':'•'} ${o.label}`).join('   '));
    const tt=timerText(); if(tt) parts.push(tt);
    return parts.join('     ');
  }
  function refreshLine(){
    if(!S.run) return;
    const i=S.run.stopIndex;
    UI.setObjective(`Stop ${i+1}`, summary()||'Clear hostiles, loot, reach extract.', `SECTOR ${String.fromCharCode(65+i)}`);
  }

  return { generate, summary, refreshLine, tick, timerText,
           canExtract, gateReason,
           freeHostage, deliverHostage, loseHostage,
           advanceDefuse, resetDefuse, defuseFrac,
           primary:()=>S.run&&S.run.primary };
})();
