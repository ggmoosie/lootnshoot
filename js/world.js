// world.js — SYS: World. Builds hub + procedural raid. Holds colliders (movement)
// and solids (bullets/LOS). Doors are interactable actors. Extract pad lives here.
import { T } from "./three.js";
import { DATA } from "./data.js";
import { S, MODE, Events } from "./state.js";
import { GFX } from "./gfx.js";
import { keyName, mulberry } from "./util.js";
import { Audio } from "./audio.js";
import { Save } from "./save.js";
import { Progression } from "./progression.js";
import { Player } from "./player.js";
import { Enemies } from "./enemies.js";
import { Loot } from "./loot.js";
import { Projectiles } from "./projectiles.js";
import { Harvest } from "./harvest.js";
import { Allies } from "./allies.js";
import { FX } from "./fx.js";
import { UI } from "./ui.js";
import { Raid } from "./raid.js";
import { Objectives } from "./objectives.js";
import { Input } from "./input.js";

export const World = (function(){
  let colliders=[], solids=[], interactables=[], doors=[], mapBoxes=[];
  let extractPos=null, extractMesh=null, extractHold=0;

  function reset(){ GFX.clearWorld(); colliders=[]; solids=[]; interactables=[]; doors=[]; mapBoxes=[]; extractPos=null; extractMesh=null; extractHold=0; Enemies.clear(); Loot.clear(); Projectiles.clear(); Harvest.clear(); Allies.clear(); FX.clear(); }
  function addBox(x,z,w,d,h,color,opt={}){
    const m=new T.Mesh(new T.BoxGeometry(w,h,d), new T.MeshStandardMaterial({color,roughness:opt.rough??.9,metalness:opt.metal??.05}));
    m.position.set(x,h/2,z); m.castShadow=true; m.receiveShadow=true; GFX.world.add(m);
    if(opt.collide!==false){ colliders.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2, ref:opt.ref}); mapBoxes.push({x,z,w,d}); }
    if(opt.solid!==false) solids.push(m);
    return m;
  }
  function addGround(size,color){ const g=new T.Mesh(new T.PlaneGeometry(size,size), new T.MeshStandardMaterial({color,roughness:1})); g.rotation.x=-Math.PI/2; g.receiveShadow=true; GFX.world.add(g); solids.push(g); }
  function addLights(sky,sun,inten){ const a=new T.AmbientLight(0xb8c2d0,.55); GFX.world.add(a);
    const h=new T.HemisphereLight(sky,0x202428,.9); GFX.world.add(h);
    const d=new T.DirectionalLight(sun,inten); d.position.set(30,60,20); d.castShadow=true; d.shadow.mapSize.set(1024,1024);
    d.shadow.camera.left=-90;d.shadow.camera.right=90;d.shadow.camera.top=90;d.shadow.camera.bottom=-90;d.shadow.camera.far=200; GFX.world.add(d); }

  function moveActor(pos,delta,radius){
    pos.x+=delta.x; pos.z+=delta.z;
    for(const c of colliders){ if(c.open) continue;
      const cx=Math.max(c.minX,Math.min(pos.x,c.maxX)), cz=Math.max(c.minZ,Math.min(pos.z,c.maxZ));
      const dx=pos.x-cx, dz=pos.z-cz, d2=dx*dx+dz*dz;
      if(d2<radius*radius){ const d=Math.sqrt(d2)||1e-4, push=(radius-d)/d; pos.x+=dx*push; pos.z+=dz*push; } }
  }

  function addDoor(x,z){
    const pivot=new T.Group(); pivot.position.set(x,0,z); GFX.world.add(pivot);
    const leaf=new T.Mesh(new T.BoxGeometry(2,3,.2), new T.MeshStandardMaterial({color:0x5a4632,roughness:.8}));
    leaf.position.set(1,1.5,0); leaf.castShadow=true; pivot.add(leaf);
    const col={minX:x-0.1,maxX:x+2.1,minZ:z-0.2,maxZ:z+0.2, open:false}; colliders.push(col);
    const door={pivot,col,open:false};
    doors.push(door);
    interactables.push({pos:new T.Vector3(x+1,1,z), radius:2.6, label:'open door', action:()=>toggleDoor(door)});
  }
  function toggleDoor(d){ d.open=!d.open; d.col.open=d.open; d.pivot.rotation.y=d.open?-Math.PI/2:0; }

  // hollow room: 4 walls + a front doorway gap + a swinging door; open-top so light/minimap read it
  function addBuilding(cx,cz,w,d,h,rng,wallColor){
    const t=0.4, gw=2.6, col=wallColor||0x3a414a;
    addBox(cx, cz+d/2, w, t, h, col);                 // back wall
    addBox(cx-w/2, cz, t, d, h, col);                 // left wall
    addBox(cx+w/2, cz, t, d, h, col);                 // right wall
    const segW=(w-gw)/2;                              // front wall split around doorway
    addBox(cx-w/2+segW/2, cz-d/2, segW, t, h, col);
    addBox(cx+w/2-segW/2, cz-d/2, segW, t, h, col);
    addDoor(cx-1, cz-d/2);                            // door fills the gap
    // interior: usually a searchable container, else low cover
    if(rng()<0.65) Loot.makeContainer(cx+(rng()-.5)*(w-3), cz+(rng()-.3)*(d-3), ['locker','weapon','med','safe'][Math.floor(rng()*4)]);
    if(rng()<0.4) addBox(cx+(rng()-.5)*(w-2.5), cz+(rng()-.5)*(d-2.5), 1.2, 1.2, 1.0, 0x2a2f33);
  }

  // ---------- HUB ----------
  function buildHub(){
    reset(); addLights(0x4a5a6a,0xfff0d8,1.7); GFX.scene.fog=new T.Fog(0x1a2028,55,170); addGround(120,0x2a2f35);
    const wc=0x363b41;
    addBox(0,-16,40,1,6,wc); addBox(-20,0,1,32,6,wc); addBox(20,0,1,32,6,wc);
    addBox(-12,16,16,1,6,wc); addBox(12,16,16,1,6,wc);
    addBox(0,0,38,30,.2,0x202529,{collide:false});
    // stations
    station(-15,6,'workbench','skills',0xe8a33d, 'workbench · skills');
    station(-15,-8,'printer','craft',0x6fa8dc, 'use 3D printer · craft');
    station(15,-8,'vendor','vendor',0x57c06b, 'open vendor');
    station(15,6,'stash','inventory',0xc06fd8, 'open stash · gear');
    buildTrain(0,19);
    interactables.push({pos:new T.Vector3(0,1,16), radius:4.5, label:'board train · deploy', action:()=>Raid.openDeploy()});
    Player.spawn(0,0,Math.PI);
    S.setMode(MODE.HUB);
    Progression.recompute(); S.player.health=S.player.maxHealth; S.player.stamina=S.player.maxStamina;
    document.getElementById('threats').style.display='none';
    UI.setObjective('Safehouse','Gear up, craft, trade, then board the train.','SAFEHOUSE');
    UI.refreshHUD(); Save.save();
  }
  function station(x,z,kind,opens,color,label){
    addBox(x,z,3,1.4,1.1,0x2a2f34,{metal:.5,rough:.4});
    const s=new T.Mesh(new T.BoxGeometry(2,1,.1), new T.MeshStandardMaterial({color:0x0a0c0e,emissive:color,emissiveIntensity:.5})); s.position.set(x,1.7,z+0.75); GFX.world.add(s);
    interactables.push({pos:new T.Vector3(x,1,z+1.4), radius:3, label, action:()=>UI.openStation(opens)});
  }
  function buildTrain(x,z){
    const car=new T.Mesh(new T.BoxGeometry(6,4,14), new T.MeshStandardMaterial({color:0x3a4148,roughness:.5,metalness:.6})); car.position.set(x,2,z+4); car.castShadow=true; GFX.world.add(car);
    colliders.push({minX:x-3,maxX:x+3,minZ:z+4-7,maxZ:z+4+7}); solids.push(car);
    const stripe=new T.Mesh(new T.BoxGeometry(6.05,.6,14.05), new T.MeshStandardMaterial({color:0xe8a33d,emissive:0xe8a33d,emissiveIntensity:.25})); stripe.position.set(x,2.6,z+4); GFX.world.add(stripe);
  }

  // ---------- RAID ----------
  function buildRaid(){
    reset(); addLights(0x3a4858,0xc8d4e0,1.6); GFX.scene.fog=new T.Fog(0x141a20,60,165); addGround(200,0x2c333b);
    const H=70, i=S.run.stopIndex; const rng=mulberry(0x9e37+i*7919);
    addBox(0,-H,H*2,2,7,0x2c333b); addBox(0,H,H*2,2,7,0x2c333b); addBox(-H,0,2,H*2,7,0x2c333b); addBox(H,0,2,H*2,7,0x2c333b);
    const nB=10+i*2;
    for(let b=0;b<nB;b++){ const bx=(rng()*2-1)*(H-12), bz=(rng()*2-1)*(H-12); if(Math.hypot(bx,bz)<16) continue;
      const col=0x363c44+Math.floor(rng()*0x0a0a0a);
      if(rng()<0.6){ const w=7+rng()*7, d=7+rng()*7, h=4+rng()*4; addBuilding(bx,bz,w,d,h,rng,col); }
      else { const w=4+rng()*5, d=4+rng()*5, h=3+rng()*4; addBox(bx,bz,w,d,h,col);
        if(rng()>.4) addBox(bx+(rng()*8-4),bz+(rng()*8-4),3+rng()*3,1,1.4,0x2a2f33); } }
    for(let c=0;c<14;c++){ const cx=(rng()*2-1)*(H-8), cz=(rng()*2-1)*(H-8); if(Math.hypot(cx,cz)<10) continue; addBox(cx,cz,1.6,1.6,1.5,0x33392c); }
    // crates
    const commons=5+i, rares=DATA.stops.rareCrates(i);
    for(let c=0;c<commons;c++) crate(rng,false);
    for(let c=0;c<rares;c++) crate(rng,true);
    // resource nodes (Harvest)
    const nNodes=3+Math.floor(rng()*3);
    for(let n=0;n<nNodes;n++){ let nx,nz,tr=0; do{nx=(rng()*2-1)*(H-10);nz=(rng()*2-1)*(H-10);tr++;}while(Math.hypot(nx,nz)<16&&tr<20); Harvest.spawn(nx,nz,rng); }
    // searchable containers (lockers / crates / safe)
    const ctypes=['locker','locker','weapon','med','safe'];
    const nC=4+i;
    for(let c=0;c<nC;c++){ let cx,cz,tr=0; do{cx=(rng()*2-1)*(H-9);cz=(rng()*2-1)*(H-9);tr++;}while(Math.hypot(cx,cz)<14&&tr<20);
      Loot.makeContainer(cx,cz, ctypes[Math.floor(rng()*ctypes.length)]); }
    // enemies
    const count=DATA.stops.count(i), pool=DATA.stops.roles(i);
    for(let e=0;e<count;e++){ let ex,ez,tr=0; do{ex=(rng()*2-1)*(H-12);ez=(rng()*2-1)*(H-12);tr++;}while(Math.hypot(ex,ez)<22&&tr<30);
      Enemies.spawn(pool[Math.floor(rng()*pool.length)], ex,ez); }
    // extract
    const ang=rng()*Math.PI*2, ex=Math.cos(ang)*(H-14), ez=Math.sin(ang)*(H-14); makeExtract(ex,ez);
    Player.spawn(0,0,ang);
    S.setMode(MODE.RAID); document.getElementById('threats').style.display='block';
    UI.setObjective(`Stop ${i+1}`, (Objectives.summary()||'Clear hostiles, loot, reach extract.'), `SECTOR ${String.fromCharCode(65+i)}`);
    UI.refreshHUD(); Events.emit('threats:changed');
    UI.banner(`Sector ${String.fromCharCode(65+i)}`, `Stop ${i+1} · ${DATA.stops.count(i)} hostiles`); Audio.play('notify');
    if(!Input.locked && !Input.isTouch) GFX.dom.requestPointerLock();
  }
  function crate(rng,rare){ let cx,cz,tr=0; do{cx=(rng()*2-1)*64;cz=(rng()*2-1)*64;tr++;}while(Math.hypot(cx,cz)<12&&tr<20);
    const m=addBox(cx,cz,1.2,1.2,1.2, rare?0x4a3f5a:0x4a3f23, {});
    m.material.emissive=new T.Color(rare?0xc06fd8:0xe8a33d); m.material.emissiveIntensity=.15;
    const crateObj={pos:new T.Vector3(cx,1,cz),rare,mesh:m,opened:false};
    interactables.push({pos:crateObj.pos, radius:2.4, label:rare?'open rare cache':'open crate', crate:true, action:()=>{ if(crateObj.opened) return; crateObj.opened=true; m.material.emissiveIntensity=0; Loot.openCrate(crateObj); }}); }
  function makeExtract(x,z){
    const ring=new T.Mesh(new T.CylinderGeometry(3,3,.2,24,1,true), new T.MeshBasicMaterial({color:0x57c06b,transparent:true,opacity:.4,side:T.DoubleSide})); ring.position.set(x,1.5,z); GFX.world.add(ring);
    const pad=new T.Mesh(new T.CircleGeometry(3,24), new T.MeshBasicMaterial({color:0x57c06b,transparent:true,opacity:.18})); pad.rotation.x=-Math.PI/2; pad.position.set(x,.05,z); GFX.world.add(pad);
    extractPos=new T.Vector3(x,0,z); extractMesh=ring; extractHold=0;
  }

  // interaction: loose items (pickup key) vs containers/doors/stations/bodies (interact key)
  let near=null;
  function interact(which){
    if(!near || !near.action) return;
    const k=near.key||'interact';
    if(which && which!==k) return;
    near.action(); if(near.crate) near.consumed=true;
  }
  function interactAny(){ if(near && near.action){ near.action(); if(near.crate) near.consumed=true; } }
  function updateInteract(){
    if(S.mode!==MODE.HUB && S.mode!==MODE.RAID){ UI.prompt(null); return; }
    const p=GFX.yaw.position; near=null; let best=Infinity;
    for(const it of interactables){ if(it.consumed) continue; const d=it.pos.distanceTo(p); if(d<it.radius&&d<best){best=d;near=it;} }
    const ek=keyName(Input.code('interact'));
    if(S.mode===MODE.RAID && extractPos){ const d=Math.hypot(p.x-extractPos.x,p.z-extractPos.z);
      if(d<3){ UI.prompt(`Hold <b>${ek}</b> to extract ${extractHold>0?'('+Math.ceil(2-extractHold)+')':''}`); return; } else extractHold=0; }
    if(near){ const kl=keyName((near.key||'interact')==='pickup'?Input.code('pickup'):Input.code('interact')); UI.prompt(`<b>${kl}</b> · ${near.label}`); }
    else UI.prompt(null);
  }
  function update(dt){
    updateInteract();
    if(S.mode===MODE.RAID && extractPos){ extractMesh.rotation.y+=dt; const p=GFX.yaw.position; const d=Math.hypot(p.x-extractPos.x,p.z-extractPos.z);
      if(d<3 && Input.keys[Input.code('interact')]){ extractHold+=dt; if(extractHold>=2) Raid.openExtractChoice(); } else extractHold=0; }
  }
  return { reset, buildHub, buildRaid, moveActor, interact, interactAny, update, addInteract:(o)=>interactables.push(o),
           mapInfo:()=>({boxes:mapBoxes, extract:extractPos?{x:extractPos.x,z:extractPos.z}:null, size:74}), get solids(){return solids;} };
})();
