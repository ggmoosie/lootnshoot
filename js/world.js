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
import { Inventory } from "./inventory.js";
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

  // ---- SHARED RESOURCE CACHES (draw-call / GPU budget) ---------------------
  // A raid arena is MANY buildings. Each building is now built from dozens of
  // mesh pieces (walls, plinth, cornice, window frames, glass, roof, trim), so
  // a naive `new Material` per piece would balloon the material count and per-
  // shot bullet raycasts (weapons/AI ray against World.solids). We cache one
  // MeshStandardMaterial per (color,rough,metal,emissive,opacity) tuple and one
  // BoxGeometry per (w,h,d) tuple, so the whole arena collapses onto a tiny
  // palette of shared materials + reused geometries. Cleared each reset() so a
  // new stop's seeded palette doesn't leak the previous one.
  let matCache=new Map(), geoCache=new Map();
  function sharedMat(color,opt={}){
    const rough=opt.rough??.9, metal=opt.metal??.05, emi=opt.emissive??0, ei=opt.emissiveIntensity??0, op=opt.opacity??1;
    const key=`${color}|${rough}|${metal}|${emi}|${ei}|${op}`;
    let m=matCache.get(key);
    if(!m){ m=new T.MeshStandardMaterial({color,roughness:rough,metalness:metal,
              emissive:emi||0x000000, emissiveIntensity:ei,
              transparent:op<1, opacity:op}); matCache.set(key,m); }
    return m;
  }
  function sharedBox(w,h,d){
    // round to 1cm so the hundreds of fixed-size decorative pieces (trim bands,
    // window panes, parapet lips) collapse onto one shared geometry each, while
    // structural wall meshes stay within 1cm of their (exact) colliders — far
    // below anything the eye can read as a seam.
    const r=v=>Math.round(v*100)/100;
    const key=`${r(w)}|${r(h)}|${r(d)}`;
    let g=geoCache.get(key);
    if(!g){ g=new T.BoxGeometry(r(w),r(h),r(d)); geoCache.set(key,g); }
    return g;
  }

  // placed building footprints (XZ rects), so the layout generators can REJECT a
  // building that would overlap one already placed — the old generators scattered
  // boxes blind and frequently interpenetrated, which is the single biggest reason
  // the proc buildings read as "bad" (walls fused into each other, doors sealed by
  // a neighbour). Reset each raid. Cheap O(n) check, n≈a few dozen.
  let footprints=[];
  function footprintFree(cx,cz,w,d,pad){
    pad=pad||2;
    const aMinX=cx-w/2-pad, aMaxX=cx+w/2+pad, aMinZ=cz-d/2-pad, aMaxZ=cz+d/2+pad;
    for(const f of footprints){
      if(aMinX<f.maxX && aMaxX>f.minX && aMinZ<f.maxZ && aMaxZ>f.minZ) return false;
    }
    return true;
  }
  function reserveFootprint(cx,cz,w,d){ footprints.push({minX:cx-w/2,maxX:cx+w/2,minZ:cz-d/2,maxZ:cz+d/2}); }

  function reset(){ GFX.clearWorld(); colliders=[]; solids=[]; interactables=[]; doors=[]; mapBoxes=[]; footprints=[]; extractPos=null; extractMesh=null; extractHold=0; hostage=null; bomb=null; matCache=new Map(); geoCache=new Map(); Enemies.clear(); Loot.clear(); Projectiles.clear(); Harvest.clear(); Allies.clear(); FX.clear(); }
  function addBox(x,z,w,d,h,color,opt={}){
    // Geometry + material are SHARED via the caches above unless the caller needs
    // to mutate this mesh's material later (opt.uniqueMat → fresh material, e.g.
    // crates that toggle their own emissive). Behaviour for colliders/solids/
    // mapBoxes is byte-for-byte the same as before so movement/AI/minimap/vault
    // are untouched — only the meshes are now pooled.
    const mat = opt.uniqueMat
      ? new T.MeshStandardMaterial({color,roughness:opt.rough??.9,metalness:opt.metal??.05})
      : sharedMat(color,opt);
    const m=new T.Mesh(sharedBox(w,h,d), mat);
    // baseY lets a prop sit ON the terrain heightfield instead of the y=0 plane;
    // colliders stay 2D (XZ) so this is purely visual seating.
    const by=opt.baseY||0; m.position.set(x,by+h/2,z); m.castShadow=opt.cast!==false; m.receiveShadow=true; GFX.world.add(m);
    // `top` (obstacle top Y) lets the vault/climb system tell a low, hoppable
    // obstacle (cover, fences, low ledges) from an un-vaultable wall — colliders
    // are still 2D for movement; this is read-only metadata.
    //
    // FLOOR colliders (opt.floor:true) are WALKABLE SURFACES, not walls — stair
    // treads + the second-floor slab. They register a `top` so groundTopAt() seats
    // the player ON them (and player.js auto-steps up the ramp / falls off the
    // slab edge), but moveActor()/spotClear() SKIP them so they never shove the
    // player or an enemy sideways at ground level. They also stay OUT of mapBoxes
    // (overhead geometry, already drawn on the minimap by the building's walls).
    if(opt.floor){ colliders.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2, ref:opt.ref, top:by+h, floor:true}); }
    else if(opt.collide!==false){ colliders.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2, ref:opt.ref, top:by+h}); mapBoxes.push({x,z,w,d}); }
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

  // 2D-AABB push-out. `footY` (optional) makes it height-aware: a collider whose
  // TOP is at/below the actor's feet (within a small step tolerance) is something
  // the actor is standing ON, not a wall, so it doesn't push them — this lets the
  // player walk around ON TOP of a mantled crate/ledge without being shoved off.
  // Callers that omit footY (enemies, hostage escort) get the ORIGINAL Y-agnostic
  // behaviour byte-for-byte, so AI/escort collision is unchanged.
  function moveActor(pos,delta,radius,footY){
    pos.x+=delta.x; pos.z+=delta.z;
    for(const c of colliders){ if(c.open||c.floor) continue;           // floor surfaces are walkable, never walls
      if(footY!=null && c.top!=null && c.top<=footY+0.35) continue;   // standing on it → not a wall
      const cx=Math.max(c.minX,Math.min(pos.x,c.maxX)), cz=Math.max(c.minZ,Math.min(pos.z,c.maxZ));
      const dx=pos.x-cx, dz=pos.z-cz, d2=dx*dx+dz*dz;
      if(d2<radius*radius){ const d=Math.sqrt(d2)||1e-4, push=(radius-d)/d; pos.x+=dx*push; pos.z+=dz*push; } }
  }

  // is (x,z) clear of every solid collider (with a body radius)? — used to
  // confirm a vault/climb LANDING spot isn't inside another wall/obstacle.
  // `ignore` (optional collider ref) is skipped — the traversal probe passes the
  // obstacle being surmounted so its own AABB doesn't fail the on-top clearance test.
  function spotClear(x,z,radius,ignore){
    for(const c of colliders){ if(c.open||c.floor||c===ignore) continue;   // floor surfaces never block a spot
      const cx=Math.max(c.minX,Math.min(x,c.maxX)), cz=Math.max(c.minZ,Math.min(z,c.maxZ));
      const dx=x-cx, dz=z-cz; if(dx*dx+dz*dz < radius*radius) return false; }
    return true;
  }
  // tallest collider top under (x,z) — the standable ground height at this spot
  // (0 = bare floor). Used to confirm a MANTLE-ONTO landing is actually on top of
  // the obstacle and not blocked by something taller, and to seat the player.
  function groundTopAt(x,z){
    let top=0;
    for(const c of colliders){ if(c.open||c.top==null) continue;
      if(x<c.minX||x>c.maxX||z<c.minZ||z>c.maxZ) continue;
      if(c.top>top) top=c.top; }
    return top;
  }

  // ---- TRAVERSAL PROBE (vault / mantle-onto / mantle-up) -------------------
  // Standard FPS mantle/vault component model (cf. ALS / generic Mantle
  // Component): a forward face-trace finds the obstacle directly ahead, its TOP
  // height + DEPTH along the heading are read from the AABB, then the move is
  // CLASSIFIED and a believable multi-phase path is planned for player.js to
  // interpolate (rise to lip → carry across → settle), collision-checked each step.
  //
  // Returns one of three plans (or null when nothing is surmountable):
  //   • 'vault'      — LOW + THIN obstacle (cover, fence, low wall): hop OVER and
  //                    continue to clear floor on the far side. Ends at ground.
  //   • 'mantleOnto' — MID surface you can stand on (crate stack, table, low roof
  //                    edge that's deep): climb UP and END STANDING ON the top.
  //   • 'mantleUp'   — HIGH ledge / wall-top with standable space above: clamber
  //                    UP-and-over and end standing on the upper surface.
  // Plan shape: { type, land:{x,z}, landY, top, rise, dur, lip:{x,z} }
  //   land  = final XZ; landY = final standing height (0 for vault, top for mantle)
  //   lip   = XZ point on top of the obstacle the body passes over mid-move
  //   top   = obstacle top height; rise = how far the body climbs.
  const VAULT_MAX=1.5;      // obstacle top at/below this can be vaulted clean OVER
  const MANTLE_MAX=2.3;     // step/climb ONTO surfaces up to here
  const MANTLE_UP_MAX=2.9;  // clamber UP onto ledges/wall-tops up to here (reach gate)
  const VAULT_DEPTH_MAX=1.4;// obstacle no deeper than this (along heading) vaults OVER;
                            // deeper → you can't clear it, so you END ON TOP instead.
  function vaultProbe(pos,dir,radius){
    const fx=dir.x, fz=dir.z; const fl=Math.hypot(fx,fz)||1e-4; const nx=fx/fl, nz=fz/fl;
    // FACE TRACE: step forward at body level to find the first obstacle ahead.
    for(let reach=0.45; reach<=1.25; reach+=0.2){
      const px=pos.x+nx*reach, pz=pos.z+nz*reach;
      for(const c of colliders){ if(c.open||c.floor) continue;     // floor surfaces aren't vault obstacles
        if(c.top==null) continue;                                  // doors/dynamic — skip
        if(c.top>MANTLE_UP_MAX) continue;                          // too tall to surmount (reach gate)
        if(px<c.minX-0.12||px>c.maxX+0.12||pz<c.minZ-0.12||pz>c.maxZ+0.12) continue; // not this box
        const top=c.top;
        // OBSTACLE DEPTH along the heading: distance from the player's side face to
        // the far face, projected onto the heading. Thin = vault-over candidate.
        const distToNear = Math.abs(nx)*((nx>=0?c.minX:c.maxX)-pos.x)
                         + Math.abs(nz)*((nz>=0?c.minZ:c.maxZ)-pos.z);
        const distToFar  = Math.abs(nx)*((nx>=0?c.maxX:c.minX)-pos.x)
                         + Math.abs(nz)*((nz>=0?c.maxZ:c.minZ)-pos.z);
        const depth=Math.max(0, distToFar-distToNear);             // obstacle thickness ahead
        // LIP point: where the body crosses the top — just past the near face.
        const lipT=Math.max(0.05, distToNear+0.05);
        const lip={x:pos.x+nx*lipT, z:pos.z+nz*lipT};

        // --- (a) VAULT OVER: low + thin, with clear floor beyond -------------
        if(top<=VAULT_MAX && depth<=VAULT_DEPTH_MAX){
          const land=marchLanding(pos,nx,nz,radius, distToFar, distToFar+radius+1.3, c, 0);
          if(land) return { type:'vault', land, landY:0, top, rise:top, lip,
                            dur:0.42 };
          // no clear far side (boxed in by a taller wall) → fall through to stand ON it
        }
        // --- (b) MANTLE ONTO: mid surface, end standing ON the top ------------
        // valid when the obstacle is deep enough to stand on (or we couldn't clear
        // it) and the space ABOVE its top is free for the body to stand in.
        if(top<=MANTLE_MAX){
          const onT=Math.max(distToNear+radius*0.7, (distToNear+distToFar)/2);
          const ox=pos.x+nx*Math.min(onT,distToFar-0.05), oz=pos.z+nz*Math.min(onT,distToFar-0.05);
          // clear of OTHER colliders at the on-top spot, and nothing taller here.
          if(spotClear(ox,oz,radius*0.6,c) && groundTopAt(ox,oz)<=top+0.05)
            return { type:'mantleOnto', land:{x:ox,z:oz}, landY:top, top, rise:top, lip,
                     dur:0.5 };
        }
        // --- (c) MANTLE UP: high ledge / wall-top — clamber up onto it --------
        if(top<=MANTLE_UP_MAX){
          // prefer landing just past the far face (up-and-over onto a roof/ledge at
          // the SAME top height); if that's not clear, settle ON the top surface.
          const over=marchLanding(pos,nx,nz,radius, distToFar, distToFar+1.4, c, top);
          if(over) return { type:'mantleUp', land:over, landY:groundTopAt(over.x,over.z),
                            top, rise:top, lip, dur:0.6 };
          const ox=pos.x+nx*Math.min(distToFar-0.1, distToNear+radius), oz=pos.z+nz*Math.min(distToFar-0.1, distToNear+radius);
          if(spotClear(ox,oz,radius*0.6,c) && groundTopAt(ox,oz)<=top+0.05)
            return { type:'mantleUp', land:{x:ox,z:oz}, landY:top, top, rise:top, lip,
                     dur:0.6 };
        }
      }
    }
    return null;
  }
  // March outward along the heading and return the LAST spot that's clear at the
  // given standing height (atTop = the floor height required there, so we don't
  // "land" half-inside a taller neighbour). CONTIGUITY is enforced: the scan starts
  // right at the obstacle's far face and walks forward in FINE steps; the FIRST step
  // that is blocked (a taller wall hugging the obstacle) ends the scan — so we can
  // never "land" on the far side of a wall the player would have to clip through.
  // The obstacle being surmounted is ignored (its own AABB never blocks the path).
  function marchLanding(pos,nx,nz,radius,minT,maxT,obstacle,atTop){
    let best=null, started=false;
    for(let t=minT; t<=maxT; t+=0.12){
      const tx=pos.x+nx*t, tz=pos.z+nz*t;
      const clear=spotClear(tx,tz,radius*0.85,obstacle);
      const groundOk = atTop>0 ? Math.abs(groundTopAt(tx,tz)-atTop)<0.6 : groundTopAt(tx,tz)<=0.6;
      if(clear && groundOk){ best={x:tx,z:tz}; started=true; }
      else if(started) break;     // blocked AFTER a clear run → settle on the last clear spot
      else if(best===null && !clear){
        // blocked at the very FIRST step (a wall hugs the obstacle's far face) → no
        // contiguous corridor exists; abort so vault can't jump the wall.
        return null;
      }
    }
    return best;
  }

  // ---- SAFE SPAWN -----------------------------------------------------------
  // Drop the player into the raid on the PERIMETER, away from the fight — not into
  // the middle of it (the old spiral started dead-centre and took the first spot
  // ~8u from a mob, which routinely spawned the player inside the enemy cluster and
  // got them shot on arrival). We sweep an outer ring just inside the arena walls,
  // pick the perimeter point FARTHEST from every live enemy that's also body-clear
  // on solid ground, then nudge a couple of metres inward off the wall. Falls back
  // to inner rings only if the whole perimeter is blocked, and to the most-open
  // spot seen so a spawn is ALWAYS produced. The player faces the arena centre.
  // `half` = arena half-extent (wall inset); defaults to the standard raid size.
  function findSafeSpawn(radius, half){
    const r=radius||0.45;
    const H=(half||70);
    const enemySafe=18;                 // strongly prefer a wide stand-off from enemies
    const mobs=(Enemies.list&&Enemies.list())||[];
    function enemyDist(x,z){ let m=Infinity; for(const e of mobs){ if(e.dead) continue;
      const ep=e.group?e.group.position:e.pos; if(!ep) continue;
      const dx=x-ep.x, dz=z-ep.z, d=Math.hypot(dx,dz); if(d<m) m=d; } return m; }
    // score: must be body-clear on flat ground; higher enemy distance is better.
    function score(x,z){
      if(Math.abs(x)>H-3 || Math.abs(z)>H-3) return -1;   // keep inside the boundary walls
      if(!spotClear(x,z,r*1.3)) return -1;                // overlaps a wall/obstacle
      if(groundTopAt(x,z)>0.4) return -1;                 // standing on top of something
      return Math.min(enemyDist(x,z), 60);                // prefer farther from enemies (capped)
    }
    let best=null, bestS=-1;
    function consider(x,z){ const s=score(x,z); if(s>bestS){ bestS=s; best={x,z}; } return s; }
    // PERIMETER sweep: a dense ring of candidates just inside the walls, each
    // probed slightly inward (so the body clears the wall). Take the farthest-from-
    // enemy clear point; this puts the player on an EDGE looking in.
    const edge=H-6, inset=4, N=72;
    for(let k=0;k<N;k++){
      const a=(k/N)*Math.PI*2;
      const ex=Math.cos(a)*edge, ez=Math.sin(a)*edge;     // point on the perimeter ring
      // step inward off the wall toward centre
      const il=Math.hypot(ex,ez)||1; const x=ex-(ex/il)*inset, z=ez-(ez/il)*inset;
      consider(x,z);
    }
    if(best && bestS>=enemySafe) return { x:best.x, z:best.z, face:Math.atan2(-best.x,-best.z) };
    // perimeter too crowded/blocked → fall back to mid-ring candidates, still
    // preferring the most open spot.
    const rings=[edge-10, edge-20, edge-30, 20, 10];
    for(const rad of rings){ if(rad<=0) continue;
      const n=Math.max(8, Math.round(rad/2));
      for(let k=0;k<n;k++){ const a=(k/n)*Math.PI*2 + rad*0.37;
        consider(Math.cos(a)*rad, Math.sin(a)*rad); }
    }
    if(best) return { x:best.x, z:best.z, face:Math.atan2(-best.x,-best.z) };
    return { x:0, z:0, face:0 };                    // absolute fallback (centre)
  }

  // A swinging door + frame that fills a doorway gap. `axis` says which way the
  // leaf runs (matching the WALL it sits in):
  //   'x' → leaf spans along X (wall faces ±Z) — the classic front-door case;
  //   'z' → leaf spans along Z (wall faces ±X) — a side/end-wall door.
  // (x,z) is the HINGE corner of the gap; the leaf is sized to the gap width `gw`
  // so a CLOSED door fully seals its opening (the old fixed-2u leaf left a 0.3u
  // slit each side of the 2.6u gap — readable as a "gap" bug). A jamb-and-lintel
  // CASING is drawn around the opening (visual deco — no colliders), so the door
  // reads as a real framed doorway instead of a bare hole with a floating panel.
  // The collider is a thin closed panel exactly over the gap (cleared when the
  // door opens), so 2D-AABB collision + AI pathing read an OPEN door as passable
  // and a CLOSED one as a wall — orientation-agnostic and gap-tight.
  // LOCKED DOORS: a door may be born locked behind a key. `lock` is the item id of
  // the required key (e.g. 'key_office'); null/undefined = a normal free door. A
  // locked leaf is tinted with a brass strip + reads "locked — needs <key>" in the
  // prompt until the player carries the key, at which point interacting CONSUMES one
  // key, unlocks the door permanently, and swings it open. Crash-proof: a missing
  // key def or no run just shows the locked prompt; it never throws or seals an
  // objective (objectives + extract live in the open, not behind building doors).
  function addDoor(x,z,axis,gw,h,pal,lock){
    axis=axis||'x'; gw=gw||2.6; h=h||4; pal=pal||{wall:0x3a414a,trim:0x6a727c};
    const t=0.4, leafW=gw-0.12, leafH=Math.min(h-0.2, 3.0), jamb=0.16;
    const pivot=new T.Group(); pivot.position.set(x,0,z); GFX.world.add(pivot);
    const leaf=new T.Mesh(new T.BoxGeometry(leafW,leafH,.18), new T.MeshStandardMaterial({color:0x5a4632,roughness:.8}));
    let col, prompt;
    if(axis==='x'){
      // hinge at x; leaf swings about the hinge, sized to span the gap (x .. x+gw)
      leaf.position.set(leafW/2,leafH/2,0); pivot.add(leaf);
      col={minX:x-t/2,maxX:x+gw+t/2,minZ:z-t/2,maxZ:z+t/2, open:false};
      prompt=new T.Vector3(x+gw/2,1,z);
      // CASING: two vertical jambs flanking the opening + a lintel header across it
      addBox(x,        z, jamb, t+0.06, leafH+0.12, pal.trim, {...deco, baseY:0, cast:false});
      addBox(x+gw,     z, jamb, t+0.06, leafH+0.12, pal.trim, {...deco, baseY:0, cast:false});
      addBox(x+gw/2,   z, gw+jamb, t+0.06, 0.2,     pal.trim, {...deco, baseY:leafH, cast:false}); // header
    } else {
      pivot.rotation.y=Math.PI/2;                       // run the leaf along Z
      leaf.position.set(leafW/2,leafH/2,0); pivot.add(leaf);
      col={minX:x-t/2,maxX:x+t/2,minZ:z-t/2,maxZ:z+gw+t/2, open:false};
      prompt=new T.Vector3(x,1,z+gw/2);
      addBox(x, z,      t+0.06, jamb, leafH+0.12, pal.trim, {...deco, baseY:0, cast:false});
      addBox(x, z+gw,   t+0.06, jamb, leafH+0.12, pal.trim, {...deco, baseY:0, cast:false});
      addBox(x, z+gw/2, t+0.06, gw+jamb, 0.2,     pal.trim, {...deco, baseY:leafH, cast:false}); // header
    }
    leaf.castShadow=true; colliders.push(col);
    const door={pivot,col,open:false,axis,locked:!!lock,key:lock||null,leaf};
    // a locked leaf wears a brass lock plate so it reads as gated at a glance
    if(door.locked){
      const plate=new T.Mesh(new T.BoxGeometry(0.22,0.34,0.06),
        new T.MeshStandardMaterial({color:0xb8923a,metalness:.7,roughness:.35,emissive:0x4a3a10,emissiveIntensity:.4}));
      plate.position.set(leafW-0.45, leafH/2, 0.12); pivot.add(plate); door.plate=plate;
      leaf.material=leaf.material.clone(); leaf.material.color.set(0x4a3b2a);   // darker, "sealed" leaf
    }
    doors.push(door);
    const inter={pos:prompt, radius:2.6, label:doorLabel(door), key:'interact', action:()=>toggleDoor(door,inter)};
    interactables.push(inter);
  }
  // does the player CURRENTLY carry (in their raid rig/backpack, any nested grid) at
  // least one of item `id`? Crash-proof: no run / no equip → false.
  function carryingKey(id){
    if(!id) return false;
    for(const g of Inventory.carried()){ for(const grid of Inventory.nestedGrids(g)){ if(grid.count(id)>0) return true; } }
    return false;
  }
  // consume ONE of item `id` from the player's carried grids; true if one was spent.
  function spendKey(id){
    for(const g of Inventory.carried()){ for(const grid of Inventory.nestedGrids(g)){ if(grid.count(id)>0 && grid.consume(id,1)){ Events.emit('inv:changed'); return true; } } }
    return false;
  }
  function doorLabel(d){
    if(d.locked){ const kn=(DATA.items[d.key]&&DATA.items[d.key].name)||'a key'; return 'locked — needs '+kn; }
    return d.open?'close door':'open door';
  }
  function toggleDoor(d,inter){
    // a still-locked door: try the player's key first. No key → just a prompt, no swing.
    if(d.locked){
      if(!carryingKey(d.key)){
        const kn=(DATA.items[d.key]&&DATA.items[d.key].name)||'a key';
        UI.toast('Locked — needs '+kn,'neg'); Audio.play('ui');
        return;
      }
      spendKey(d.key); d.locked=false;
      if(d.plate){ d.plate.material.color.set(0x6fae6f); d.plate.material.emissive.set(0x1a3a1a); } // plate goes green = unlocked
      const kn=(DATA.items[d.key]&&DATA.items[d.key].name)||'key';
      UI.toast('Unlocked ('+kn+' used)','pos'); Audio.play('pickup');
    }
    d.open=!d.open; d.col.open=d.open; d.pivot.rotation.y=(d.axis==='z'?Math.PI/2:0)+(d.open?-Math.PI/2:0);
    if(inter) inter.label=doorLabel(d);
  }

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

  // A WALKABLE stair RAMP from ground (y=0) up to floorY, starting at (x,z) and
  // ascending along `dir` (+X or +Z). Each tread is a FLOOR collider (walkable,
  // never a wall — see addBox opt.floor): groundTopAt() seats the player on the
  // tread under their feet and player.js auto-steps up each ~0.28u rise, so the
  // player physically climbs to the upper floor. Returns the top-landing rect
  // {minX,maxX,minZ,maxZ} so the caller can punch a matching hole in the slab.
  function addStairs(x,z,floorY,dir,col){
    const wide=2.4, run=0.55;
    const rise=0.28;                                   // ≤ player step-up tolerance (0.35) so each tread auto-climbs
    const steps=Math.max(6, Math.ceil(floorY/rise));
    const riseH=floorY/steps;
    for(let s=0;s<steps;s++){
      const sy=riseH*(s+1);                            // tread top height (box from ground up to sy)
      const sx = dir==='x' ? x + (s+0.5)*run : x;
      const sz = dir==='z' ? z + (s+0.5)*run : z;
      const bw = dir==='x' ? run : wide, bd = dir==='z' ? run : wide;
      addBox(sx, sz, bw, bd, sy, col, {floor:true, baseY:0, rough:.9});
    }
    // the foot/extent rect of the run (for the slab hole)
    if(dir==='x') return {minX:x, maxX:x+steps*run, minZ:z-wide/2, maxZ:z+wide/2};
    return {minX:x-wide/2, maxX:x+wide/2, minZ:z, maxZ:z+steps*run};
  }

  // ---- BUILDING DETAIL HELPERS --------------------------------------------
  // Everything below is PURELY VISUAL: it draws into the world but never touches
  // colliders, solids, mapBoxes, doors or interactables. So the gameplay model
  // (2D-AABB collision, AI cover/LOS off World.solids, vault metadata, minimap
  // footprints, loot/spawn placement) is byte-for-byte identical to the plain-box
  // building — we just dress the existing shell so it reads as a building. All
  // meshes go through addBox with {collide:false, solid:false} (so they add zero
  // raycast cost) and share the material/geometry caches.
  const deco={collide:false, solid:false};
  // quantize a facade color onto a small seeded palette + derive a trim color, so
  // dozens of buildings collapse onto a handful of shared materials (draw-call
  // budget) instead of one unique material each (the old +rng()*0x0a0a0a did the
  // opposite). Returns {wall, trim, glass}.
  function buildingPalette(color){
    // snap each channel to 5 levels → at most a few distinct wall colors per arena
    const q=c=>Math.round(c/40)*40;
    const r=q((color>>16)&255), g=q((color>>8)&255), b=q(color&255);
    const wall=(Math.min(255,r)<<16)|(Math.min(255,g)<<8)|Math.min(255,b);
    // trim = a touch lighter + cooler (concrete/steel banding)
    const lt=v=>Math.min(255,Math.round(v*1.35)+14);
    const trim=(lt(r)<<16)|(lt(g)<<8)|lt(b);
    // roof = a touch darker + warmer than the wall (shingle/tar) so the pitched
    // roof reads as a distinct cap rather than blending into the trim band.
    const dk=v=>Math.max(0,Math.round(v*0.62));
    const roof=(Math.min(255,dk(r)+22)<<16)|(dk(g)<<8)|dk(b);
    return { wall, trim, roof, glass:0x1b3a4a };
  }
  // a run of recessed windows along one outer wall face. `axis` = the wall's run
  // ('x' wall faces ±Z; 'z' wall faces ±X). `face` = +1/-1 outward normal sign on
  // the perpendicular axis. Windows are dark glass panes set just proud of the
  // wall plane with thin frame posts — readable from outside, decorative only.
  function addWindows(axis,center,len,fixed,h,face,pal,rng){
    if(h<3.0 || len<3) return;
    const sill=1.1, winH=Math.min(1.6, h-sill-0.8), winW=1.2, gapMin=1.0;
    if(winH<0.6) return;
    const usable=len-1.8;                                   // keep clear of corners
    const pitch=winW+gapMin;
    const n=Math.max(0, Math.floor(usable/pitch));
    if(n<=0) return;
    const span=(n-1)*pitch;
    const proud=0.10;                                       // sit just outside the wall plane
    const fr=0.10;                                          // frame member thickness
    for(let i=0;i<n;i++){
      const off=-span/2 + i*pitch;
      const gx = axis==='x' ? center+off : fixed + face*proud;
      const gz = axis==='x' ? fixed + face*proud : center+off;
      // helper: place a thin trim member of the given on-wall width `wW` and height
      // `hH` at vertical offset `by`, oriented to the wall axis.
      const member=(wW,hH,by)=>addBox(gx, gz,
        (axis==='x'?wW:0.06), (axis==='x'?0.06:wW), hH, pal.trim, {...deco, baseY:by, cast:false});
      // glass pane (cool reflective glazing, faintly lit so it reads from outside)
      addBox(gx, gz, (axis==='x'?winW:0.08), (axis==='x'?0.08:winW), winH, pal.glass,
        {...deco, baseY:sill, rough:.12, metal:.6, emissive:0x16313f, emissiveIntensity:.22, cast:false});
      // CASING: top lintel + bottom sill (proud band) + the two side mullions, so
      // each window reads as a framed opening, not a dark smear on the wall.
      member(winW+0.30, fr, sill-fr);                       // sill
      member(winW+0.30, fr, sill+winH);                     // lintel
      // side posts (full pane height)
      const post=(o)=>addBox(
        axis==='x'?gx+o:gx, axis==='x'?gz:gz+o,
        (axis==='x'?fr:0.07),(axis==='x'?0.07:fr), winH, pal.trim, {...deco, baseY:sill, cast:false});
      post(-(winW/2)); post(winW/2);
      // a single muntin bar splitting the pane (cross-light cue)
      member(winW, fr*0.7, sill+winH/2);
    }
  }

  // a flat TRIANGLE mesh (one quad-free tri) in the XY plane, then oriented — used
  // for watertight gable end-caps so the roof closes WITHOUT a rectangular block
  // poking above the slopes (the old gable was a full-height box → it overhung the
  // eaves). Triangle apex up; base = `base` wide centred on x; height `peak`.
  function gableTri(cx,cz,base,peak,baseY,faceAxis,mat){
    const g=new T.BufferGeometry();
    // local XY: (-base/2,0) (base/2,0) (0,peak) — a wall-thin tri (depth handled by orientation)
    g.setAttribute('position', new T.Float32BufferAttribute([
      -base/2,0,0,  base/2,0,0,  0,peak,0 ], 3));
    g.setIndex([0,1,2]); g.computeVertexNormals();
    const m=new T.Mesh(g, mat); m.position.set(cx, baseY, cz);
    if(faceAxis==='z') m.rotation.y=Math.PI/2;                // face ±X (gable on a W/E wall plane)
    m.castShadow=false; m.receiveShadow=true; GFX.world.add(m);
    // back face so the gable is visible from inside too
    const m2=m.clone(); m2.rotation.y += Math.PI; GFX.world.add(m2);
  }
  // a low-poly PITCHED roof: two sloped panels meeting EXACTLY at the ridge, with
  // triangular gable end-caps so the structure is watertight — eaves land right on
  // the wall top (`baseY`), the two slopes share the ridge line, and the gables
  // close the ends flush (no overhang, no floating peak). Pure dressing (deco):
  // no colliders/solids, so LOS/cover/collision are unchanged. The building keeps a
  // separate solid ceiling slab at the wall top (added by the caller) for LOS.
  function addPitchedRoof(cx,cz,w,d,baseY,pal){
    const along = w>=d ? 'x' : 'z';                            // ridge runs along the LONG axis
    const span = along==='x' ? d : w;                          // dimension the slopes cover
    const len  = along==='x' ? w : d;                          // dimension the ridge runs
    const ridge=Math.min(2.4, Math.max(2.0, span*0.32));      // peak height above the eave
    const eave=0.35;                                           // slope overhang past the wall (clean drip edge)
    const half=span/2;
    const slopeLen=Math.hypot(half+eave, ridge);              // eave-to-ridge run incl. overhang
    const tilt=Math.atan2(ridge, half+eave);                  // panel pitch
    const tMat=sharedMat(pal.roof||pal.trim,{rough:.88});
    for(const side of [-1,1]){
      // panel centre = midpoint of the sloped face; ends meet the ridge (centre,
      // baseY+ridge) and the eave (±(half+eave), baseY). Rotating a flat slab about
      // its own centre by `tilt` lands both ends exactly on those points.
      const slab=new T.Mesh(sharedBox(len, 0.14, slopeLen), tMat);
      const offMid=side*(half+eave)/2, cyMid=baseY+ridge/2;
      if(along==='x'){ slab.position.set(cx, cyMid, cz+offMid); slab.rotation.x=-side*tilt; }
      else           { slab.position.set(cx+offMid, cyMid, cz); slab.rotation.z= side*tilt; }
      slab.castShadow=true; slab.receiveShadow=true; GFX.world.add(slab);
    }
    // ridge cap — a thin beam right along the peak so the two panels read as joined
    const cap = along==='x'
      ? new T.Mesh(sharedBox(len+0.1, 0.16, 0.3), tMat)
      : new T.Mesh(sharedBox(0.3, 0.16, len+0.1), tMat);
    cap.position.set(cx, baseY+ridge, cz); cap.castShadow=false; GFX.world.add(cap);
    // triangular gable end-caps (flush with the eaves, apex at the ridge)
    const gMat=sharedMat(pal.wall,{rough:.95});
    for(const end of [-1,1]){
      if(along==='x') gableTri(cx+end*len/2, cz, span, ridge, baseY, 'x', gMat);
      else            gableTri(cx, cz+end*len/2, span, ridge, baseY, 'z', gMat);
    }
  }

  // scatter a few INTERIOR furniture props into a room cell — low tables, shelves,
  // a crate or two — so rooms read as inhabited instead of empty shells. These ARE
  // collidable cover boxes (so they double as in-room cover + vault/mantle targets),
  // kept low + away from the room centre so they never seal a doorway or block nav.
  function addFurniture(rx,rz,rw,rd,rng){
    const n=Math.floor(rng()*2.5);                            // 0..2 props
    for(let k=0;k<n;k++){
      const px=rx+(rng()-.5)*Math.max(0,rw-2), pz=rz+(rng()-.5)*Math.max(0,rd-2);
      const kind=rng();
      if(kind<0.4)      addBox(px,pz, 1.4, 0.7, 0.8, 0x40362a, {rough:.85});            // table / desk
      else if(kind<0.7) addBox(px,pz, 0.8, 0.5, 1.6, 0x3a3026, {rough:.9});             // shelf / cabinet
      else              addBox(px,pz, 0.9, 0.9, 0.9, 0x2f2a22, {rough:.85});            // stacked crate
    }
  }

  // Building: outer shell (4 walls + a doorway + swinging door) PARTITIONED
  // into 2–4 rooms by internal walls, each with a doorway gap. Loot + cover are
  // distributed per-room. Larger footprints get a second floor: a raised slab
  // over part of the plan, a low parapet, and a stair ramp up. Everything is
  // built from addBox/addDoor so the colliders/solids/doors model is unchanged —
  // AI + player collision keep working with zero new concepts.
  //
  // DRESSING (feat/building-geo): on top of that exact structural shell we add a
  // foundation plinth, a top cornice + roof slab + parapet, recessed windows on
  // the solid walls, and an entry lintel/stoop — ALL purely visual (deco: no
  // colliders/solids), so silhouettes + detail improve while collision, AI,
  // vaulting, loot, spawns and the minimap stay identical.
  //
  // `facing` picks WHICH wall carries the entrance ('S' -Z [default], 'N' +Z,
  // 'W' -X, 'E' +X) so callers can aim the door at a road / yard gate and never
  // leave a building sealed behind a fence. The other three walls stay solid.
  // ROBUSTNESS: a building ALWAYS gets exactly one outer doorway + door, and the
  // door is reachable because its wall faces open ground by construction.
  function addBuilding(cx,cz,w,d,h,rng,wallColor,facing){
    const t=0.4, gw=2.6, pal=buildingPalette(wallColor||0x3a414a), col=pal.wall;
    facing=facing||'S';
    // A MINORITY of raid buildings are LOCKED behind a key — a risk/reward cache the
    // player can crack once they're carrying an Office Key. Kept rare (~22%) and only
    // in raids (never the hub) so it never gates the common path: most buildings stay
    // open, objectives + extract live in the open world, so a locked door only ever
    // walls off that one building's own indoor loot. rng is seeded → deterministic.
    // Gate on S.run (set the moment a raid begins, before buildRaid runs) — S.mode is
    // only flipped to RAID at the very end of buildRaid, so it isn't RAID yet here.
    const lockKey = (S.run && rng()<0.22) ? 'key_office' : null;
    reserveFootprint(cx,cz,w,d);                       // claim this plot so the layout
                                                       // generators won't overlap it with a neighbour
    // ---- foundation plinth: a short, slightly oversized base slab so the
    // building sits planted on the ground with a baseboard band (visual only).
    addBox(cx, cz, w+0.5, d+0.5, 0.45, pal.trim, {...deco, baseY:0, rough:.95});
    // four walls: the entrance wall gets a gap+door, the rest are solid panels.
    // S/N run along X at fixed z; W/E run along Z at fixed x.
    // The doorway gap is centred on the wall (gap offset 0 → centre); the door's
    // hinge corner is therefore (wall centre − gw/2) so the gw-wide leaf spans the
    // gap exactly. The door's axis MATCHES the wall it's punched in: S/N walls run
    // along X (axis 'x'); W/E walls run along Z (axis 'z').
    if(facing==='S'){ wallWithGap('x',cx,w,cz-d/2,h,col,0,gw); addDoor(cx-gw/2,cz-d/2,'x',gw,h,pal,lockKey); }
    else            { addBox(cx, cz-d/2, w, t, h, col); }                  // front (-Z)
    if(facing==='N'){ wallWithGap('x',cx,w,cz+d/2,h,col,0,gw); addDoor(cx-gw/2,cz+d/2,'x',gw,h,pal,lockKey); }
    else            { addBox(cx, cz+d/2, w, t, h, col); }                  // back (+Z)
    if(facing==='W'){ wallWithGap('z',cz,d,cx-w/2,h,col,0,gw); addDoor(cx-w/2,cz-gw/2,'z',gw,h,pal,lockKey); }
    else            { addBox(cx-w/2, cz, t, d, h, col); }                  // left (-X)
    if(facing==='E'){ wallWithGap('z',cz,d,cx+w/2,h,col,0,gw); addDoor(cx+w/2,cz-gw/2,'z',gw,h,pal,lockKey); }
    else            { addBox(cx+w/2, cz, t, d, h, col); }                  // right (+X)

    // ---- windows on the SOLID outer walls (skip the entrance wall) ----------
    // drawn just outside each wall's plane; never on the doorway wall so the
    // entrance reads clean. Decorative — the wall collider is unchanged.
    if(facing!=='S') addWindows('x', cx, w, cz-d/2, h, -1, pal, rng);
    if(facing!=='N') addWindows('x', cx, w, cz+d/2, h, +1, pal, rng);
    if(facing!=='W') addWindows('z', cz, d, cx-w/2, h, -1, pal, rng);
    if(facing!=='E') addWindows('z', cz, d, cx+w/2, h, +1, pal, rng);

    // ---- top cornice + roof ------------------------------------------------
    // a thin overhanging band at the wall top, then a roof. The roof SLAB is the
    // only added solid (so you can't shoot in from straight above); it's 0.25 tall
    // so AI cover (needs >COVER_H) never picks it up. ROOF VARIETY breaks the old
    // "stack of open flat boxes" look: small/short buildings get a PITCHED roof
    // (residential), bigger/taller ones keep a FLAT roof with parapet + rooftop kit
    // (commercial/industrial). Both are dressing-only above the structural shell.
    const pitched = (h<6 && Math.max(w,d)<=12 && rng()<0.6);
    // a thin overhanging cornice band at the wall top (visual) + a single SOLID
    // ceiling slab flush ON the wall top so you can't shoot/see in from straight
    // above. Exactly ONE roof cap follows: a pitched cap whose eaves sit on this
    // slab, OR a flat parapet — never both (the old code always laid a flat slab
    // AND then floated a pitched roof 0.25u above it → a visible double roof).
    addBox(cx, cz, w+0.4, d+0.4, 0.18, pal.trim, {...deco, baseY:h-0.18, cast:false}); // cornice
    addBox(cx, cz, w, d, 0.25, pal.wall, {collide:false, baseY:h, rough:.95});          // ceiling slab (solid for LOS)
    if(pitched){
      // eaves rest right on the ceiling slab top (h+0.25) — no floating gap.
      addPitchedRoof(cx, cz, w, d, h+0.25, pal);
    } else {
      // flat roof: parapet lip (4 thin runs around the roof edge) — visual
      addBox(cx, cz-d/2, w, 0.18, 0.5, pal.trim, {...deco, baseY:h+0.25, cast:false});
      addBox(cx, cz+d/2, w, 0.18, 0.5, pal.trim, {...deco, baseY:h+0.25, cast:false});
      addBox(cx-w/2, cz, 0.18, d, 0.5, pal.trim, {...deco, baseY:h+0.25, cast:false});
      addBox(cx+w/2, cz, 0.18, d, 0.5, pal.trim, {...deco, baseY:h+0.25, cast:false});
      // rooftop kit (vent/AC + a stair penthouse box) on bigger roofs for silhouette
      if(w>=9 && d>=9 && rng()<0.8){
        const rx=cx+(rng()-.5)*(w-3), rz=cz+(rng()-.5)*(d-3);
        addBox(rx, rz, 1.4, 1.0, 0.8, pal.trim, {collide:false, solid:false, baseY:h+0.25, rough:.7, metal:.3});
        if(rng()<0.5){ const px=cx+(rng()-.5)*(w-3), pz=cz+(rng()-.5)*(d-3);
          addBox(px, pz, 2.0, 2.0, 1.4, pal.wall, {collide:false, solid:false, baseY:h+0.25, rough:.9}); }
      }
    }

    // ---- entry detail: a lintel band + awning over the door + a stoop slab ---
    // placed on the entrance wall; purely visual cue that says "way in".
    {
      const ez = facing==='S' ? cz-d/2 : facing==='N' ? cz+d/2 : cz;
      const exx= facing==='W' ? cx-w/2 : facing==='E' ? cx+w/2 : cx;
      const eFace = facing==='S'?-1 : facing==='N'?+1 : facing==='W'?-1 : +1;
      const horiz = facing==='S'||facing==='N';            // entrance wall runs along X?
      const lintY = Math.min(h-0.4, 3.2);                  // sit just above the door header
      // doorway is centred on the wall, so the entry kit centres at the wall centre.
      // shallow awning ledge just proud of the wall over the door
      const aw=gw+1.0;
      if(horiz) addBox(cx, ez+eFace*0.5, aw, 1.0, 0.12, pal.trim, {...deco, baseY:lintY, cast:false});
      else      addBox(exx+eFace*0.5, cz, 1.0, aw, 0.12, pal.trim, {...deco, baseY:lintY, cast:false});
      // a flat stoop/step on the ground at the threshold
      if(horiz) addBox(cx, ez+eFace*0.8, gw+0.4, 1.2, 0.14, pal.trim, {...deco, baseY:0, cast:false});
      else      addBox(exx+eFace*0.8, cz, 1.2, gw+0.4, 0.14, pal.trim, {...deco, baseY:0, cast:false});
    }

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

    // ---- distribute loot + cover + furniture across rooms ------------------
    const types=['locker','weapon','med','safe'];
    const roomW = along==='x' ? L/rooms : w;          // per-room footprint for furniture spread
    const roomD = along==='x' ? d : L/rooms;
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
      // interior furniture: a couple of low props per room so it reads inhabited
      // (they double as cover / vault targets; kept clear of the room centre).
      const frx = along==='x' ? cx+rc : cx;
      const frz = along==='x' ? cz : cz+rc;
      addFurniture(frx, frz, roomW-1.5, roomD-1.5, rng);
    }

    // ---- optional WALKABLE second floor -----------------------------------
    // Big + tall buildings get a real upper level the player can climb to and walk
    // on. The slab is a FLOOR collider (walkable, never a ground-level wall), laid
    // as 2–4 panels AROUND a stair-well hole so the climb actually breaks through to
    // the top. A staircase of floor-collider treads rises from the ground floor up
    // through that hole; the player auto-steps up the treads and walks out onto the
    // slab. A guard parapet rings the edge (visual + LOS only — overhead geometry
    // can't be a 2D wall without blocking the ground floor beneath it).
    if(w>=10 && d>=10 && h>=6.5 && rng()<0.6){
      const fyTop = Math.min(h-2.2, 3.2);              // walking SURFACE height (leave headroom under the wall top)
      const slabT = 0.3, fy = fyTop - slabT;           // slab base so its TOP == fyTop
      const fw=w-t, fd=d-t;                             // slab reaches flush to the inner wall faces
      const minX=cx-fw/2, maxX=cx+fw/2, minZ=cz-fd/2, maxZ=cz+fd/2;
      // staircase against a back corner, ascending toward +Z; its top-landing rect
      // becomes the hole we leave in the slab so the player emerges onto the floor.
      const sx=minX+1.2, sz0=minZ+0.6;
      const hole=addStairs(sx, sz0, fyTop, 'z', col);  // treads rise ground→fyTop
      // hole = the stair well. Widen it on the X sides so the player doesn't catch
      // the slab lip laterally, but keep the +Z exit edge FLUSH with the top tread
      // (a gap here would drop the player between the last step and the slab).
      const hMinX=Math.max(minX, hole.minX-0.2), hMaxX=Math.min(maxX, hole.maxX+0.2);
      const hMinZ=minZ,                          hMaxZ=Math.min(maxZ, hole.maxZ);
      // lay the slab as floor panels around the hole (top of each panel == fyTop):
      //   north band (z > hole) full width, then the two side bands beside the hole.
      const fopt={floor:true, baseY:fy, rough:.85};
      if(hMaxZ < maxZ)  addBox(cx, (hMaxZ+maxZ)/2, fw, maxZ-hMaxZ, slabT, col, fopt);          // beyond the well
      if(hMinX > minX)  addBox((minX+hMinX)/2, (hMinZ+hMaxZ)/2, hMinX-minX, hMaxZ-hMinZ, slabT, col, fopt); // left of well
      if(hMaxX < maxX)  addBox((hMaxX+maxX)/2, (hMinZ+hMaxZ)/2, maxX-hMaxX, hMaxZ-hMinZ, slabT, col, fopt); // right of well
      // guard parapet around the slab edge (visual + LOS; not a collider)
      addBox(cx, maxZ, fw, 0.16, 0.9, pal.trim, {collide:false, baseY:fyTop});
      addBox(cx, minZ, fw, 0.16, 0.9, pal.trim, {collide:false, baseY:fyTop});
      addBox(minX, cz, 0.16, fd, 0.9, pal.trim, {collide:false, baseY:fyTop});
      addBox(maxX, cz, 0.16, fd, 0.9, pal.trim, {collide:false, baseY:fyTop});
      // upper-level cover crates seated ON the slab. LOS-only (collide:false): a
      // ground-level 2D collider here would also wall off a phantom pillar on the
      // floor directly below, and groundTopAt would lift a ground-floor player onto
      // the crate top — both artifacts of 2D colliders for OVERHEAD props. They
      // still block bullets/sight (solids), so they read as upper-floor cover.
      if(rng()<0.6) addBox(cx+(rng()-.3)*(fw-3.5), maxZ-1.5-rng()*(fd-4), 1.2, 1.2, 1.0, 0x2a2f33, {collide:false, baseY:fyTop});
      if(rng()<0.5) addBox(cx+(rng()-.7)*(fw-3.5), maxZ-1.5-rng()*(fd-4), 1.4, 0.9, 0.9, 0x2a2f33, {collide:false, baseY:fyTop});
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
        const small = rng()>=0.78;                    // some storefronts are smaller
        const fw = small ? bw*0.8 : bw, fd = small ? bd*0.8 : bd;
        if(!footprintFree(x,z,fw,fd,2)) continue;     // don't fuse into a jittered neighbour
        addBuilding(x,z,fw,fd,bh,rng,col,faceRoad);
      }
      // sidewalk cover flanking the road
      if(rng()<0.6){ const cz=(roadW/2-0.5)*(rng()<.5?-1:1); addBox(x+(rng()-.5)*step*0.3, cz, 1.4,1.4,1.3,0x33392c,{baseY:terrainHeight(x,cz)}); }
    }
    // a couple of cross-street blocks at the ends so it isn't a bare corridor
    for(let c=0;c<6;c++){ const cx=(rng()*2-1)*(H-10), cz=(rng()*2-1)*(H-10);
      if(Math.abs(cz)<roadW/2+2 || Math.hypot(cx,cz)<16) continue; addBox(cx,cz,1.6,1.6,1.5,0x33392c,{baseY:terrainHeight(cx,cz)}); }
  }

  // SCATTER layout: buildings + cover sprinkled across the arena. Now footprint-
  // aware: each building rejects positions that would overlap an already-placed one
  // (the old version interpenetrated freely, which is the #1 reason proc buildings
  // read as "bad" — fused walls, doors sealed by a neighbour). A few retries per
  // building keep the count up while guaranteeing clean separation.
  function buildScatter(H,i,rng){
    const nB=10+i*2;
    const FACES=['S','N','W','E'];
    for(let b=0;b<nB;b++){
      const big = rng()<0.6;
      const w = big ? 7+rng()*7 : 5+rng()*4;
      const d = big ? 7+rng()*7 : 5+rng()*4;
      const h = big ? 4+rng()*4 : 3.5+rng()*3;
      const col=0x363c44+Math.floor(rng()*0x0a0a0a);
      const face=FACES[Math.floor(rng()*4)];
      // find a non-overlapping spot (off the spawn ring); skip this building if the
      // arena's too crowded after a few tries (keeps geometry clean over count).
      let bx,bz,placed=false;
      for(let tr=0;tr<6;tr++){
        bx=(rng()*2-1)*(H-12); bz=(rng()*2-1)*(H-12);
        if(Math.hypot(bx,bz)<16) continue;
        if(footprintFree(bx,bz,w,d,3)){ placed=true; break; }
      }
      if(!placed) continue;
      addBuilding(bx,bz,w,d,h,rng,col,face);
      // a loose lean-to cover panel beside the smaller ones (kept off other plots)
      if(!big && rng()>.4){ const lx=bx+(rng()*8-4), lz=bz+(rng()*8-4);
        if(footprintFree(lx,lz,3,1,1)) addBox(lx,lz,3+rng()*3,1,1.4,0x2a2f33,{baseY:terrainHeight(lx,lz)}); }
    }
    // open-ground cover scatter — seated on the terrain so it reads as planted
    for(let c=0;c<14;c++){ const cx=(rng()*2-1)*(H-8), cz=(rng()*2-1)*(H-8); if(Math.hypot(cx,cz)<10) continue; if(!footprintFree(cx,cz,1.6,1.6,0.5)) continue; addBox(cx,cz,1.6,1.6,1.5,0x33392c,{baseY:terrainHeight(cx,cz)}); }
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
    // NOTE: the old open-ground "loot crates" that scattered item PICKUPS on the
    // ground when opened have been removed (user: no item-dropping loot boxes, and no
    // random crates strewn outside buildings). Loot now comes only from SEARCHABLE
    // containers (placed INSIDE buildings + a few staged in the raid) and corpses —
    // both feed the dual-panel loot UI, never a burst of ground pickups.
    // resource nodes (Harvest)
    const nNodes=3+Math.floor(rng()*3);
    for(let n=0;n<nNodes;n++){ let nx,nz,tr=0; do{nx=(rng()*2-1)*(H-10);nz=(rng()*2-1)*(H-10);tr++;}while(Math.hypot(nx,nz)<16&&tr<20); Harvest.spawn(nx,nz,rng); }
    // NOTE: searchable containers used to ALSO be scattered randomly across the open
    // ground here (safes/lockers sitting outside for no reason). Removed per user — the
    // ONLY containers now are the ones placed INSIDE buildings (addBuilding, per-room),
    // plus corpse loot. Buildings spawn several rooms each with a high per-room
    // container chance, so in-building loot remains plentiful without the outdoor litter.
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
    // SAFE SPAWN: drop in on a clear PERIMETER spot away from enemies (everything
    // — geometry, crates, objective props, enemies — is already placed, so the
    // clearance + enemy-distance checks see the final arena). Face toward centre.
    const sp=findSafeSpawn(Player.RADIUS, H);
    Player.spawn(sp.x, sp.z, sp.face!=null?sp.face:ang);
    S.setMode(MODE.RAID); document.getElementById('threats').style.display='block';
    Objectives.refreshLine();
    UI.refreshHUD(); Events.emit('threats:changed');
    UI.banner(`Sector ${String.fromCharCode(65+i)}`, `Stop ${i+1} · ${DATA.stops.count(i)} hostiles`); Audio.play('notify');
    if(!Input.locked && !Input.isTouch) GFX.dom.requestPointerLock();
  }
  // (the open-ground wooden loot crate — dressCrate + crate — was REMOVED: it spawned
  //  item pickups on the ground when opened, which is the loot-box behaviour the user
  //  wanted gone, and it was always placed outside buildings. Loot is now containers +
  //  corpses only.)
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
    near.action();
  }
  function interactAny(){ if(near && near.action){ near.action(); } }
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
  return { reset, buildHub, buildRaid, moveActor, vaultProbe, spotClear, groundTopAt, findSafeSpawn, interact, interactAny, update, addInteract:(o)=>interactables.push(o),
           mapInfo:()=>({boxes:mapBoxes, extract:extractPos?{x:extractPos.x,z:extractPos.z}:null, size:74}), get solids(){return solids;} };
})();
