// loot.js — SYS: Loot. Roll weighted tables into item instances; spawn world
// pickups that flow into Inventory on contact; corpse + container interactables.
import { T } from "./three.js";
import { DATA } from "./data.js";
import { S, MODE, Clock, Events } from "./state.js";
import { GFX } from "./gfx.js";
import { rarityColor } from "./util.js";
import { Inventory, newItem } from "./inventory.js";
import { UI } from "./ui.js";
import { Audio } from "./audio.js";
import { World } from "./world.js";

export const Loot = (function(){
  let pickups=[], corpses=[], containers=[];
  function roll(tableId){
    const tbl=DATA.loot[tableId]; const total=tbl.reduce((a,b)=>a+b.w,0); let r=Math.random()*total;
    for(const e of tbl){ r-=e.w; if(r<=0){ const qty=e.min?(e.min+Math.floor(Math.random()*(e.max-e.min+1))):1; return newItem(e.id,qty); } }
    return newItem(tbl[0].id,1);
  }
  function clear(){ pickups=[]; corpses=[]; containers=[]; }
  // loose world item -> requires the PICKUP hotkey to grab (registered as a World interactable)
  function spawnPickup(x,z,item){
    const def=item.def; const color=rarityColor(def.rarity);
    const mesh=new T.Mesh(new T.IcosahedronGeometry(.26,0), new T.MeshStandardMaterial({color, emissive:color, emissiveIntensity:.5}));
    mesh.position.set(x,.55,z); GFX.world.add(mesh);
    const pk={mesh,x,z,item,consumed:false};
    const inter={ pos:new T.Vector3(x,1,z), radius:2.0, key:'pickup', label:`take ${def.name}${item.qty>1?' ×'+item.qty:''}`, action:()=>grab(pk,inter) };
    pk.inter=inter; World.addInteract(inter); pickups.push(pk); return pk;
  }
  function grab(pk,inter){
    if(pk.consumed) return;
    if(pk.item.def.type==='valuable' && S.run){ const v=pk.item.def.value*pk.item.qty; S.run.bagValue+=v; UI.toast(`${pk.item.def.name} +${v}c`,'pos'); }
    else { if(!Inventory.addLoot(pk.item)){ UI.toast('No room','neg'); return; } UI.toast(`${pk.item.def.name}${pk.item.qty>1?' ×'+pk.item.qty:''}`, pk.item.def.rarity>=3?'rare':'neu'); }
    pk.consumed=true; inter.consumed=true; GFX.world.remove(pk.mesh); Audio.play('pickup');
  }
  function dropFromEnemy(pos){ spawnPickup(pos.x,pos.z, roll('enemy_drop')); }
  // lootable corpse: a STRUCTURED second actor that mirrors the player. The dead
  // AI carries its kit in EQUIP SLOTS (primary/secondary/helmet/armor/rig/backpack)
  // exactly like S.profile.equip, and its loose loot lives INSIDE its equipped rig
  // + backpack grids (the nested containers) — not one flat dump. The loot UI then
  // renders the corpse as a paper-doll + its grids beside the player's own.
  function makeCorpse(e){
    const equip={ primary:null, secondary:null, helmet:null, armor:null, clothing:null, rig:null, backpack:null };
    const k=e.kit;
    if(k){
      // their weapon, with the attachments they were using and a partial mag
      equip.primary=Inventory.newItem(k.wpn, 1, { ammo: 4+Math.floor(Math.random()*14), attachments: Object.assign({}, k.att) });
      if(k.armor) equip.armor=Inventory.newItem(k.armor,1);
      if(k.helmet) equip.helmet=Inventory.newItem(k.helmet,1);
    }
    // every body wears a rig; tougher kits sometimes haul a pack too. These give
    // the corpse its lootable grids (the nested containers the player drags from).
    equip.rig=Inventory.newItem('rig_basic',1);
    if(Math.random()<0.40) equip.backpack=Inventory.newItem(Math.random()<0.5?'bag_large':'bag_small',1);
    // grids the loot actually lands in (rig first, then pack), in slot order
    const grids=[]; if(equip.rig) grids.push(equip.rig.inst.container); if(equip.backpack) grids.push(equip.backpack.inst.container);
    const stow=it=>{ if(!it) return; for(const g of grids){ if(g.add(it)===0) return; } };
    // spare ammo of their caliber + odds of meds/nades/cash, stowed into the grids
    if(k){ const cal=k.cal; const ammoId = cal==='556'?'ammo_556':cal==='762'?'ammo_762':'ammo_9mm';
      stow(Inventory.newItem(ammoId, 15+Math.floor(Math.random()*30)));
    } else for(let i=0;i<3;i++) stow(roll('enemy_drop'));
    if(Math.random()<0.45) stow(roll('enemy_drop'));
    if(Math.random()<0.30) stow(Inventory.newItem('med_bandage',1));
    if(Math.random()<0.20) stow(Inventory.newItem('val_cash',1+Math.floor(Math.random()*3)));
    const corpse={ equip, pos:e.group.position.clone(), label:(e.def.name||'Body')+"'s kit", cmesh:e.cmesh };
    corpses.push(corpse);
    World.addInteract({ pos:new T.Vector3(corpse.pos.x,1,corpse.pos.z), radius:2.6, key:'interact', label:'loot '+(e.def.name||'body').toLowerCase(), action:()=>UI.openLoot(corpse) });
  }
  // sync the dead body's visible gear to what's still equipped on the corpse
  function reflectCorpse(c){ if(!c||!c.cmesh||!c.equip) return; const eq=c.equip;
    if(c.cmesh.gun) c.cmesh.gun.visible = !!(eq.primary||eq.secondary);
    if(c.cmesh.plate) c.cmesh.plate.visible = !!eq.armor;
    if(c.cmesh.helmet) c.cmesh.helmet.visible = !!eq.helmet; }
  function openCrate(crate){
    const n=crate.rare?2+Math.floor(Math.random()*2):1+Math.floor(Math.random()*2);
    for(let i=0;i<n;i++){ const it=roll(crate.rare?'crate_rare':'crate_common'); spawnPickup(crate.pos.x+(Math.random()-.5)*1.6, crate.pos.z+(Math.random()-.5)*1.6, it); }
    UI.toast(crate.rare?'Rare cache cracked':'Crate opened', crate.rare?'rare':'neu');
    if(crate.rare) Events.emit('obj:rare');
  }
  // searchable container: timed search, then opens the dual-panel loot UI; persists items
  function makeContainer(x,z,type){
    const def=DATA.containers[type];
    const m=new T.Mesh(new T.BoxGeometry(1.3,1.2,0.95), new T.MeshStandardMaterial({color:def.color, emissive:def.color, emissiveIntensity:.14, roughness:.7, metalness:.3}));
    m.position.set(x,.6,z); m.castShadow=true; GFX.world.add(m);
    const g=new Inventory.Grid(def.grid[0],def.grid[1]);
    const n=2+Math.floor(Math.random()*3);
    for(let i=0;i<n;i++) g.add(roll(def.table));
    // `searched` flips true the first time it's opened; `revealed` flips true once the
    // staggered per-item reveal has finished (so re-opening shows everything at once).
    const cont={ grid:g, pos:new T.Vector3(x,1,z), label:def.name, type, searched:false, revealed:false, searchTime:def.search, mesh:m };
    containers.push(cont);
    const inter={ pos:cont.pos, radius:2.4, key:'interact', label:'search '+def.name.toLowerCase(),
      // Open the crate IMMEDIATELY (no upfront wait) and let the loot UI reveal each
      // item one-by-one with its own progress bar — show-the-crate-then-fill feel.
      action:()=>{ Audio.play('ui'); cont.searched=true; m.material.emissiveIntensity=0; inter.label='loot '+def.name.toLowerCase();
        if(S.mode===MODE.RAID) UI.openLoot(cont); } };
    World.addInteract(inter);
  }
  function mapMarks(){ const a=[];
    for(const c of containers) a.push({x:c.pos.x,z:c.pos.z,kind:c.searched?'contdone':'cont'});
    for(const c of corpses) a.push({x:c.pos.x,z:c.pos.z,kind:'corpse'});
    for(const p of pickups) if(!p.consumed) a.push({x:p.x,z:p.z,kind:'item'});
    return a;
  }
  function update(dt){ if(S.mode!==MODE.RAID) return;
    for(let i=0;i<pickups.length;i++){ const pk=pickups[i]; if(pk.consumed) continue; pk.mesh.rotation.y+=dt*3; pk.mesh.position.y=.5+Math.sin(Clock.now*3+i)*.1; } }
  return { roll, clear, spawnPickup, grab, dropFromEnemy, makeCorpse, makeContainer, openCrate, mapMarks, reflectCorpse, update };
})();
