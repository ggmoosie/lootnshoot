// save.js — SYS: Save. localStorage persistence. Serializes the whole profile
// (grids serialize recursively). New-game seeds a starter loadout.
// NOTE: localStorage works when the file is opened normally; only sandboxed
// embeds block it.
import { DATA } from "./data.js";
import { S, EQUIP_SLOTS } from "./state.js";
import { Grid, newItem, serItem, desItem } from "./inventory.js";

export const Save = (function(){
  const KEY='lootnshoot.save.v1';
  function newProfile(){
    const p={
      credits:1200, level:1, xp:0, skillPoints:0,
      skills:{vitality:0, athletics:0, marksman:0, engineer:0},
      equip:{primary:null, secondary:null, helmet:null, armor:null, clothing:null, rig:null, backpack:null},
      stash:new Grid(10,16),
      settings:{ sens:1, invertY:false, fov:78, infiniteAmmo:false, headbob:true, camShake:true, binds:Object.assign({},DATA.binds) },
    };
    // starter loadout
    const carbine=newItem('wpn_carbine'); carbine.inst.ammo=30;
    const pistol=newItem('wpn_pistol'); pistol.inst.ammo=15;
    p.equip.primary=carbine; p.equip.secondary=pistol;
    p.equip.rig=newItem('rig_basic'); p.equip.backpack=newItem('bag_small');
    // rig carries combat consumables so you deploy ready to fight (reload pulls from carried grids)
    [newItem('ammo_556',90), newItem('ammo_9mm',45), newItem('med_bandage',2), newItem('nade_frag',2)].forEach(i=>p.equip.rig.inst.container.add(i));
    // stash seed (spares + crafting)
    [newItem('ammo_556',60), newItem('ammo_9mm',60), newItem('med_kit',1), newItem('med_bandage',2),
     newItem('mat_filament',8), newItem('mat_scrap',6), newItem('nade_frag',1)].forEach(i=>p.stash.add(i));
    return p;
  }
  function serProfile(p){
    return JSON.stringify({
      credits:p.credits, level:p.level, xp:p.xp, skillPoints:p.skillPoints, skills:p.skills, settings:p.settings,
      stash:p.stash.toJSON(),
      equip:Object.fromEntries(EQUIP_SLOTS.map(s=>[s, p.equip[s]?serItem(p.equip[s]):null])),
    });
  }
  function desProfile(str){
    const o=JSON.parse(str);
    const p={credits:o.credits, level:o.level, xp:o.xp, skillPoints:o.skillPoints, skills:o.skills,
      settings:Object.assign({ sens:1, invertY:false, fov:78, infiniteAmmo:false, headbob:true, camShake:true, binds:Object.assign({},DATA.binds) }, o.settings||{}),
      stash:Grid.fromJSON(o.stash), equip:{}};
    p.settings.binds=Object.assign({},DATA.binds,p.settings.binds||{});
    for(const s of EQUIP_SLOTS) p.equip[s]= o.equip[s]?desItem(o.equip[s]):null;
    return p;
  }
  function save(){ try{ localStorage.setItem(KEY, serProfile(S.profile)); }catch(e){} }
  function load(){ try{ const s=localStorage.getItem(KEY); return s?desProfile(s):null; }catch(e){ return null; } }
  function wipe(){ try{ localStorage.removeItem(KEY); }catch(e){} }
  return { newProfile, save, load, wipe };
})();
