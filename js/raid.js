// raid.js — SYS: Raid. Deploy/transit/extract/death + multi-stop push-deeper loop.
// run = { stopIndex, kills, bagValue }. Bag value persists across stops, banked on
// extract, lost on death.
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
  function openDeploy(){ UI.openStation('deploy'); }
  function deploy(){
    S.run={ stopIndex:0, kills:0, bagValue:0, objectives:[] };
    Objectives.generate();
    Player.resetForRaid(); UI.closeMenus();
    Transit.run('Departing — Sector A', ()=>World.buildRaid());
  }
  function pushDeeper(){
    S.run.stopIndex++; UI.closeMenus();
    S.player.health=Math.min(S.player.maxHealth, S.player.health+25); // partial heal between stops
    Transit.run(`En route — Sector ${String.fromCharCode(65+S.run.stopIndex)}`, ()=>World.buildRaid());
  }
  function extract(){
    const bank=Math.round(S.run.bagValue*DATA.stops.rewardMult(S.run.stopIndex));
    S.profile.credits+=bank;
    document.exitPointerLock();
    Events.emit('progress:changed');
    UI.showResult({died:false, title:'Extracted', sub:`Clean exit from Sector ${String.fromCharCode(65+S.run.stopIndex)}. Gear & loot secured.`,
      rows:[['Kills',S.run.kills],['Valuables banked','+'+bank+'c'],['Credits',S.profile.credits+'c']]});
    Save.save();
  }
  function onDeath(){
    document.exitPointerLock();
    // lose carried loot (rig + backpack contents), keep equipped weapons/armor
    const lost=[];
    for(const slot of ['rig','backpack']){ const it=S.profile.equip[slot]; if(it&&it.inst.container){ const n=it.inst.container.items.length; if(n) lost.push(n); it.inst.container.items=[]; } }
    UI.showResult({died:true, title:'You Died', sub:`Down in Sector ${String.fromCharCode(65+S.run.stopIndex)}. Everything in your pack and rig is gone.`,
      rows:[['Kills',S.run.kills],['Valuables lost', S.run.bagValue+'c'],['Credits kept',S.profile.credits+'c']]});
    Save.save();
  }
  Events.on('enemy:killed', ()=>{ if(S.run) S.run.kills++; });
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
