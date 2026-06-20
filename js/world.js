// world.js — SYS: World. Builds hub + procedural raid. Holds colliders (movement)
// and solids (bullets/LOS). Doors are interactable actors. Extract pad lives here.
import { T } from "./three.js";
import { DATA } from "./data.js";
import { S, MODE, Events, Clock } from "./state.js";
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
  let hostage=null, bomb=null;   // objective actors (rescue NPC / defuse device)

  function reset(){ GFX.clearWorld(); colliders=[]; solids=[]; interactables=[]; doors=[]; mapBoxes=[]; extractPos=null; extractMesh=null; extractHold=0; hostage=null; bomb=null; Enemies.clear(); Loot.clear(); Projectiles.clear(); Harvest.clear(); Allies.clear(); FX.clear(); }
  function addBox(x,z,w,d,h,color,opt={}){
    const m=new T.Mesh(new T.BoxGeometry(w,h,d), new T.MeshStandardMaterial({color,roughness:opt.rough??.9,metalness:opt.metal??.05}));
    // baseY lets a prop sit ON the terrain heightfield instead of the y=0 plane;
    // colliders stay 2D (XZ) so this is purely visual seating.
    const by=opt.baseY||0; m.position.set(x,by+h/2,z); m.castShadow=true; m.receiveShadow=true; GFX.world.add(m);
    // `top` (obstacle top Y) lets the vault/climb system tell a low, hoppable
    // obstacle (cover, fences, low ledges) from an un-vaultable wall — colliders
    // are still 2D for movement; this is read-only metadata.
    if(opt.collide!==false){ colliders.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2, ref:opt.ref, top:by+h}); mapBoxes.push({x,z,w,d}); }
    if(opt.solid!==false) solids.push(m);
    return m;
  }
  // --- procedural terrain ---------------------------------------------------
  // Subtle seeded value-noise heightfield. The PLAYABLE plane stays anchored at
  // y=0 (player eye + enemies + buildings all assume a flat floor at 0 and move
  // in 2D XZ), so the displacement is small and *fades to flat* near the centre
  // and edges — it's surface dressing the eye reads as relief, not real geometry
  // the collision/AI systems have to know about. terrainHeight(x,z) samples the
  // same field for anything (cover scatter) that wants to sit on the ground.
  let terrain=null; // { amp, cell, seedX, seedZ, lattice:Map, span }
  function _hash(ix,iz){ // deterministic per-cell value in [0,1) from the lattice seed
    const key=ix*73856093 ^ iz*19349663 ^ terrain.seed;
    let h=key>>>0; h^=h>>>15; h=Math.imul(h,0x2c1b3c6d); h^=h>>>12; h=Math.imul(h,0x297a2d39); h^=h>>>15;
    return (h>>>0)/4294967296;
  }
  function _smooth(t){ return t*t*(3-2*t); } // smoothstep for C1 noise
  function terrainHeight(x,z){
    if(!terrain) return 0;
    const span=terrain.span;
    // fade the relief out toward the arena edge and the central spawn so the
    // start point and walls sit on a clean flat floor
    const r=Math.hypot(x,z);
    const edge=Math.max(0,Math.min(1,(span-r)/(span*0.35)));   // 0 at edge → 1 inside
    const core=Math.max(0,Math.min(1,(r-6)/10));               // 0 at centre → 1 outside the 16u spawn ring
    const fade=_smooth(edge)*_smooth(core);
    if(fade<=0) return 0;
    const c=terrain.cell, gx=x/c, gz=z/c;
    const ix=Math.floor(gx), iz=Math.floor(gz), fx=_smooth(gx-ix), fz=_smooth(gz-iz);
    const a=_hash(ix,iz), b=_hash(ix+1,iz), cc=_hash(ix,iz+1), dd=_hash(ix+1,iz+1);
    const top=a+(b-a)*fx, bot=cc+(dd-cc)*fx, n=top+(bot-top)*fz; // value noise → [0,1)
    return (n-0.5)*2*terrain.amp*fade;                          // → [-amp,amp] * fade
  }
  function addGround(size,color,rng){
    // seed the heightfield from the per-stop rng (deterministic per stop); hub
    // passes no rng → flat ground, keeping the safehouse clean.
    if(rng){ terrain={ seed:(Math.floor(rng()*0xffffffff))>>>0, amp:0.55, cell:11, span:size/2 }; }
    else { terrain=null; }
    const seg=terrain?Math.min(96,Math.max(24,Math.round(size/2))):1;
    const geo=new T.PlaneGeometry(size,size,seg,seg);
    if(terrain){
      const pos=geo.attributes.position; // plane is in XY before the -90° X rotation: (x, y, 0) → world (x, 0, -y)
      for(let i=0;i<pos.count;i++){ const px=pos.getX(i), py=pos.getY(i); pos.setZ(i, terrainHeight(px,-py)); }
      geo.computeVertexNormals();
    }
    const g=new T.Mesh(geo, new T.MeshStandardMaterial({color,roughness:1,flatShading:false}));
    g.rotation.x=-Math.PI/2; g.receiveShadow=true; GFX.world.add(g); solids.push(g);
  }
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

  // is (x,z) clear of every solid collider (with a body radius)? — used to
  // confirm a vault/climb LANDING spot isn't inside another wall/obstacle.
  function spotClear(x,z,radius){
    for(const c of colliders){ if(c.open) continue;
      const cx=Math.max(c.minX,Math.min(x,c.maxX)), cz=Math.max(c.minZ,Math.min(z,c.maxZ));
      const dx=x-cx, dz=z-cz; if(dx*dx+dz*dz < radius*radius) return false; }
    return true;
  }
  // VAULT / CLIMB probe. Looks just ahead of the player along their facing for a
  // surmountable obstacle (a low collider you can hop OVER = vault, or a chest-to-
  // head-high ledge you can clamber ONTO/over = climb). Returns a traversal plan
  //   { type:'vault'|'climb', land:{x,z}, top, rise, dur }  or null.
  // Heights come from the collider `top` field added in addBox. The landing spot
  // is the far side of the obstacle (vault) or the obstacle top surface (climb),
  // and must be clear. Player Y is fixed-eye, so the actual traversal is a short
  // scripted slide done in player.js — this just decides IF and WHERE.
  const VAULT_MAX=1.7, CLIMB_MAX=3.2;          // obstacle-top ceilings (world units)
  function vaultProbe(pos,dir,radius){
    const fx=dir.x, fz=dir.z; const fl=Math.hypot(fx,fz)||1e-4; const nx=fx/fl, nz=fz/fl;
    // sample a couple of points just ahead at body level to find the obstacle face
    for(let reach=0.5; reach<=1.3; reach+=0.4){
      const px=pos.x+nx*reach, pz=pos.z+nz*reach;
      for(const c of colliders){ if(c.open) continue;
        if(c.top==null || c.top>CLIMB_MAX) continue;            // too tall to surmount
        if(px<c.minX-0.1||px>c.maxX+0.1||pz<c.minZ-0.1||pz>c.maxZ+0.1) continue; // not this box
        const type = c.top<=VAULT_MAX ? 'vault' : 'climb';
        // LANDING — march STRAIGHT along the player's facing from their OWN position
        // (NOT from the box centre, which is what caused the sideways teleport on
        // wide/angled obstacles). The path is a straight forward slide; we want to
        // land just past the obstacle's far face with a body radius of clearance.
        // distance from the player to the obstacle's far face along the heading:
        const distToFar = Math.abs(nx)*((nx>=0?c.maxX:c.minX)-pos.x)
                        + Math.abs(nz)*((nz>=0?c.maxZ:c.minZ)-pos.z);
        // start a full body radius PAST the far face so the first probe is already
        // clear of the obstacle we're vaulting (its own collider won't fail spotClear).
        const minTravel = Math.max(0.6, distToFar + radius);
        const maxTravel = distToFar + radius + 1.2;                // don't fling miles past it
        // CLAMP the landing so it never overshoots into another wall: walk outward in
        // small steps and keep the LAST clear spot; stop as soon as a wall appears
        // after we've found a clear one (so we settle right beyond the obstacle).
        let best=null;
        for(let t=minTravel; t<=maxTravel; t+=0.25){
          const tx=pos.x+nx*t, tz=pos.z+nz*t;
          if(spotClear(tx,tz,radius*0.85)){ best={x:tx,z:tz}; }
          else if(best) break;     // hit a wall past a clear spot → stop at the clear one
        }
        if(!best) continue;        // nowhere clear on the far side → not surmountable here
        return { type, land:{x:best.x,z:best.z}, top:c.top, rise:c.top,
                 dur: type==='climb'?0.55:0.4 };
      }
    }
    return null;
  }

  // A swinging door that fills a doorway gap. `axis` says which way the leaf runs:
  //   'x' → leaf spans along X (wall faces ±Z) — the classic front-door case;
  //   'z' → leaf spans along Z (wall faces ±X) — a side/end-wall door.
  // (x,z) is the HINGE corner of the gap; the 2u-wide leaf swings open from there.
  // The collider is a thin closed panel over the gap (cleared when the door opens),
  // so the 2D-AABB collision + AI pathing read an open door as a passable opening
  // and a closed one as a wall — identical to before, now orientation-agnostic.
  function addDoor(x,z,axis){
    axis=axis||'x';
    const pivot=new T.Group(); pivot.position.set(x,0,z); GFX.world.add(pivot);
    const leaf=new T.Mesh(new T.BoxGeometry(2,3,.2), new T.MeshStandardMaterial({color:0x5a4632,roughness:.8}));
    let col, prompt;
    if(axis==='x'){
      leaf.position.set(1,1.5,0); pivot.add(leaf);
      col={minX:x-0.1,maxX:x+2.1,minZ:z-0.2,maxZ:z+0.2, open:false};
      prompt=new T.Vector3(x+1,1,z);
    } else {
      pivot.rotation.y=Math.PI/2;                       // run the leaf along Z
      leaf.position.set(1,1.5,0); pivot.add(leaf);
      col={minX:x-0.2,maxX:x+0.2,minZ:z-0.1,maxZ:z+2.1, open:false};
      prompt=new T.Vector3(x,1,z+1);
    }
    leaf.castShadow=true; colliders.push(col);
    const door={pivot,col,open:false,axis};
    doors.push(door);
    interactables.push({pos:prompt, radius:2.6, label:'open door', action:()=>toggleDoor(door)});
  }
  function toggleDoor(d){ d.open=!d.open; d.col.open=d.open; d.pivot.rotation.y=(d.axis==='z'?Math.PI/2:0)+(d.open?-Math.PI/2:0); }

  // A straight wall (along X or Z) with a doorway GAP punched in it. Split into
  // two solid segments around the gap; the gap is just absence of collider, so
  // the existing 2D-AABB collision + AI pathing read it as a passable opening.
  // axis 'x' = wall runs along X at fixed z (length=len, faces ±Z);
  // axis 'z' = wall runs along Z at fixed x (length=len).
  function wallWithGap(axis,fx,len,fixed,h,col,gap,gw){
    gw=gw||2.6; const t=0.4;
    const g=Math.max(-len/2+gw/2, Math.min(len/2-gw/2, gap)); // keep gap inside the wall
    // left/lower segment spans [-len/2 .. g-gw/2]; right/upper spans [g+gw/2 .. len/2]
    const segA=(g-gw/2) - (-len/2), cA=(-len/2 + (g-gw/2))/2;
    const segB=(len/2) - (g+gw/2),  cB=((g+gw/2) + len/2)/2;
    if(axis==='x'){
      if(segA>0.05) addBox(fx+cA, fixed, segA, t, h, col);
      if(segB>0.05) addBox(fx+cB, fixed, segB, t, h, col);
    } else {
      if(segA>0.05) addBox(fixed, fx+cA, t, segA, h, col);
      if(segB>0.05) addBox(fixed, fx+cB, t, segB, h, col);
    }
  }

  // A walkable stair RAMP from ground up to floorY at (x,z). Built from stacked
  // steps (boxes, non-colliding so it never blocks the player) leading to a
  // landing on the upper floor. Player Y is fixed-eye so this is a visual climb;
  // it tells the eye "there's a way up" and aligns with the open upper level.
  function addStairs(x,z,floorY,dir,col){
    const steps=6, run=0.7, riseH=floorY/steps, wide=2.2;
    for(let s=0;s<steps;s++){
      const sy=riseH*(s+1);                            // each step is a box of growing height (top = tread)
      const sx = dir==='x' ? x + (s+0.5)*run : x;
      const sz = dir==='z' ? z + (s+0.5)*run : z;
      const bw = dir==='x' ? run : wide, bd = dir==='z' ? run : wide;
      addBox(sx, sz, bw, bd, sy, col, {collide:false, baseY:0});
    }
  }

  // Building: outer shell (4 walls + a doorway + swinging door) PARTITIONED
  // into 2–4 rooms by internal walls, each with a doorway gap. Loot + cover are
  // distributed per-room. Larger footprints get a second floor: a raised slab
  // over part of the plan, a low parapet, and a stair ramp up. Everything is
  // built from addBox/addDoor so the colliders/solids/doors model is unchanged —
  // AI + player collision keep working with zero new concepts.
  //
  // `facing` picks WHICH wall carries the entrance ('S' -Z [default], 'N' +Z,
  // 'W' -X, 'E' +X) so callers can aim the door at a road / yard gate and never
  // leave a building sealed behind a fence. The other three walls stay solid.
  // ROBUSTNESS: a building ALWAYS gets exactly one outer doorway + door, and the
  // door is reachable because its wall faces open ground by construction.
  function addBuilding(cx,cz,w,d,h,rng,wallColor,facing){
    const t=0.4, gw=2.6, col=wallColor||0x3a414a;
    facing=facing||'S';
    // four walls: the entrance wall gets a gap+door, the rest are solid panels.
    // S/N run along X at fixed z; W/E run along Z at fixed x.
    if(facing==='S'){ wallWithGap('x',cx,w,cz-d/2,h,col,0,gw); addDoor(cx-1,cz-d/2,'x'); }
    else            { addBox(cx, cz-d/2, w, t, h, col); }                  // front (-Z)
    if(facing==='N'){ wallWithGap('x',cx,w,cz+d/2,h,col,0,gw); addDoor(cx-1,cz+d/2,'x'); }
    else            { addBox(cx, cz+d/2, w, t, h, col); }                  // back (+Z)
    if(facing==='W'){ wallWithGap('z',cz,d,cx-w/2,h,col,0,gw); addDoor(cx-w/2,cz-1,'z'); }
    else            { addBox(cx-w/2, cz, t, d, h, col); }                  // left (-X)
    if(facing==='E'){ wallWithGap('z',cz,d,cx+w/2,h,col,0,gw); addDoor(cx+w/2,cz-1,'z'); }
    else            { addBox(cx+w/2, cz, t, d, h, col); }                  // right (+X)

    // ---- partition interior into rooms -------------------------------------
    // rooms come from internal walls running across the SHORT axis (so each
    // room still spans the full other dimension and stays generous enough to
    // move + fight in). 2–4 rooms depending on size.
    const along = w>=d ? 'x' : 'z';                    // long axis we slice along
    const L = along==='x' ? w : d;                     // length of the long axis
    const maxRooms = L>=16 ? 4 : L>=11 ? 3 : 2;
    const rooms = 1 + Math.floor(rng()*maxRooms);      // 1..maxRooms → divisions = rooms-1
    const divs = rooms-1;
    // room cell centres along the long axis (for loot/cover placement)
    const cells=[];
    for(let r=0;r<rooms;r++){
      const t0=(r+0.5)/rooms;                          // fractional centre of room r
      cells.push((t0-0.5)*L);
    }
    let prevSide = (rng()<0.5)? -1 : 1;                // alternate doorway side so rooms chain, not dead-end
    for(let s=0;s<divs;s++){
      const at=((s+1)/rooms - 0.5)*L;                  // wall offset from centre along long axis
      // doorway offset on the cross axis, alternating to force a walkable path
      const crossLen = along==='x' ? d : w;
      const gapOff = prevSide * (crossLen*0.5 - gw*0.75); prevSide*=-1;
      if(along==='x') wallWithGap('z', cz, d, cx+at, h, col, gapOff, gw);
      else            wallWithGap('x', cx, w, cz+at, h, col, gapOff, gw);
    }

    // ---- distribute loot + cover across rooms ------------------------------
    const types=['locker','weapon','med','safe'];
    for(let r=0;r<rooms;r++){
      const rc = cells[r];
      const rx = along==='x' ? cx+rc : cx + (rng()-.5)*(w-3);
      const rz = along==='x' ? cz + (rng()-.5)*(d-3) : cz+rc;
      if(rng()<0.7) Loot.makeContainer(rx, rz, types[Math.floor(rng()*types.length)]);
      if(rng()<0.45){
        const bx = along==='x' ? cx+rc+(rng()-.5)*2 : cx+(rng()-.5)*(w-2.5);
        const bz = along==='x' ? cz+(rng()-.5)*(d-2.5) : cz+rc+(rng()-.5)*2;
        addBox(bx,bz,1.2,1.2,1.0,0x2a2f33);
      }
    }

    // ---- optional second floor --------------------------------------------
    // only for buildings big + tall enough to carry one. A raised slab over ~70%
    // of the footprint, a knee-high parapet so it reads as a level, a stair ramp
    // up, and a couple of loot/cover spots up top.
    if(w>=10 && d>=10 && h>=6 && rng()<0.55){
      const fy = Math.min(h-2.4, 3.0);                 // upper floor height (leave headroom under the wall top)
      const fw=w-1.0, fd=d-1.0;
      // floor slab + parapet are OVERHEAD geometry — colliders are 2D (Y-agnostic)
      // so they must NOT add ground-level AABBs (that would put invisible walls
      // around the room at floor level). collide:false everywhere up here; they
      // stay in `solids` so bullets/LOS still read them.
      addBox(cx, cz, fw, fd, 0.3, col, {collide:false, baseY:fy, rough:.85});
      addBox(cx, cz+fd/2, fw, t, 1.0, col, {collide:false, baseY:fy});
      addBox(cx-fw/2, cz, t, fd, 1.0, col, {collide:false, baseY:fy});
      addBox(cx+fw/2, cz, t, fd, 1.0, col, {collide:false, baseY:fy});
      // stair ramp up against the back wall (ascends toward the front)
      const sx = cx-fw/2+1.4, sz = cz+fd/2-2.6;
      addStairs(sx, sz, fy, 'z', col);
      // upper-level cover, seated on the slab (lootables stay on the ground floor
      // for now — see note: elevated containers need a y-aware Loot.makeContainer)
      if(rng()<0.6) addBox(cx+(rng()-.5)*(fw-3), cz+(rng()-.5)*(fd-3), 1.2, 1.2, 1.0, 0x2a2f33, {baseY:fy});
      if(rng()<0.5) addBox(cx+(rng()-.5)*(fw-3), cz+(rng()-.5)*(fd-3), 1.4, 0.9, 0.9, 0x2a2f33, {baseY:fy});
    }
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
    // Re-acquire mouse-look the instant we're back in the hub. Returning from a
    // raid runs through the result overlay, which called exitPointerLock; without
    // this the player can WALK but not LOOK until they click the canvas (and an
    // immediate click can hit the browser's post-exit relock throttle → the
    // "~1s frozen look" bug). relock() is gesture-safe (rBack's click is the
    // gesture) and retries on pointerlockerror, so look frees as soon as allowed.
    if(!Input.isTouch) Input.relock();
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

  // ---------- RAID LAYOUTS (world variety) ----------
  // The arena's BUILDINGS + COVER are arranged by one of three seeded layout
  // archetypes (DATA.raidLayouts), so stops don't all read as the same random
  // scatter. Loot / enemies / extract still scatter across the whole arena after
  // this — these only shape the static geometry. Every layout uses the same
  // addBox / addBuilding primitives, so colliders / solids / doors / cover and the
  // multi-room buildings keep working unchanged. `H` = arena half-extent.
  //
  // pick the layout for this stop (weighted, off the layout stream so it's stable)
  function pickLayout(rng,i){
    const tbl=DATA.raidLayouts||[{id:'scatter',weight:1}];
    const ws=tbl.map(t=>Math.max(0,(typeof t.weight==='function'?t.weight(i):t.weight)||0));
    const tot=ws.reduce((a,b)=>a+b,0)||1; let x=rng()*tot;
    for(let k=0;k<tbl.length;k++){ x-=ws[k]; if(x<=0) return tbl[k].id; }
    return tbl[tbl.length-1].id;
  }
  // a low fence run along an axis (short + thin so it reads as a yard boundary,
  // not a building wall). knee-to-chest height. `gate` true → punch a 3u opening
  // at gapOff (a gate); false → a continuous solid run (a plain addBox panel).
  function addFence(axis,fx,len,fixed,gate,gapOff){
    const h=1.3, col=0x4a4636, t=0.3;
    if(gate){ wallWithGap(axis, fx, len, fixed, h, col, gapOff||0, 3.0); }
    else if(axis==='x'){ addBox(fx, fixed, len, t, h, col); }
    else { addBox(fixed, fx, t, len, h, col); }
  }
  // a small scatter of cover boxes inside a rectangular yard (planted on terrain)
  function yardCover(cx,cz,w,d,rng,n){
    for(let k=0;k<n;k++){ const yx=cx+(rng()-.5)*(w-2), yz=cz+(rng()-.5)*(d-2);
      if(Math.hypot(yx,yz)<14) continue; addBox(yx,yz,1.4,1.4,1.3,0x33392c,{baseY:terrainHeight(yx,yz)}); }
  }

  // LOT layout: a handful of discrete PLOTS, each = a fenced yard with one
  // (often multi-room) building on it + a gate + a little yard cover. Plots are
  // jittered on a coarse grid so they tile the arena without overlapping.
  function buildLot(H,i,rng){
    const half=H-14, cell=Math.max(26, (half*2)/ (i>=2?4:3)); // plot pitch
    const cols=Math.max(2, Math.round((half*2)/cell));
    const margin=cell*0.5;
    for(let gx=0;gx<cols;gx++) for(let gz=0;gz<cols;gz++){
      const px=-half+margin+gx*cell, pz=-half+margin+gz*cell;
      const jx=px+(rng()-.5)*cell*0.18, jz=pz+(rng()-.5)*cell*0.18;
      if(Math.hypot(jx,jz)<20) continue;          // keep the spawn ring clear
      if(rng()<0.18) continue;                     // a few empty/vacant lots
      const yw=Math.min(cell-4, 16+rng()*4), yd=Math.min(cell-4, 16+rng()*4);
      // fenced yard (4 runs; the gate side gets the opening, the rest stay solid)
      const gateSide=Math.floor(rng()*4);
      addFence('x', jx, yw, jz-yd/2, gateSide===0, (rng()-.5)*yw*0.5); // bottom
      addFence('x', jx, yw, jz+yd/2, gateSide===1, (rng()-.5)*yw*0.5); // top
      addFence('z', jx-yw/2, yd, jz, gateSide===2, (rng()-.5)*yd*0.5); // left
      addFence('z', jx+yw/2, yd, jz, gateSide===3, (rng()-.5)*yd*0.5); // right
      // the building sits to one side of the yard, leaving open yard space
      const bw=6+rng()*4, bd=6+rng()*4, bh=4+rng()*4;
      const bx=jx+(rng()-.5)*(yw-bw-1)*0.6, bz=jz+(rng()-.5)*(yd-bd-1)*0.6;
      const col=0x363c44+Math.floor(rng()*0x0a0a0a);
      // aim the entrance at the YARD GATE so the door is always reachable from
      // outside (through the gate, across the yard, into the building) — never
      // a building sealed behind a solid fence run.
      const faceByGate=['S','N','W','E'][gateSide];
      addBuilding(bx,bz,bw,bd,bh,rng,col,faceByGate);
      yardCover(jx,jz,yw,yd,rng,1+Math.floor(rng()*2));
    }
    // a little loose open-ground cover between the lots so the streets aren't bare
    for(let c=0;c<8;c++){ const cx=(rng()*2-1)*(H-8), cz=(rng()*2-1)*(H-8); if(Math.hypot(cx,cz)<14) continue; addBox(cx,cz,1.6,1.6,1.5,0x33392c,{baseY:terrainHeight(cx,cz)}); }
  }

  // STREETS layout: buildings lined up along a central road in two facing rows
  // (a block). The road is a clear lane down the middle; cover dots the sidewalks.
  function buildStreet(H,i,rng){
    const span=(H-16)*2, roadW=10;
    const lots=Math.max(3, Math.round(span/22));        // buildings per row
    const step=span/lots;
    const rowZ=roadW/2 + 7;                              // each row's centre offset from the road
    // a paved road strip down the middle (visual only — non-colliding slab)
    addBox(0,0,span,roadW,0.12,0x23282d,{collide:false,solid:false,baseY:0.02});
    for(let s=0;s<lots;s++){
      const x=-span/2+step*(s+0.5)+(rng()-.5)*step*0.2;
      for(const side of [-1,1]){
        if(rng()<0.12) continue;                        // occasional gap (alley)
        const z=side*(rowZ+(rng()-.5)*3);
        if(Math.hypot(x,z)<18) continue;                // keep spawn clear
        const bw=Math.min(step-3, 8+rng()*5), bd=7+rng()*4, bh=4+rng()*4;
        const col=0x363c44+Math.floor(rng()*0x0a0a0a);
        // entrances face the ROAD (the open central lane) so every storefront is
        // enterable from the street: a row below the road (side -1) opens +Z (N),
        // a row above it (side +1) opens -Z (S). No sealed solid blocks anymore —
        // even the "variety" footprints are real, door-having buildings.
        const faceRoad = side<0 ? 'N' : 'S';
        if(rng()<0.78) addBuilding(x,z,bw,bd,bh,rng,col,faceRoad);
        else addBuilding(x,z,bw*0.8,bd*0.8,bh,rng,col,faceRoad); // smaller, still enterable
      }
      // sidewalk cover flanking the road
      if(rng()<0.6){ const cz=(roadW/2-0.5)*(rng()<.5?-1:1); addBox(x+(rng()-.5)*step*0.3, cz, 1.4,1.4,1.3,0x33392c,{baseY:terrainHeight(x,cz)}); }
    }
    // a couple of cross-street blocks at the ends so it isn't a bare corridor
    for(let c=0;c<6;c++){ const cx=(rng()*2-1)*(H-10), cz=(rng()*2-1)*(H-10);
      if(Math.abs(cz)<roadW/2+2 || Math.hypot(cx,cz)<16) continue; addBox(cx,cz,1.6,1.6,1.5,0x33392c,{baseY:terrainHeight(cx,cz)}); }
  }

  // SCATTER layout: the original — buildings + cover sprinkled across the arena.
  function buildScatter(H,i,rng){
    const nB=10+i*2;
    const FACES=['S','N','W','E'];
    for(let b=0;b<nB;b++){ const bx=(rng()*2-1)*(H-12), bz=(rng()*2-1)*(H-12); if(Math.hypot(bx,bz)<16) continue;
      const col=0x363c44+Math.floor(rng()*0x0a0a0a);
      const face=FACES[Math.floor(rng()*4)];
      if(rng()<0.6){ const w=7+rng()*7, d=7+rng()*7, h=4+rng()*4; addBuilding(bx,bz,w,d,h,rng,col,face); }
      else {
        // the smaller footprints used to be SEALED solid blocks (= a building with
        // no way in). They're now real, enterable buildings too — only the loose
        // 1u-thin lean-to next to them stays a pure cover panel.
        const w=5+rng()*4, d=5+rng()*4, h=3.5+rng()*3; addBuilding(bx,bz,w,d,h,rng,col,face);
        if(rng()>.4){ const lx=bx+(rng()*8-4), lz=bz+(rng()*8-4); addBox(lx,lz,3+rng()*3,1,1.4,0x2a2f33,{baseY:terrainHeight(lx,lz)}); } } }
    // open-ground cover scatter — seated on the terrain so it reads as planted
    for(let c=0;c<14;c++){ const cx=(rng()*2-1)*(H-8), cz=(rng()*2-1)*(H-8); if(Math.hypot(cx,cz)<10) continue; addBox(cx,cz,1.6,1.6,1.5,0x33392c,{baseY:terrainHeight(cx,cz)}); }
  }

  // ---------- RAID ----------
  function buildRaid(){
    reset(); addLights(0x3a4858,0xc8d4e0,1.6); GFX.scene.fog=new T.Fog(0x141a20,60,165);
    const H=70, i=S.run.stopIndex; const rng=mulberry(0x9e37+i*7919);
    // terrain uses its OWN seeded rng so its single draw can't shift the layout stream
    addGround(200,0x2c333b, mulberry(0x5eed+i*2654435));
    addBox(0,-H,H*2,2,7,0x2c333b); addBox(0,H,H*2,2,7,0x2c333b); addBox(-H,0,2,H*2,7,0x2c333b); addBox(H,0,2,H*2,7,0x2c333b);
    // ---- WORLD VARIETY: pick + build a layout for the static geometry ----
    const layout=pickLayout(rng,i); S.run.layout=layout;
    if(layout==='lot') buildLot(H,i,rng);
    else if(layout==='streets') buildStreet(H,i,rng);
    else buildScatter(H,i,rng);
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
    // ---- OBJECTIVE props: spawn what the primary objective needs (rescue/defuse).
    // placed away from the spawn ring + the extract pad so there's a journey.
    const prim=Objectives.primary&&Objectives.primary();
    if(prim&&prim.kind==='rescue') spawnHostage(rng,H,ex,ez);
    else if(prim&&prim.kind==='defuse') spawnBomb(rng,H,ex,ez);
    Player.spawn(0,0,ang);
    S.setMode(MODE.RAID); document.getElementById('threats').style.display='block';
    Objectives.refreshLine();
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

  // ---- OBJECTIVE PROPS (rescue hostage / defuse bomb) ----------------------
  // Both are world actors held in module state so update() can drive them (escort
  // follow / hold meters). Cleared in reset(). Placed via a rejection sample that
  // keeps them off the spawn ring AND a good distance from the extract pad.
  function farSpot(rng,H,ex,ez){
    let x=0,z=0,tr=0;
    do{ x=(rng()*2-1)*(H-16); z=(rng()*2-1)*(H-16); tr++; }
    while((Math.hypot(x,z)<24 || Math.hypot(x-ex,z-ez)<26) && tr<40);
    return {x,z};
  }
  function spawnHostage(rng,H,ex,ez){
    const s=farSpot(rng,H,ex,ez), by=terrainHeight(s.x,s.z);
    const g=new T.Group(); g.position.set(s.x,by,s.z); GFX.world.add(g);
    const body=new T.Mesh(new T.CylinderGeometry(0.45,0.5,1.5,10), new T.MeshStandardMaterial({color:0xddb37a,roughness:.8})); body.position.y=0.95; body.castShadow=true; g.add(body);
    const head=new T.Mesh(new T.SphereGeometry(0.32,12,10), new T.MeshStandardMaterial({color:0xe8c79a,roughness:.7})); head.position.y=1.95; g.add(head);
    // a soft cyan beacon so the player can spot the hostage at range
    const beam=new T.Mesh(new T.CylinderGeometry(0.08,0.08,6,8), new T.MeshBasicMaterial({color:0x7afcff,transparent:true,opacity:.35})); beam.position.y=4.5; g.add(beam);
    hostage={ group:g, pos:new T.Vector3(s.x,1,s.z), hp:60, freed:false, mesh:body, beam };
    const inter={ pos:hostage.pos, radius:2.6, key:'interact', label:'free hostage',
      action:()=>{ if(hostage.freed) return; hostage.freed=true; inter.consumed=true; body.material.color.set(0x7afcff); Objectives.freeHostage(); } };
    interactables.push(inter);
  }
  function spawnBomb(rng,H,ex,ez){
    const s=farSpot(rng,H,ex,ez), by=terrainHeight(s.x,s.z);
    const g=new T.Group(); g.position.set(s.x,by,s.z); GFX.world.add(g);
    const crate=new T.Mesh(new T.BoxGeometry(1.4,1.0,1.4), new T.MeshStandardMaterial({color:0x2a2f33,roughness:.7,metalness:.3})); crate.position.y=0.5; crate.castShadow=true; g.add(crate);
    const light=new T.Mesh(new T.SphereGeometry(0.18,10,8), new T.MeshBasicMaterial({color:0xff4d4d})); light.position.set(0,1.15,0); g.add(light);
    const beam=new T.Mesh(new T.CylinderGeometry(0.08,0.08,6,8), new T.MeshBasicMaterial({color:0xff4d4d,transparent:true,opacity:.3})); beam.position.y=4.5; g.add(beam);
    bomb={ group:g, pos:new T.Vector3(s.x,1,s.z), light };
    // the defuse interact-hold is driven in update() (held while near + key down),
    // not a single-shot action, so this interactable just provides the prompt slot.
    interactables.push({ pos:bomb.pos, radius:2.8, key:'interact', label:'defuse device', defuse:true, action:()=>{} });
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
      if(d<3){
        if(Objectives.canExtract()) UI.prompt(`Hold <b>${ek}</b> to extract ${extractHold>0?'('+Math.ceil(2-extractHold)+')':''}`);
        else UI.prompt(`⛔ ${Objectives.gateReason()}`);
        return;
      } else extractHold=0;
    }
    // defuse device: show a hold prompt with the live progress % (driven in update)
    if(near && near.defuse){ const f=Math.round(Objectives.defuseFrac()*100); UI.prompt(`Hold <b>${ek}</b> · defuse device ${f>0?'('+f+'%)':''}`); return; }
    if(near){ const kl=keyName((near.key||'interact')==='pickup'?Input.code('pickup'):Input.code('interact')); UI.prompt(`<b>${kl}</b> · ${near.label}`); }
    else UI.prompt(null);
  }
  // hostage escort: a freed hostage trails the player at a short offset (2D, using
  // the same collision so it doesn't clip walls), and is delivered when both it and
  // the player stand on the extract pad. Enemies that crowd a freed hostage chip
  // its HP; at zero the rescue is lost. (Read-only on Enemies — no AI changes.)
  function updateHostage(dt){
    if(!hostage || hostage.dead) return;
    const p=GFX.yaw.position;
    if(hostage.freed){
      // follow: move toward a point a couple metres behind the player
      const tx=p.x, tz=p.z, hx=hostage.pos.x, hz=hostage.pos.z;
      const dx=tx-hx, dz=tz-hz, d=Math.hypot(dx,dz)||1e-4;
      if(d>2.2){ const spd=Math.min(d-2.0, 4.0*dt), step={x:dx/d*spd, z:dz/d*spd};
        moveActor(hostage.pos, step, 0.5); }
      hostage.group.position.set(hostage.pos.x, terrainHeight(hostage.pos.x,hostage.pos.z), hostage.pos.z);
      hostage.group.lookAt(p.x, hostage.group.position.y, p.z);
      // danger from nearby live enemies
      let near=0; for(const e of Enemies.list()){ if(e.dead) continue; if(e.group.position.distanceTo(hostage.pos)<5) near++; }
      if(near){ hostage.hp-=near*8*dt; if(hostage.hp<=0){ hostage.dead=true; hostage.group.visible=false; Objectives.loseHostage(); return; } }
      // delivery: hostage + player both on the pad
      if(extractPos && Math.hypot(p.x-extractPos.x,p.z-extractPos.z)<3 && Math.hypot(hostage.pos.x-extractPos.x,hostage.pos.z-extractPos.z)<4){ Objectives.deliverHostage(); }
    }
  }
  function update(dt){
    updateInteract();
    if(S.mode!==MODE.RAID){ return; }
    Objectives.tick(dt);
    updateHostage(dt);
    if(bomb && bomb.light){ bomb.light.material.color.setHex((Math.floor(Clock.now*3)%2)?0xff4d4d:0x551111); }
    const p=GFX.yaw.position;
    // defuse interact-hold: while standing at the device with interact held, drain
    // the hold; walking off resets it. Completion fires inside advanceDefuse.
    if(bomb){ const dB=Math.hypot(p.x-bomb.pos.x,p.z-bomb.pos.z);
      if(dB<2.8 && Input.keys[Input.code('interact')]) Objectives.advanceDefuse(dt);
      else Objectives.resetDefuse(); }
    // extract — gated by the primary objective (can't bank until it's done)
    if(extractPos){ extractMesh.rotation.y+=dt; const d=Math.hypot(p.x-extractPos.x,p.z-extractPos.z);
      if(d<3 && Objectives.canExtract() && Input.keys[Input.code('interact')]){ extractHold+=dt; if(extractHold>=2) Raid.openExtractChoice(); } else extractHold=0; }
  }
  return { reset, buildHub, buildRaid, moveActor, vaultProbe, spotClear, interact, interactAny, update, addInteract:(o)=>interactables.push(o),
           mapInfo:()=>({boxes:mapBoxes, extract:extractPos?{x:extractPos.x,z:extractPos.z}:null, size:74}), get solids(){return solids;} };
})();
