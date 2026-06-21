// player.js — SYS: Player. Movement, sprint/stamina, health, damage, death. Owns
// the rig transform via GFX.yaw. Reads Input + Progression-derived stats.
import { T } from "./three.js";
import { S, MODE, Events } from "./state.js";
import { DATA } from "./data.js";
import { clamp } from "./util.js";
import { GFX } from "./gfx.js";
import { Progression } from "./progression.js";
import { Status } from "./status.js";
import { Input } from "./input.js";
import { World } from "./world.js";
import { Inventory } from "./inventory.js";
import { UI } from "./ui.js";
import { Audio } from "./audio.js";
import { Perception } from "./perception.js";
import { Raid } from "./raid.js";

export const Player = (function(){
  const RADIUS=0.45, HEIGHT=1.7, BASE=6.2, SPRINT=1.6, JUMP=4.6, GRAV=15;
  let vig=0, stepT=0, velY=0, jumpY=0, grounded=true, movingFlag=false, eyeCur=HEIGHT;
  // ---- head bob (feat/movement-feel) ---------------------------------------
  // Subtle walk/run camera bob, composited through GFX.setBob (the same render-time
  // additive weapons.js uses) so it honors the head-bob settings toggle + reduced-
  // motion, never accumulates into the rig, and never throws off ADS alignment.
  // weapons.js ALSO drives setBob while a gun viewmodel is active in a RAID and runs
  // AFTER Player.update, so it wins there (its bob is the same walk/run feel); this
  // fills the gaps weapons.js leaves — the HUB safehouse and any moment with no gun —
  // so you always get head bob while moving. bobT is the cadence clock.
  let bobT=0, bobX=0, bobY=0;
  // ---- wall-climb / mantle-up (feat/movement-feel) -------------------------
  // Distinct from vaultProbe (which only handles obstacles up to ~2.9 you can clear
  // or stand on): a dedicated "run at a wall + look straight UP → climb it" mantle.
  // wallLatch makes one approach = one climb attempt (no per-frame re-trigger).
  let wallLatch=false;
  const CLIMB_MAX=4.2;          // a wall whose top is at/below this can be climbed up
  const LOOK_UP_MIN=1.0;        // pitch (rad) above this counts as "looking ~fully up"
  // ---- traversal: vault / mantle (proper FPS clamber) ----------------------
  // World.vaultProbe classifies the obstacle ahead and returns ONE of three
  // moves; player.js then carries the body along a believable, COLLISION-CHECKED
  // path (rise to the lip → carry across → settle), interpolating Y as well as XZ
  // so it never teleports and never clips through a wall:
  //   • 'vault'      — OVER a low/thin obstacle, ending back at ground on the far side.
  //   • 'mantleOnto' — UP ONTO a mid surface (crate/table), ending standing on top.
  //   • 'mantleUp'   — UP a high ledge/wall-top, ending standing on the upper level.
  // The path runs through the obstacle's LIP at peak height (top + a little), so a
  // vault arcs over and back down while a mantle climbs and STAYS up. `groundY`
  // tracks the standing floor under the player so post-vault gravity is correct
  // (you can now end a traversal standing ON a crate, not snapped back to y=0).
  // Trigger = JUMP key while moving into a surmountable face (a plain hop still
  // happens when there's nothing to vault). jumpLatch = one press → one traversal.
  let vault=null, jumpLatch=false, groundY=0, groundCur=0;
  function inVault(){ return !!vault; }
  function startVault(plan){
    const p=GFX.yaw.position;
    // three keyframes for the body's FEET: start → lip (atop the obstacle) → land.
    // Y is the foot height; eye = footY + HEIGHT. peak sits just over the lip so
    // the camera clears the obstacle, then drops to landY (0 vault / top mantle).
    const startY=groundY;
    const peakY=plan.top + (plan.type==='vault'?0.12:0.18);
    vault={ t:0, dur:plan.dur||0.45, type:plan.type,
            sx:p.x, sz:p.z, lipx:plan.lip.x, lipz:plan.lip.z, lx:plan.land.x, lz:plan.land.z,
            cx:p.x, cz:p.z, cy:startY,            // last KNOWN-CLEAR position on the path
            startY, peakY, landY:plan.landY||0, blocked:false };
    Audio.play('ui');
  }
  // ---- WALL-CLIMB probe (run into a wall + look straight up → mantle up) -----
  // vaultProbe ignores anything taller than ~2.9 (you can't surmount it normally).
  // This is the deliberate, input-gated exception: heading INTO a wall while looking
  // ~straight up, climb UP it. We march forward to find the first solid face ahead,
  // read its TOP from the standable height just past that face, and — if the top is
  // within CLIMB_MAX and the surface up there is clear to stand on — synthesize a
  // mantle-up plan and hand it to startVault (so the existing collision-checked,
  // height-aware tickVault carries the body up; no separate climb code path). Returns
  // a plan or null. Pure read of World helpers; never mutates world state.
  function wallClimbProbe(pos, fwd){
    const fl=Math.hypot(fwd.x,fwd.z)||1e-4, nx=fwd.x/fl, nz=fwd.z/fl;
    // find the nearest blocking face ahead (fine march out to ~1.1u).
    let hitT=-1;
    for(let reach=0.3; reach<=1.1; reach+=0.1){
      if(!World.spotClear(pos.x+nx*reach, pos.z+nz*reach, RADIUS*0.85)){ hitT=reach; break; }
    }
    if(hitT<0) return null;                                   // nothing to climb
    // the standable TOP of the wall = the first positive ground height as we march
    // PAST the blocking face (spotClear trips a body-radius BEFORE the face, so a
    // fixed offset can land short of the AABB — scan until groundTopAt goes positive).
    let top=0;
    for(let t=hitT; t<=hitT+0.8; t+=0.1){
      const g=World.groundTopAt(pos.x+nx*t, pos.z+nz*t);
      if(g>0){ top=g; break; }
    }
    if(top<=groundY+0.4) return null;                         // not a real wall (a step / nothing)
    if(top>groundY+CLIMB_MAX) return null;                    // out of climb reach
    // LANDING: stand ON TOP of the wall. We scan forward from just past the face for
    // a foot point whose ground height is the wall top (you're ON it) and where no
    // OTHER collider rises above that top. The landing sits INSIDE the wall's own
    // footprint, so a ground-level spotClear would always fail (it overlaps the wall
    // we're climbing) — hence the HEIGHT-AWARE test (same idea as tickVault): clear
    // means "nothing taller than the wall top is here." Prefer a spot ~a body-radius
    // in from the lip so we settle inboard, not teetering on the edge.
    let land=null;
    for(let t=hitT+0.15; t<=hitT+1.4; t+=0.15){
      const lx=pos.x+nx*t, lz=pos.z+nz*t;
      const g=World.groundTopAt(lx,lz);
      if(Math.abs(g-top)<0.3){ land={x:lx,z:lz}; if(t>=hitT+RADIUS+0.3) break; }   // on the top; keep going a bit for an inboard spot
      else if(g>top+0.3) break;          // something TALLER ahead (a second storey) → stop
      else if(land) break;               // ran off the far edge after finding top → settle on last good
    }
    if(!land) return null;                                   // no standable top found → can't climb
    const lip={ x:pos.x+nx*(hitT+0.05), z:pos.z+nz*(hitT+0.05) };
    // a touch slower than a normal mantle — it's a taller climb.
    return { type:'mantleUp', land, landY:top, top, rise:top-groundY, lip, dur:0.75 };
  }
  // sample the planned path at parameter k∈[0,1]: a 2-segment lerp start→lip→land
  // for XZ, with Y rising to peakY at the lip then easing to landY.
  function vaultSample(k){
    const v=vault;
    let x,z;
    if(k<0.5){ const t=k/0.5; x=v.sx+(v.lipx-v.sx)*t; z=v.sz+(v.lipz-v.sz)*t; }
    else      { const t=(k-0.5)/0.5; x=v.lipx+(v.lx-v.lipx)*t; z=v.lipz+(v.lz-v.lipz)*t; }
    // Y: smooth up to peak by the lip (k=0.5), then ease down to landY. A vault
    // dips back to 0; a mantle settles on top.
    let y;
    if(k<0.5){ const t=k/0.5; y=v.startY+(v.peakY-v.startY)*(t*t*(3-2*t)); }
    else      { const t=(k-0.5)/0.5; y=v.peakY+(v.landY-v.peakY)*(t*t*(3-2*t)); }
    return {x,z,y};
  }
  function tickVault(dt){
    vault.t+=dt; const k=Math.min(1, vault.t/vault.dur);
    const ease=k<0.5 ? 2*k*k : 1-Math.pow(-2*k+2,2)/2;            // easeInOutQuad over the whole move
    const s=vaultSample(ease);
    const p=GFX.yaw.position;
    // CLAMP XZ — HEIGHT-AWARE. The OLD test re-probed every collider at the next
    // point, but the planned path runs OVER (vault) or ONTO (mantle) the very
    // obstacle we're surmounting — whose footprint the lip/landing sit inside — so
    // a plain spotClear always failed there, froze the body at the near face, and
    // the settle push then SHOVED YOU BACK (the "vault just pushes you back" bug).
    // Fix: a point is clear to move into if our FEET (s.y) are at/above whatever
    // stands there — i.e. we only stop for something TALLER than our current feet.
    // groundTopAt(x,z) = tallest collider top under (x,z); if feet clear it (with a
    // little slack) we glide over/onto it. We still STOP dead at a real taller wall
    // (its top > our feet), so we never clip through a building. A thin spotClear at
    // foot level is kept ONLY for the start of the rise (feet still near ground), to
    // catch a wall hugging the obstacle before we've lifted over the lip.
    const obstTop = World.groundTopAt ? World.groundTopAt(s.x,s.z) : 0;
    const feetClearHere = s.y >= obstTop - 0.25;                 // feet at/above what's here
    const lowRise = s.y < 0.35;                                  // still basically on the ground
    const groundGuard = !lowRise || World.spotClear(s.x,s.z,RADIUS*0.5);
    // CONTIGUITY: a real vault/mantle plan is always a clear corridor (world.js
    // marchLanding proves it), so the only way a sample fails is a freak case where
    // something TALLER than the body sits on the path. If that ever happens, latch
    // `blocked` and stop advancing for the rest of the move — never let a later
    // far-side sample (clear again past the wall) teleport the body THROUGH it.
    if(!(feetClearHere && groundGuard)) vault.blocked=true;
    else if(!vault.blocked){ vault.cx=s.x; vault.cz=s.z; vault.cy=s.y; }
    p.x=vault.cx; p.z=vault.cz;
    // feet at cy → eye at cy+HEIGHT; keep the smoothed eye in sync for after.
    GFX.yaw.position.y=vault.cy+HEIGHT;
    eyeCur=HEIGHT;
    // a brief downward pitch nudge so the camera "looks at the lip" mid-clamber
    const dip=Math.sin(k*Math.PI)*0.16;
    GFX.pitch.rotation.x=clamp(GFX.pitch.rotation.x*(1-dt*6) - dip*dt*6, -1.5, 1.5);
    if(k>=1){
      jumpY=0; velY=0; grounded=true;
      // record the standing floor (top of whatever we ended on) FIRST, so the
      // settle push knows our foot height and won't shove us off a surface we just
      // mantled onto (it only pushes out of taller walls, never the landing surface).
      groundY = vault.landY;
      World.moveActor(GFX.yaw.position, {x:0,z:0}, RADIUS, groundY);
      // re-read the floor in case the settle nudge moved us onto/off a neighbour.
      groundY = World.groundTopAt(GFX.yaw.position.x, GFX.yaw.position.z);
      groundCur = groundY;                  // snap the smoothed floor so we don't ease post-mantle
      GFX.yaw.position.y = groundY + HEIGHT;
      eyeCur=HEIGHT;
      vault=null;
    }
  }
  function spawn(x,z,faceY){ vault=null; jumpLatch=false; wallLatch=false; bobT=0; bobX=0; bobY=0; groundY=World.groundTopAt?World.groundTopAt(x,z):0; groundCur=groundY; jumpY=0; velY=0; grounded=true; GFX.yaw.position.set(x,groundY+HEIGHT,z); GFX.yaw.rotation.y=faceY||0; GFX.pitch.rotation.x=0; }
  function heal(n){ S.player.health=Math.min(S.player.maxHealth, S.player.health+n); Events.emit('player:changed'); }

  // ---- simplified healing + buff consumables (added: feat/lns-throwables-healing)
  // Kept in their own functions so the damage-mitigation path (damage(), owned by
  // another agent) is never touched. A consumable now takes a short USE TIME with a
  // cosmetic progress bar (Status.beginUse) before its effect lands; effect data
  // comes from DATA.consumables. No hunger/thirst/weight — extraction shooter, not
  // a survival sim. ----
  // is this def a usable consumable (med/food/stim/etc.)? Used by the heal key, the
  // consumables hotbar, and the mobile quick-bar to know what's quick-usable.
  function isConsumable(def){ return !!def && (def.type==='med'||def.type==='food'); }
  // begin using a SPECIFIC consumable instance by uid (hotbar + double-click path).
  // Spends exactly ONE unit (Inventory.consumeOne), then plays the use animation and
  // lands the effect on completion. Returns true if a use started.
  function useConsumable(uid){
    if(Status.isUsing()) return false;                  // one use at a time
    const loc=Inventory.locate(uid); if(!loc){ UI.toast('Item gone','neg'); return false; }
    const def=loc.item.def;
    if(!isConsumable(def)){ return false; }
    const cfg=DATA.consumables[def.id]||{ useTime:0.1, heal:def.heal||0, cure:def.cure, buff:def.buff, buffDur:12, buffMag:1 };
    // consume ONE up-front so it can't be double-used mid-animation (USE-1-NOT-STACK)
    if(!Inventory.consumeOne(uid)){ UI.toast('Item gone','neg'); return false; }
    UI.toast(`Using ${def.name}…`,'neu');
    Status.beginUse(cfg.useTime, (cfg.name||def.name).toUpperCase(), ()=>applyConsumable(def, cfg));
    return true;
  }
  function useMed(){
    if(Status.isUsing()){ return; }                     // one use at a time
    const grids = S.mode===MODE.RAID?Inventory.carried():[Inventory.stash()];
    let found=null;
    for(const g of grids){ const t=g.items.find(i=>i.def.type==='med'); if(t){ found=t; break; } }
    if(!found){ UI.toast('No meds','neg'); return; }
    useConsumable(found.uid);                            // route through the use-1 path
  }
  // land the effect when the use-animation completes (callback from Status).
  function applyConsumable(def, cfg){
    if(S.mode!==MODE.RAID && S.mode!==MODE.HUB) return;
    if(cfg.heal) heal(cfg.heal);
    if(cfg.regen) Status.apply('regen', cfg.regenDur||5, cfg.regen);          // heal-over-time
    if(cfg.cure) Status.clear(cfg.cure);
    if(cfg.buff) Status.apply(cfg.buff, cfg.buffDur||12, cfg.buffMag||1);     // timed buff (speed/stamina)
    UI.toast(`Used ${def.name}`,'pos');
    Events.emit('player:changed');
  }
  // ---- LOOTABLE-CRATE AIM STENCIL (feat/inventory-ui) ----------------------
  // When the player AIMS at a lootable crate that's within loot range, draw a
  // glowing outline on it so it reads as "you can loot this". Fully self-contained
  // and READ-ONLY w.r.t. world.js: we raycast the camera against the live scene and
  // recognise an UNOPENED crate body by its signature — a ~1.2m cube box mesh whose
  // material carries a non-zero emissive (world.js seeds crate bodies that way and
  // zeroes emissiveIntensity the moment a crate is opened). No world internals are
  // imported; the outline mesh is our own overlay, added to GFX.world and reused.
  const LOOT_RANGE=2.6;                 // crate interactable radius (2.4) + a little reach
  let crateRay=null, outline=null;
  function isCrateMesh(o){
    if(!o || !o.isMesh || !o.geometry || !o.material) return false;
    const g=o.geometry, p=g.parameters;
    if(!p || g.type!=='BoxGeometry') return false;
    // crate body = ~1.2m cube (other props are 0.9 cubes / non-cube boxes)
    const w=p.width||0, h=p.height||0, d=p.depth||0;
    const cube = Math.abs(w-h)<0.05 && Math.abs(h-d)<0.05;
    if(!cube || w<1.05 || w>1.4) return false;
    const m=Array.isArray(o.material)?o.material[0]:o.material;
    // unopened: an emissive tint that's still lit (opened crates → intensity 0)
    return !!(m && m.emissive && (m.emissiveIntensity||0) > 0.001);
  }
  function ensureOutline(){
    if(!outline){
      const geo=new T.EdgesGeometry(new T.BoxGeometry(1,1,1));
      const mat=new T.LineBasicMaterial({ color:0xffd27a, transparent:true, opacity:0.9, depthTest:false });
      outline=new T.LineSegments(geo, mat); outline.renderOrder=999; outline.visible=false;
    }
    if(outline.parent!==GFX.world){ try{ GFX.world.add(outline); }catch(_){ } }
    return outline;
  }
  function updateCrateAim(){
    if(S.mode!==MODE.RAID){ if(outline) outline.visible=false; return; }
    if(!crateRay) crateRay=new T.Raycaster();
    crateRay.far=LOOT_RANGE+0.6;
    const cam=GFX.camera, origin=new T.Vector3(), dir=new T.Vector3();
    cam.getWorldPosition(origin); cam.getWorldDirection(dir);
    crateRay.set(origin, dir);
    let hit=null;
    let list=[]; try{ list=crateRay.intersectObjects(GFX.world.children, true); }catch(_){ list=[]; }
    // first crate body the ray crosses within loot range (the crate's own thin deco —
    // corner braces / plank seams — aren't cubes so isCrateMesh skips them). We don't
    // gate on occlusion: the interactable system itself is distance-only, so matching
    // it keeps the highlight in lockstep with what you can actually loot.
    for(const i of list){ if(i.distance>LOOT_RANGE) break; if(isCrateMesh(i.object)){ hit=i; break; } }
    if(hit){
      const ol=ensureOutline();
      const o=hit.object; o.updateWorldMatrix(true,false);
      const c=new T.Vector3(); o.getWorldPosition(c);
      const p=o.geometry.parameters, s=(p.width||1.2);
      ol.position.copy(c); ol.scale.set(s+0.06, s+0.06, s+0.06);
      // gentle pulse so the highlight reads as "active"
      ol.material.opacity = 0.55 + 0.35*Math.abs(Math.sin(performance.now()*0.005));
      ol.visible=true;
    } else if(outline){ outline.visible=false; }
  }
  function damage(n, fromPos){
    if(S.mode!==MODE.RAID) return;
    // armor + clothing mitigation: flat damage-reduction summed across worn gear
    // (helmet/armor/clothing), capped, and faded by each piece's durability.
    // Worn pieces then chip durability proportional to the hit they absorbed.
    const tot=Inventory.gearTotals();
    if(tot.dr>0){ Inventory.wearGear(n); n*=(1-tot.dr); }
    S.player.health-=n; vig=0.4; document.getElementById('vig').style.opacity='0.9';
    // subtle camera shake on a hit, scaled by how hard it landed (capped).
    try{ GFX.shake(clamp(0.12 + n*0.012, 0.12, 0.5)); }catch(_){ }
    if(fromPos){ const camA=GFX.yaw.rotation.y; const srcA=Math.atan2(fromPos.x-GFX.yaw.position.x, fromPos.z-GFX.yaw.position.z); UI.dmgDir(srcA-camA); }
    if(Math.random()<0.22) Status.apply('bleed', 8, 2);
    Events.emit('player:changed');
    if(S.player.health<=0){ S.player.health=0; Raid.onDeath(); }
  }
  function update(dt){
    if(S.mode!==MODE.RAID && S.mode!==MODE.HUB) return;
    // an in-progress vault/climb owns the body — suspend normal movement until done
    if(vault){ tickVault(dt); if(!Input.down('jump')) jumpLatch=false; Events.emit('player:tick'); return; }
    const crouch = !!Input.crouch;
    const sprint = !crouch && Input.down('sprint') && S.player.stamina>1;
    // gear ergonomics: worn armor/clothing nudge move speed (heavier plate = slower,
    // light clothing = faster). Clamped so a full plate kit never freezes you.
    const ergoMult = clamp(1 + (Inventory.gearTotals().ergo||0), 0.6, 1.25);
    const speed = BASE*Progression.moveMult()*Status.speedMult()*ergoMult*(crouch?0.5:sprint?SPRINT:1);
    const fwdV=new T.Vector3(Math.sin(GFX.yaw.rotation.y),0,Math.cos(GFX.yaw.rotation.y));
    const rightV=new T.Vector3(fwdV.z,0,-fwdV.x);
    let f=0,s=0;
    if(Input.down('forward'))f-=1; if(Input.down('back'))f+=1; if(Input.down('left'))s-=1; if(Input.down('right'))s+=1;
    if(Input.isTouch){ f+=Input.touchMove.y; s+=Input.touchMove.x; }
    const mv=new T.Vector3().addScaledVector(fwdV,f).addScaledVector(rightV,s);
    const moving=mv.lengthSq()>0.0004; movingFlag=moving;
    if(moving){ if(mv.lengthSq()>1) mv.normalize(); mv.multiplyScalar(speed*dt*(S.player.ads?0.55:1)); World.moveActor(GFX.yaw.position, mv, RADIUS, groundY); }
    // FLOOR TRACKING: the standing floor under the player is the top of whatever
    // collider they're over (0 = bare ground), so after a mantle you can WALK on a
    // crate/ledge and step OFF its edge into a fall. A small step-up tolerance lets
    // you walk up shallow lips without a full vault; a drop starts a fall.
    const floor=World.groundTopAt?World.groundTopAt(GFX.yaw.position.x, GFX.yaw.position.z):0;
    if(grounded){
      if(floor<=groundY+0.001){ groundY=floor; }                 // walked onto lower/equal ground → follow it down
      else if(floor-groundY<=0.35){ groundY=floor; }             // small lip → step up automatically
      // else: a tall face ahead — handled by the vault probe / collision, not a step
      if(floor<groundY-0.05){ grounded=false; }                  // stepped off an edge → fall
    }
    // ---- WALL-CLIMB: run INTO a wall while looking ~straight UP → mantle up ----
    // A deliberate, input-gated traversal (NOT auto): you must be pushing FORWARD
    // into a face AND have the camera pitched near full-up. wallLatch = one approach,
    // one attempt; it clears the moment you stop looking up or stop pushing forward,
    // so you can line up and try again. Pitch sign: +x = up (clamped to ~+1.5).
    const lookingUp = GFX.pitch.rotation.x >= LOOK_UP_MIN;
    const pushingFwd = f < -0.3;                                  // forward held / stick pushed forward
    if(grounded && !crouch && lookingUp && pushingFwd && !wallLatch && (S.mode===MODE.RAID||S.mode===MODE.HUB)){
      wallLatch=true;
      const plan=wallClimbProbe(GFX.yaw.position, fwdV);
      if(plan){ startVault(plan); Events.emit('player:tick'); return; }   // climb this frame
    }
    if(!(lookingUp && pushingFwd)) wallLatch=false;              // released → re-arm
    // jump + gravity (vertical only; XZ collision is 2D). The jump key is context-
    // sensitive: pressed while moving INTO a surmountable obstacle it VAULTS/CLIMBS
    // instead of a plain hop. jumpLatch makes one press = one action.
    const eye = HEIGHT*(crouch?0.72:1);
    const jumpHeld = Input.down('jump');
    if(grounded && !crouch && jumpHeld && !jumpLatch && (S.mode===MODE.RAID||S.mode===MODE.HUB)){
      jumpLatch=true;
      // probe in the direction the player is heading (movement if moving, else facing)
      const dir = moving ? mv : fwdV;
      const plan = World.vaultProbe(GFX.yaw.position, {x:dir.x,z:dir.z}, RADIUS);
      if(plan){ startVault(plan); Events.emit('player:tick'); return; }   // vault this frame
      velY=JUMP; grounded=false; Audio.play('ui');                        // nothing to vault → hop
    }
    if(!jumpHeld) jumpLatch=false;
    if(!grounded){
      velY-=GRAV*dt; jumpY+=velY*dt;
      // jumpY is the foot height ABOVE the floor we left (groundY). Land when the
      // foot reaches the floor under the CURRENT XZ — which may be lower (you stepped
      // off an edge / fell into a pit) or a mantled surface — then re-seat groundY to
      // it. This lets you fall DOWN off a crate, not stop at its top height.
      if(groundY+jumpY<=floor){ jumpY=0; velY=0; grounded=true; groundY=floor; groundCur=floor; }
    }
    eyeCur += (eye-eyeCur)*Math.min(1,dt*12);
    // visual floor SMOOTHING: groundY is the logical floor (snappy, for gravity/
    // collision); groundCur eases toward it so an auto step-up onto a low lip reads
    // as a smooth rise rather than a vertical pop. A fall (groundY drops while
    // airborne) is driven by jumpY going negative, so groundCur just follows down.
    groundCur += (groundY-groundCur)*Math.min(1,dt*14);
    GFX.yaw.position.y = groundCur + eyeCur + jumpY;
    // ---- HEAD BOB ----  subtle walk/run camera bob, composited via GFX.setBob (so
    // the head-bob toggle + reduced-motion are honored and the rig stays clean). The
    // cadence clock runs faster while moving (and a touch harder when sprinting); the
    // amount eases to 0 at rest and while airborne. ADS damps it hard so aiming holds.
    // Same shape/amplitude as the weapons.js gun bob so the feel is seamless when
    // weapons.js (which runs after us, with a gun up in a RAID) takes the wheel —
    // this owns the gap (HUB safehouse + any no-gun moment) so bob is ALWAYS present.
    bobT += dt*(moving?9:3);
    const bobOn = moving && grounded;
    const bobAmp = bobOn ? (sprint?1.15:1) : 0;
    const bobDamp = S.player.ads ? 0.25 : 1;
    bobX += (Math.sin(bobT*0.5)*0.012*bobAmp - bobX)*Math.min(1,dt*8);
    bobY += (Math.abs(Math.sin(bobT))*0.018*bobAmp - bobY)*Math.min(1,dt*8);
    try{ if(GFX.setBob) GFX.setBob(bobX*bobDamp, bobY*bobDamp); }catch(_){ }
    // footstep noise + faint sound (stealth: crouch near-silent, sprint loud)
    if(moving && grounded && S.mode===MODE.RAID){ stepT-=dt; if(stepT<=0){ stepT=crouch?0.55:sprint?0.28:0.42; Perception.footstep(GFX.yaw.position, sprint, crouch); if(!crouch) Audio.play('step'); } }
    // stamina (buff hook: Status.staminaMult boosts recovery, e.g. Focus Shot)
    if(sprint&&moving) S.player.stamina=Math.max(0,S.player.stamina-22*dt);
    else S.player.stamina=Math.min(S.player.maxStamina, S.player.stamina+14*dt*Status.staminaMult());
    // cancel an in-progress consumable use if the player sprints away (the item is
    // already consumed; cancelling just forfeits the effect — keeps "use" tactical)
    if(Status.isUsing() && sprint && moving) Status.cancelUse();
    // bleed/buff effects are owned by Status.update
    // vignette
    if(vig>0){ vig-=dt; if(vig<=0) document.getElementById('vig').style.opacity='0'; }
    updateCrateAim();   // outline a lootable crate when aimed at within range
    Events.emit('player:tick');
  }
  function resetForRaid(){ S.player.health=S.player.maxHealth; S.player.stamina=S.player.maxStamina; Status.clearAll(); Input.crouch=false; vault=null; jumpLatch=false; wallLatch=false; bobT=0; bobX=0; bobY=0; groundY=0; groundCur=0; jumpY=0; velY=0; grounded=true; }
  return { spawn, heal, useMed, useConsumable, isConsumable, damage, update, resetForRaid, isMoving:()=>movingFlag, inVault, RADIUS, HEIGHT };
})();
