// raid.js — SYS: Raid. Deploy/transit/extract/death + multi-stop push-deeper loop.
// run = { stopIndex, maxDepth, kills, bagValue, xpEarned, creditsAtDeploy, ... }.
// Bag value persists across stops, banked on extract, lost on death. The extra run
// counters (maxDepth/xpEarned/creditsAtDeploy) feed the post-run summary screen.
import { DATA } from "./data.js";
import { S, MODE, Events } from "./state.js";
import { Player } from "./player.js";
import { UI } from "./ui.js";
import { Save } from "./save.js";
import { World } from "./world.js";
import { Objectives } from "./objectives.js";
import { Transit } from "./transit.js";
import { Audio } from "./audio.js";

export const Raid = (function(){
  // sector letter for a stop index (0->A, 1->B, …)
  const sector = i => String.fromCharCode(65 + i);
  function openDeploy(){ UI.openStation('deploy'); }
  function deploy(){
    // run bookkeeping. xpEarned mirrors Progression's per-kill grant so the
    // summary can report total XP banked without reaching into that module's
    // internal level math. creditsAtDeploy snapshots the wallet so the summary
    // shows the net change. maxDepth tracks how deep the run pushed (depth = the
    // furthest stop reached, even if you back out — it's the bragging-rights line).
    S.run={ stopIndex:0, maxDepth:0, kills:0, bagValue:0, xpEarned:0,
            creditsAtDeploy:S.profile.credits, objectives:[] };
    Objectives.generate();
    Player.resetForRaid(); UI.closeMenus();
    Transit.run('Departing — Sector A', ()=>World.buildRaid());
  }
  function pushDeeper(){
    S.run.stopIndex++; S.run.maxDepth=Math.max(S.run.maxDepth, S.run.stopIndex); UI.closeMenus();
    S.player.health=Math.min(S.player.maxHealth, S.player.health+25); // partial heal between stops
    Transit.run(`En route — Sector ${sector(S.run.stopIndex)}`, ()=>World.buildRaid());
  }
  // ---- run summary -------------------------------------------------------
  // Describe the gating objective's outcome for the report (done / failed / abandoned).
  function objectiveResult(died){
    const p=S.run&&S.run.primary;
    if(!p) return { label:'No primary objective', state:'neutral' };
    if(p.done) return { label:`${p.label} — Complete`, state:'good' };
    if(p.kind==='rescue'&&p.lost) return { label:`${p.label} — Hostage lost`, state:'bad' };
    if(died) return { label:`${p.label} — Failed (KIA)`, state:'bad' };
    return { label:`${p.label} — Incomplete`, state:'warn' };
  }
  // Bonus tasks recap (each pays bag value; show which landed).
  function bonusResults(){
    const list=(S.run&&S.run.objectives)||[];
    return list.map(o=>({ label:o.label, done:!!o.done, reward:o.reward||0 }));
  }
  function extract(){
    const i=S.run.stopIndex, mult=DATA.stops.rewardMult(i);
    const carried=S.run.bagValue;
    const bank=Math.round(carried*mult);
    S.profile.credits+=bank;
    document.exitPointerLock();
    Events.emit('progress:changed');
    UI.showResult({
      died:false, title:'Extracted',
      sub:`Clean exit from Sector ${sector(i)}. Gear and loot secured.`,
      depth:i, maxDepth:S.run.maxDepth, kills:S.run.kills, xp:S.run.xpEarned,
      objective:objectiveResult(false), bonuses:bonusResults(),
      loot:{ carried, banked:bank, lost:0, mult },
      creditsBefore:S.run.creditsAtDeploy, creditsAfter:S.profile.credits,
    });
    Save.save();
  }
  function onDeath(){
    document.exitPointerLock();
    // lose carried loot (rig + backpack contents), keep equipped weapons/armor
    for(const slot of ['rig','backpack']){ const it=S.profile.equip[slot]; if(it&&it.inst.container){ it.inst.container.items=[]; } }
    const i=S.run.stopIndex;
    UI.showResult({
      died:true, title:'You Died',
      sub:`Down in Sector ${sector(i)}. Everything in your pack and rig is gone.`,
      depth:i, maxDepth:S.run.maxDepth, kills:S.run.kills, xp:S.run.xpEarned,
      objective:objectiveResult(true), bonuses:bonusResults(),
      loot:{ carried:S.run.bagValue, banked:0, lost:S.run.bagValue, mult:0 },
      creditsBefore:S.run.creditsAtDeploy, creditsAfter:S.profile.credits,
    });
    Save.save();
  }
  Events.on('enemy:killed', e=>{ if(S.run){ S.run.kills++; S.run.xpEarned += 20 + (e&&e.tier?e.tier*10:0); } });
  Events.on('raid:cleared', ()=>{
    // hostiles down — but extraction is gated on the PRIMARY objective now, so the
    // guidance depends on whether the objective is satisfied. Objectives owns the
    // HUD line; we just add a banner + the right flavor.
    UI.banner('Area Clear', Objectives.canExtract()? 'All hostiles eliminated — extract or push deeper' : 'Hostiles down — finish the objective to extract');
    Objectives.refreshLine();
    Audio.play('clear');
  });
  return { openDeploy, deploy, pushDeeper, extract, onDeath, openExtractChoice:()=>UI.showExtractChoice() };
})();
