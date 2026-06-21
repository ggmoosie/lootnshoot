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
  // loose fillers a looted container can arrive pre-packed with (NEVER another
  // container — keeps nesting shallow + deterministic; no infinite container chains).
  const CASE_FILL=['ammo_556','ammo_9mm','ammo_762','med_bandage','val_cash','mat_elec','mat_scrap'];
  // seed a freshly-rolled container item with 0–3 loose items so opening it in the
  // stash is worthwhile. Uses Grid.add (capacity-respecting; ignores overflow).
  function seedContainer(item){
    const g=item.inst&&item.inst.container; if(!g) return item;
    const n=Math.floor(Math.random()*3)+ (item.def.type==='case'?1:0); // cases skew fuller
    for(let i=0;i<n;i++){ const id=CASE_FILL[Math.floor(Math.random()*CASE_FILL.length)]; const fill=newItem(id, DATA.items[id].stack>1?(5+Math.floor(Math.random()*20)):1); if(fill) g.add(fill); }
    return item;
  }
  function roll(tableId){
    const tbl=DATA.loot[tableId]; const total=tbl.reduce((a,b)=>a+b.w,0); let r=Math.random()*total;
    for(const e of tbl){ r-=e.w; if(r<=0){ const qty=e.min?(e.min+Math.floor(Math.random()*(e.max-e.min+1))):1; const it=newItem(e.id,qty); return it&&it.inst&&it.inst.container?seedContainer(it):it; } }
    return newItem(tbl[0].id,1);
  }
  function clear(){ pickups=[]; corpses=[]; containers=[]; }
  // ---- LOOSE-ITEM WORLD MODELS ---------------------------------------------
  // A small per-TYPE shape so a dropped item is identifiable on the ground (a gun
  // reads as a gun, ammo as a box, a med as a red cross, cash as a green stack, a
  // grenade as a sphere). Falls back to the original glowing gem for anything else.
  // Tinted by RARITY (the emissive halo) so rare drops still pop. Returned as a
  // small Group centred at origin; spawnPickup positions/animates it as before.
  function buildPickupModel(def){
    const color=rarityColor(def.rarity);
    const halo={emissive:color, emissiveIntensity:.35};
    const M=(c,o={})=>new T.MeshStandardMaterial({color:c, roughness:o.rough??.6, metalness:o.metal??.2, emissive:o.emissive||0x000000, emissiveIntensity:o.ei??0});
    const part=(g,geo,mat,x,y,z,rx,ry,rz)=>{ const m=new T.Mesh(geo,mat); m.position.set(x||0,y||0,z||0); if(rx)m.rotation.x=rx; if(ry)m.rotation.y=ry; if(rz)m.rotation.z=rz; g.add(m); return m; };
    const g=new T.Group();
    const t=def.type;
    if(t==='weapon'){
      // gun silhouette: a long receiver, a stubby barrel, an angled grip + a mag.
      part(g,new T.BoxGeometry(0.62,0.12,0.12), M(0x3a3f45,{metal:.5,rough:.4, ...halo}), 0,0,0);   // receiver
      part(g,new T.BoxGeometry(0.3,0.06,0.06),  M(0x2a2e33,{metal:.5,rough:.4}), 0.42,0.0,0);       // barrel
      part(g,new T.BoxGeometry(0.1,0.22,0.1),   M(0x26282c,{metal:.3,rough:.5}),-0.14,-0.17,0, 0,0,0.25); // grip
      part(g,new T.BoxGeometry(0.1,0.2,0.08),   M(0x202225,{metal:.3,rough:.5}), 0.02,-0.18,0);     // magazine
    } else if(t==='ammo'){
      // small ammo box with a banded lid (boxy, industrial).
      part(g,new T.BoxGeometry(0.34,0.26,0.24), M(0x5a6a3a,{rough:.7, ...halo}), 0,0,0);
      part(g,new T.BoxGeometry(0.36,0.06,0.26), M(0x44522e,{rough:.75}), 0,0.15,0);                 // lid band
    } else if(t==='med'){
      // white med pack with a RED CROSS — unmistakable.
      part(g,new T.BoxGeometry(0.32,0.3,0.18), M(0xd7dadd,{rough:.55, ...halo}), 0,0,0);
      const red=M(0xd23a3a,{emissive:0xd23a3a,ei:.3,rough:.5});
      part(g,new T.BoxGeometry(0.18,0.06,0.04), red, 0,0,0.1);
      part(g,new T.BoxGeometry(0.06,0.18,0.04), red, 0,0,0.1);
    } else if(t==='throwable'){
      // frag: a dark sphere with a top lever stub.
      part(g,new T.SphereGeometry(0.2,12,10), M(0x44503a,{rough:.6, ...halo}), 0,0,0);
      part(g,new T.BoxGeometry(0.06,0.14,0.06), M(0x9aa0a6,{metal:.6,rough:.4}), 0.06,0.18,0, 0,0,0.3);
    } else if(t==='valuable'){
      // cash stack / gold bar — flat slab, value-green or gold tint.
      const gold = def.id==='val_gold';
      part(g,new T.BoxGeometry(0.34,0.14,0.2), M(gold?0xd9b24a:0x4a9a5a,{metal:gold?.6:.1,rough:.5, ...halo}), 0,0,0);
      if(!gold) for(let s=0;s<2;s++) part(g,new T.BoxGeometry(0.36,0.03,0.22), M(0x3a7a48,{rough:.6}), 0,-0.04+s*0.08,0); // banded notes
    } else if(t==='material'){
      // raw material chunk: a faceted nugget (keeps the gem feel but smaller/rougher).
      part(g,new T.IcosahedronGeometry(0.22,0), M(0x8a8f96,{metal:.3,rough:.7, ...halo}), 0,0,0);
    } else if(t==='attachment'){
      // optic/attachment: a small ringed cylinder.
      part(g,new T.CylinderGeometry(0.12,0.12,0.28,14), M(0x2c3034,{metal:.5,rough:.4, ...halo}), 0,0,0, Math.PI/2,0,0);
      part(g,new T.TorusGeometry(0.13,0.03,8,16), M(0x4a5560,{metal:.4,rough:.4}), 0,0,0.14);
    } else if(t==='armor'||t==='helmet'||t==='rig'||t==='backpack'||t==='case'){
      // gear: a soft rounded slab (pack/vest) — distinct from the boxy ammo case.
      part(g,new T.BoxGeometry(0.34,0.4,0.2), M(0x4a4f44,{rough:.8, ...halo}), 0,0,0);
      part(g,new T.BoxGeometry(0.36,0.1,0.22), M(0x3a3f36,{rough:.85}), 0,0.12,0);                  // flap/strap band
    } else {
      // fallback: the original glowing gem.
      part(g,new T.IcosahedronGeometry(.24,0), new T.MeshStandardMaterial({color, emissive:color, emissiveIntensity:.5}), 0,0,0);
    }
    return g;
  }
  // loose world item -> requires the PICKUP hotkey to grab (registered as a World interactable)
  function spawnPickup(x,z,item){
    const def=item.def;
    const mesh=buildPickupModel(def);
    mesh.position.set(x,.55,z); GFX.world.add(mesh);
    const pk={mesh,x,z,item,consumed:false};
    const inter={ pos:new T.Vector3(x,1,z), radius:2.0, key:'pickup', label:`take ${def.name}${item.qty>1?' ×'+item.qty:''}`, action:()=>grab(pk,inter) };
    pk.inter=inter; World.addInteract(inter); pickups.push(pk); return pk;
  }
  function grab(pk,inter){
    if(pk.consumed) return;
    // currency-like valuables (def.bank: cash/coins) convert straight to bag value;
    // every other valuable is CARRIED loot — it goes into the bag so you can extract
    // it and SELL it at the vendor (same intake path as any other item).
    if(pk.item.def.type==='valuable' && pk.item.def.bank && S.run){ const v=pk.item.def.value*pk.item.qty; S.run.bagValue+=v; UI.toast(`${pk.item.def.name} +${v}c`,'pos'); }
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
  // ---- 3D CONTAINER MODELS -------------------------------------------------
  // Recognizable low-poly models so the player can read a container at a glance
  // (a weapon crate looks military, a med crate carries a red cross, a locker is a
  // tall cabinet with a door, a safe has a dial). Each returns a THREE.Group with
  // an `.accent` sub-mesh = the part that glows until searched (so the existing
  // "turn the highlight off on open" behaviour keeps working on the Group). Shared
  // box geometry where it helps; a small fixed part count per model keeps it cheap.
  const Cm = (color,opt={})=>new T.MeshStandardMaterial({color, roughness:opt.rough??.75, metalness:opt.metal??.2,
              emissive:opt.emissive||0x000000, emissiveIntensity:opt.ei||0});
  function panel(g,w,h,d,x,y,z,mat){ const m=new T.Mesh(new T.BoxGeometry(w,h,d),mat); m.position.set(x,y,z); m.castShadow=true; g.add(m); return m; }
  function buildContainerModel(type,baseColor){
    const g=new T.Group();
    // a faint glow accent strip every model carries — set as g.accent so the search
    // action can dim it. Default: a thin lid/face band lit in the container's color.
    let accent;
    if(type==='weapon'){
      // AMMO / WEAPON CRATE: olive military box, lid seam, corner ribs, two latches.
      const body=Cm(0x4a5a3a,{rough:.8,metal:.15});
      panel(g,1.5,0.95,1.0, 0,0.475,0, body);                       // main body
      panel(g,1.55,0.12,1.05, 0,0.95,0, Cm(0x3c4a30,{rough:.85})); // lid seam band
      // corner ribs (steel edging)
      for(const sx of [-1,1]) for(const sz of [-1,1])
        panel(g,0.1,1.0,0.1, sx*0.72,0.5,sz*0.48, Cm(0x2a3322,{metal:.4,rough:.5}));
      // latches (front face)
      for(const sx of [-0.45,0.45]) panel(g,0.16,0.16,0.06, sx,0.55,0.52, Cm(0x8a8a78,{metal:.6,rough:.4}));
      // a stencil band (faint emissive) so it reads as a marked crate = the accent
      accent=panel(g,0.9,0.18,0.04, 0,0.55,0.52, Cm(baseColor,{emissive:baseColor,ei:.3,rough:.6}));
    } else if(type==='med'){
      // MED CRATE: pale grey case with a bright RED CROSS on the lid + front.
      panel(g,1.2,0.9,1.0, 0,0.45,0, Cm(0xcdd2d6,{rough:.6}));      // white-ish body
      panel(g,1.24,0.1,1.04, 0,0.9,0, Cm(0xb6bbc0,{rough:.65}));    // lid seam
      // red cross (two crossed bars) on the front face — unmistakable medical mark
      const red=Cm(0xd23a3a,{emissive:0xd23a3a,ei:.25,rough:.5});
      panel(g,0.5,0.16,0.05, 0,0.5,0.52, red);                      // horizontal bar
      accent=panel(g,0.16,0.5,0.05, 0,0.5,0.52, red);               // vertical bar (accent)
      // a small cross on the lid too
      panel(g,0.34,0.1,0.05, 0,0.91,0.0, red);
      panel(g,0.1,0.34,0.05, 0,0.91,0.0, red);
    } else if(type==='safe'){
      // SAFE: heavy dark steel cube, recessed door, round DIAL + handle bar.
      panel(g,1.1,1.1,1.0, 0,0.55,0, Cm(0x33373d,{metal:.5,rough:.35})); // body
      panel(g,0.85,0.85,0.06, 0,0.55,0.5, Cm(0x282c31,{metal:.55,rough:.3})); // recessed door
      // round dial (short cylinder) — the safe tell
      const dial=new T.Mesh(new T.CylinderGeometry(0.16,0.16,0.1,16), Cm(0x9aa0a6,{metal:.7,rough:.3}));
      dial.rotation.x=Math.PI/2; dial.position.set(-0.18,0.55,0.55); dial.castShadow=true; g.add(dial);
      panel(g,0.3,0.08,0.08, 0.22,0.55,0.55, Cm(0x9aa0a6,{metal:.7,rough:.3})); // handle bar
      accent=panel(g,0.85,0.06,0.04, 0,0.92,0.5, Cm(baseColor,{emissive:baseColor,ei:.3,rough:.5})); // top status strip
    } else {
      // LOCKER: tall thin cabinet, single door line, handle, top vent slits.
      panel(g,0.9,1.7,0.6, 0,0.85,0, Cm(0x55503f,{rough:.7,metal:.2}));    // cabinet body (taller than wide)
      panel(g,0.06,1.55,0.62, 0.0,0.85,0.0, Cm(0x3e3a2d,{rough:.75}));     // central door seam
      panel(g,0.1,0.3,0.08, 0.28,0.85,0.31, Cm(0x9aa0a6,{metal:.6,rough:.4})); // handle
      // vent slits near the top (three thin bars)
      for(let v=0;v<3;v++) panel(g,0.5,0.04,0.04, 0,1.45-v*0.12,0.31, Cm(0x3a3729,{rough:.8}));
      accent=panel(g,0.6,0.1,0.04, 0,0.3,0.31, Cm(baseColor,{emissive:baseColor,ei:.3,rough:.6})); // base status strip
    }
    g.accent=accent;
    return g;
  }

  // searchable container: timed search, then opens the dual-panel loot UI; persists items
  function makeContainer(x,z,type){
    const def=DATA.containers[type];
    // recognizable 3D model (was a plain colored box). No collider is added here —
    // identical to before: a container is a visual + an interactable, not a wall.
    const m=buildContainerModel(type, def.color);
    m.position.set(x,0,z); GFX.world.add(m);
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
      action:()=>{ Audio.play('ui'); cont.searched=true; if(m.accent) m.accent.material.emissiveIntensity=0; inter.label='loot '+def.name.toLowerCase();
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
