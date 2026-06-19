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
  // lootable corpse: its own container grid, opened via INTERACT into the dual-panel loot UI
  function makeCorpse(e){
    const g=new Inventory.Grid(6,5);
    const k=e.kit;
    if(k){
      // their weapon, with the attachments they were using and a partial mag
      const w=Inventory.newItem(k.wpn, 1, { ammo: 4+Math.floor(Math.random()*14), attachments: Object.assign({}, k.att) });
      g.add(w);
      if(k.armor) g.add(Inventory.newItem(k.armor,1));
      if(k.helmet) g.add(Inventory.newItem(k.helmet,1));
      // spare ammo of their caliber + odds of meds/nades/cash
      const cal=k.cal; const ammoId = cal==='556'?'ammo_556':cal==='762'?'ammo_762':'ammo_9mm';
      g.add(Inventory.newItem(ammoId, 15+Math.floor(Math.random()*30)));
    } else for(let i=0;i<3;i++) g.add(roll('enemy_drop'));
    if(Math.random()<0.45) g.add(roll('enemy_drop'));
    if(Math.random()<0.30) g.add(Inventory.newItem('med_bandage',1));
    if(Math.random()<0.20) g.add(Inventory.newItem('val_cash',1+Math.floor(Math.random()*3)));
    const corpse={ grid:g, pos:e.group.position.clone(), label:(e.def.name||'Body')+"'s kit", cmesh:e.cmesh };
    corpses.push(corpse);
    World.addInteract({ pos:new T.Vector3(corpse.pos.x,1,corpse.pos.z), radius:2.6, key:'interact', label:'loot '+(e.def.name||'body').toLowerCase(), action:()=>UI.openLoot(corpse) });
  }
  // sync the dead body's visible gear to what's still on the corpse grid
  function reflectCorpse(c){ if(!c||!c.cmesh) return; const items=c.grid.items;
    if(c.cmesh.gun) c.cmesh.gun.visible = items.some(i=>i.def.type==='weapon');
    if(c.cmesh.plate) c.cmesh.plate.visible = items.some(i=>i.def.type==='armor');
    if(c.cmesh.helmet) c.cmesh.helmet.visible = items.some(i=>i.def.type==='helmet'); }
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
    const cont={ grid:g, pos:new T.Vector3(x,1,z), label:def.name, type, searched:false, mesh:m };
    containers.push(cont);
    const inter={ pos:cont.pos, radius:2.4, key:'interact', label:'search '+def.name.toLowerCase(),
      action:()=>{ if(cont.searched){ UI.openLoot(cont); return; }
        UI.toast('Searching '+def.name+'…','neu'); Audio.play('ui'); inter.busy=true;
        setTimeout(()=>{ cont.searched=true; inter.busy=false; m.material.emissiveIntensity=0; inter.label='loot '+def.name.toLowerCase(); if(S.mode===MODE.RAID) UI.openLoot(cont); }, def.search*1000); } };
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
