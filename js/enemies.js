// enemies.js — SYS: Enemies. Role-driven AI with squad cover + flanking.
// Squad alert via Events('alert'). Hitscan return fire -> Player.damage.
//
// Cover: enemies compute cover at RUNTIME from World.solids (no world edits) —
// they seek the nearest solid that breaks LOS to the player, slot in behind it,
// peek out to fire, and duck back while reloading or just after being hit.
// Flanking: when 2+ enemies engage, roles are assigned each tick — one ANCHOR
// pins the player from cover, the rest ARC to a side to flush them out.
// Callouts: short WebAudio voice chirps on first contact, reload, and a grenade
// landing nearby (grenades detected at runtime from the scene — projectiles.js
// is untouched).
import { T } from "./three.js";
import { DATA } from "./data.js";
import { S, MODE, Clock, Events } from "./state.js";
import { GFX } from "./gfx.js";
import { fxTracer } from "./fx.js";
import { Audio } from "./audio.js";
import { World } from "./world.js";
import { Player } from "./player.js";
import { Loot } from "./loot.js";
import { Projectiles } from "./projectiles.js";

export const Enemies = (function(){
  const ray=new T.Raycaster();
  let mobs=[]; const tmp=new T.Vector3(); const camW=new T.Vector3(); const tmpA=new T.Vector3(); const tmpB=new T.Vector3();
  // cover candidates (cached per-raid; rebuilt lazily from World.solids)
  let coverPts=[]; let coverStamp=-1;
  const EYE=1.5, COVER_H=1.1; // sample heights: standing eye vs. crouched-behind-cover

  // --- squad combat memory (feat/lns-ai-grenades) ---------------------------
  // The squad shares a single "last-known player position" — updated whenever ANY
  // alert enemy has LOS. Grenade flushes + post-kill searches aim at this point
  // so the squad coordinates instead of each mob acting blind.
  const lastKnown=new T.Vector3(); let haveLastKnown=false; let lastKnownAt=-99;
  // player velocity (for leading grenade throws), sampled frame-to-frame.
  const prevPP=new T.Vector3(); let havePrevPP=false; const playerVel=new T.Vector3();
  let nextSquadNade=0; // squad-wide grenade cooldown floor so mobs don't all throw at once

  function clear(){ mobs=[]; coverPts=[]; coverStamp=-1; haveLastKnown=false; havePrevPP=false; nextSquadNade=0; }
  function list(){ return mobs; }
  function hitMeshes(){ const a=[]; for(const e of mobs) if(!e.dead) a.push(...e.parts); return a; }
  function aliveCount(){ return mobs.filter(e=>!e.dead).length; }

  // ---------- COVER: derive usable cover spots from the world's solids ----------
  // A solid is cover if it's a box tall enough to block a standing target. For
  // each we emit 4 stand-off points (one per face) the enemy can tuck behind.
  function buildCover(){
    coverPts=[];
    const solids=World.solids||[];
    for(const m of solids){
      const g=m.geometry; if(!g||!g.parameters) continue;
      // only box-ish solids; skip the ground plane (PlaneGeometry has no depth)
      if(g.type!=='BoxGeometry') continue;
      const w=g.parameters.width, h=g.parameters.height, d=g.parameters.depth;
      if(h===undefined || d===undefined) continue;
      if(h<COVER_H) continue;            // too short to hide behind
      if(w>40 && d>40) continue;         // floor-like slab, not cover
      // boxes are direct children of GFX.world (no parent transform) so the local
      // position is already world XZ — avoids a one-frame-stale world matrix.
      const cx=m.position.x, cz=m.position.z;
      const offX=w/2+0.9, offZ=d/2+0.9;  // stand just off each face
      // wide thin walls: only sample the long faces so we don't crowd corners
      coverPts.push({x:cx+offX,z:cz, ox:cx,oz:cz, hw:w/2,hd:d/2});
      coverPts.push({x:cx-offX,z:cz, ox:cx,oz:cz, hw:w/2,hd:d/2});
      coverPts.push({x:cx,z:cz+offZ, ox:cx,oz:cz, hw:w/2,hd:d/2});
      coverPts.push({x:cx,z:cz-offZ, ox:cx,oz:cz, hw:w/2,hd:d/2});
    }
    coverStamp=solids.length;
  }
  function ensureCover(){ const n=(World.solids||[]).length; if(coverStamp!==n) buildCover(); }

  // is point `p` (x,z) sheltered from the player at standing height? (LOS blocked)
  function sheltered(px,pz,target){
    const a=tmpA.set(px,COVER_H,pz), b=tmpB.set(target.x,EYE,target.z);
    const dir=tmp.copy(b).sub(a); const dist=dir.length(); if(dist<0.1) return false; dir.normalize();
    ray.set(a,dir); ray.far=dist-0.4; const h=ray.intersectObjects(World.solids,false); ray.far=Infinity;
    return h.length>0;
  }

  // pick the nearest cover spot that (a) shelters from the player and (b) is on
  // the player's side of the cover (so the enemy actually faces the threat).
  function findCover(e, target){
    ensureCover();
    let best=null, bestScore=Infinity;
    const ep=e.group.position;
    for(const c of coverPts){
      // spot must be the face that points toward the player (cover between spot & player)
      const fromObjToSpot_x=c.x-c.ox, fromObjToSpot_z=c.z-c.oz;
      const fromObjToPly_x=target.x-c.ox, fromObjToPly_z=target.z-c.oz;
      if((fromObjToSpot_x*fromObjToPly_x + fromObjToSpot_z*fromObjToPly_z) > 0) continue; // spot faces away from player -> exposed
      if(!sheltered(c.x,c.z,target)) continue;
      const d=Math.hypot(c.x-ep.x, c.z-ep.z);
      // prefer cover that keeps us roughly in our role's engagement band
      const dToPly=Math.hypot(c.x-target.x, c.z-target.z);
      const band=Math.abs(dToPly - holdRange(e));
      const score=d + band*0.4;
      if(score<bestScore){ bestScore=score; best=c; }
    }
    return best;
  }

  // a peek point: short step sideways out of cover that regains LOS to the player
  function peekSpot(e, cover, target){
    if(!cover) return null;
    // perpendicular to the cover->player axis; try both sides, pick one with LOS
    let ax=target.x-cover.ox, az=target.z-cover.oz; const al=Math.hypot(ax,az)||1; ax/=al; az/=al;
    const px=-az, pz=ax; const step=Math.max(cover.hw,cover.hd)+1.0;
    for(const s of [e.peekSide||1,-(e.peekSide||1)]){
      const sx=cover.x+px*step*s, sz=cover.z+pz*step*s;
      if(!sheltered(sx,sz,target)){ e.peekSide=s; return {x:sx,z:sz}; } // exposed here = can shoot
    }
    return null;
  }

  function holdRange(e){
    const b=e.def.behavior;
    return b==='snipe'?80 : b==='hold'?16 : b==='rush'?4 : 14;
  }

  function rollKit(r){
    const k=r.kit||{wpn:['wpn_smg']}; const wpn=k.wpn[Math.floor(Math.random()*k.wpn.length)];
    const wDef=DATA.weapons[DATA.items[wpn].weapon]; const att={};
    if(k.optic && wDef.slots.includes('optic')) att.optic=k.optic;
    if(k.att){ if(Math.random()<k.att && wDef.slots.includes('muzzle')) att.muzzle='att_suppressor';
      if(Math.random()<k.att && wDef.slots.includes('tactical')) att.tactical='att_grip';
      if(!att.optic && Math.random()<k.att*0.6 && wDef.slots.includes('optic')) att.optic='att_reddot'; }
    const armor = (Math.random()<(k.armor||0)) ? (k.heavyArmor?'arm_lvl4':'arm_lvl2') : null;
    const helmet = (Math.random()<(k.helmet||0)) ? 'helm_lvl2' : null;
    return { wpn, att, armor, helmet, cal:wDef.cal };
  }
  // how many frags this individual spawns carrying (per-role odds from DATA).
  function rollNades(r){ const n=r.nades; if(!n) return 0; return (Math.random()<(n.chance||0))?(n.count||1):0; }

  function spawn(roleId,x,z){
    const r=DATA.enemies[roleId];
    const g=new T.Group();
    const skin=new T.MeshStandardMaterial({color: r.behavior==='snipe'?0x553355: r.behavior==='rush'?0x7a3322:0x7a2f2c, roughness:.7});
    const torso=new T.Mesh(new T.BoxGeometry(.7,1,.4),skin); torso.position.y=1.1; torso.castShadow=true;
    const head=new T.Mesh(new T.BoxGeometry(.4,.4,.4),skin); head.position.y=1.85;
    const legs=new T.Mesh(new T.BoxGeometry(.6,.9,.35), new T.MeshStandardMaterial({color:0x2a2d31})); legs.position.y=.45;
    g.add(legs,torso,head); g.position.set(x,0,z); GFX.world.add(g);
    const kit=rollKit(r); const cmesh={gun:null,plate:null,helmet:null};
    // visible kit: helmet + chest plate so silhouette reads their gear
    if(kit.helmet){ const hm=new T.Mesh(new T.BoxGeometry(.46,.22,.46), new T.MeshStandardMaterial({color:0x394150,metalness:.4,roughness:.5})); hm.position.y=2.04; g.add(hm); cmesh.helmet=hm; }
    if(kit.armor){ const pl=new T.Mesh(new T.BoxGeometry(.78,.74,.5), new T.MeshStandardMaterial({color:kit.armor==='arm_lvl4'?0x2f3a2a:0x37414e,metalness:.3,roughness:.6})); pl.position.y=1.16; g.add(pl); cmesh.plate=pl; }
    const gun=new T.Mesh(new T.BoxGeometry(.1,.12,.62), new T.MeshStandardMaterial({color:0x16191c,metalness:.5,roughness:.5})); gun.position.set(.34,1.2,.3); g.add(gun); cmesh.gun=gun;
    const barBg=bar(0x330000), barFg=bar(0xff3b30); barBg.position.set(0,2.25,0); barFg.position.set(0,2.25,.001); g.add(barBg,barFg);
    const hp=Math.round(r.hp*(1+ (S.run?S.run.stopIndex*0.18:0)));
    const wDef=DATA.weapons[DATA.items[kit.wpn].weapon];
    const e={ group:g, parts:[torso,head,legs], role:roleId, def:r, tier:r.tier, kit, cmesh,
      hp, maxHp:hp, dmg:r.dmg*(1+(S.run?S.run.stopIndex*0.12:0)), accuracy:Math.min(0.85,r.accuracy+(S.run?S.run.stopIndex*0.03:0)),
      bar:barFg, barBg, alert:false, lastSeen:-99, nextShot:0, home:new T.Vector3(x,0,z),
      strafeDir:Math.random()<.5?-1:1, strafeT:0, dead:false,
      // --- combat AI state ---
      mag:wDef.mag, ammo:wDef.mag, reload:wDef.reload, reloading:false, reloadEnd:0,
      hurtUntil:0, cover:null, peek:null, posture:'engage', // engage | tocover | peek | flank | search
      role2:null, flankSide:Math.random()<.5?1:-1, peekSide:Math.random()<.5?1:-1,
      sawPlayer:false, nextCover:0,
      // --- grenades + suppression + search (feat/lns-ai-grenades) ---
      nades: rollNades(r), nextNade:0, cooking:0, cookAim:null,   // throwables + windup state
      suppress:0,                                                 // 0..1 incoming-fire suppression meter
      losDeniedSince:0,                                           // when we lost LOS to a known target
      searchUntil:0, searchPt:null };
    torso.userData={enemy:e,part:'torso'}; head.userData={enemy:e,part:'head'}; legs.userData={enemy:e,part:'legs'};
    mobs.push(e); return e;
  }
  function bar(c){ return new T.Mesh(new T.PlaneGeometry(.9,.12), new T.MeshBasicMaterial({color:c})); }

  function damage(e,dmg){
    e.hp-=dmg; e.alert=true; e.lastSeen=Clock.now; e.home.copy(e.group.position);
    e.hurtUntil=Clock.now+1.4;           // flinch -> seek cover briefly after a hit
    e.parts.forEach(p=>p.material.emissive=new T.Color(0xff5544));
    setTimeout(()=>{ if(!e.dead) e.parts.forEach(p=>p.material.emissive=new T.Color(0)); },60);
    const fr=Math.max(0,e.hp/e.maxHp); e.bar.scale.x=fr; e.bar.position.x=-(0.9*(1-fr))/2;
    Events.emit('alert',{pos:e.group.position.clone(), radius:26});
    if(e.hp<=0) kill(e);
  }
  function kill(e){
    e.dead=true; e.group.rotation.x=Math.PI/2; e.group.position.y=.3;
    e.bar.visible=false; e.barBg.visible=false; e.parts.forEach(p=>p.material.color=new T.Color(0x33282a));
    Loot.makeCorpse(e);
    Events.emit('enemy:killed', e); Events.emit('threats:changed');
    if(aliveCount()===0) Events.emit('raid:cleared');
  }
  function los(from,to){ const a=tmpA.set(from.x,1.45,from.z), b=tmpB.set(to.x,1.5,to.z); const d=tmp.copy(b).sub(a); const dist=d.length(); d.normalize();
    ray.set(a,d); ray.far=dist-0.4; const h=ray.intersectObjects(World.solids,false); ray.far=Infinity; return h.length===0; }

  Events.on('alert', a=>{ for(const e of mobs){ if(e.dead) continue; if(e.group.position.distanceTo(a.pos)<a.radius){ e.alert=true; e.lastSeen=Clock.now; e.home.copy(a.pos);} } });

  // ---------- POST-KILL: regroup + search the last-known position --------------
  // When a squadmate drops, nearby survivors don't freeze: they go alert, send out
  // an alert pulse from the body, and SEARCH toward where the player was last seen
  // (or the death spot if we never had a fix) for a while before standing down.
  Events.on('enemy:killed', dead=>{
    if(!dead || !dead.group) return;
    const R=DATA.squadReact||{};
    const deathPos=dead.group.position.clone();
    const anchor = haveLastKnown ? lastKnown : deathPos; // hunt the player, fall back to the body
    if(R.alertOnKill) Events.emit('alert',{ pos:deathPos, radius:R.alertOnKill });
    for(const e of mobs){ if(e.dead || e===dead) continue;
      if(e.group.position.distanceTo(deathPos) > (R.regroupRadius||26)) continue;
      e.alert=true; e.lastSeen=Math.max(e.lastSeen, Clock.now); // refresh so they don't instantly time out
      e.searchUntil=Clock.now+(R.searchTime||7.5);
      const sr=(R.searchRadius||9);
      e.searchPt=new T.Vector3(anchor.x+(Math.random()*2-1)*sr, 0, anchor.z+(Math.random()*2-1)*sr);
    }
  });

  // ---------- GRENADE DETECTION (runtime; projectiles.js untouched) ----------
  // The player's frag is a tiny olive SphereGeometry (r=0.15, MeshStandardMaterial)
  // parented to GFX.world while airborne. We sniff it out by that signature so
  // squads can scatter + call it *before* it detonates. FX debris/flash use
  // MeshBasicMaterial and different radii, so they don't false-trigger.
  function liveGrenade(){
    const ws=GFX.world; if(!ws||!ws.children) return null;
    for(const c of ws.children){
      const g=c.geometry, m=c.material;
      if(!g||!m) continue;
      if(g.type==='SphereGeometry' && m.type==='MeshStandardMaterial'){
        const r=g.parameters&&g.parameters.radius;
        if(r>0.12 && r<0.2) return c;
      }
    }
    return null;
  }
  const NADE_DANGER = DATA.items.nade_frag.radius + 5; // react inside blast+buffer

  // ---------- SUPPRESSION: detect player tracers whipping past an enemy --------
  // The window manager owns no per-shot event, so we read the world: every shot
  // (player OR enemy) drops a short-lived T.Line tracer into GFX.world via
  // fxTracer. We TAG our own enemy tracers (tagEnemyTracer) the instant we add
  // them; anything left untagged is incoming fire. A round passing within
  // suppression.missRadius of an enemy — without having hit it — pins + rattles
  // them. We mark each line "counted" so it only suppresses once.
  function tagEnemyTracer(){
    const ws=GFX.world; if(!ws||!ws.children||!ws.children.length) return;
    const last=ws.children[ws.children.length-1];
    if(last && last.type==='Line') last.userData.enemyTracer=true;
  }
  const SUP = DATA.suppression || {};
  // shortest distance from point P to segment AB, all in the XZ plane.
  function segDistXZ(px,pz, ax,az, bx,bz){
    const abx=bx-ax, abz=bz-az; const apx=px-ax, apz=pz-az;
    const len2=abx*abx+abz*abz; let t = len2>1e-6 ? (apx*abx+apz*abz)/len2 : 0;
    t=Math.max(0,Math.min(1,t)); const cx=ax+abx*t, cz=az+abz*t;
    return Math.hypot(px-cx, pz-cz);
  }
  // scan incoming tracers once per tick; bump suppression on near-misses.
  function applySuppression(){
    const ws=GFX.world; if(!ws||!ws.children) return;
    const miss=SUP.missRadius||2.6;
    for(const c of ws.children){
      if(c.type!=='Line') continue;
      if(c.userData.enemyTracer || c.userData.supCounted) continue; // ours, or already scored
      const g=c.geometry; const pos=g&&g.attributes&&g.attributes.position;
      if(!pos || pos.count<2) continue;
      const ax=pos.getX(0), az=pos.getZ(0), bx=pos.getX(1), bz=pos.getZ(1);
      c.userData.supCounted=true; // count this round exactly once
      for(const e of mobs){ if(e.dead) continue;
        const ep=e.group.position;
        // skip if the round actually struck this enemy this frame (that's a hit, handled by damage())
        if(Clock.now<e.hurtUntil && e.lastSeen===Clock.now) continue;
        if(segDistXZ(ep.x,ep.z, ax,az, bx,bz) < miss){
          e.suppress=Math.min(SUP.max||1, e.suppress + (SUP.perMiss||0.34));
          e.alert=true; e.lastSeen=Math.max(e.lastSeen, Clock.now-0.01);
        }
      }
    }
  }
  // accuracy after suppression (worse when pinned) — clamped to a floor.
  function suppressedAccuracy(e){
    if(e.suppress<=0) return e.accuracy;
    const floor=SUP.accuracyFloor!=null?SUP.accuracyFloor:0.35;
    const k=1-(1-floor)*Math.min(1,e.suppress);
    return e.accuracy*k;
  }

  // ---------- GRENADE THROW DECISION ------------------------------------------
  // An alert enemy lobs a frag when the player is a hard target: either we've LOST
  // line of sight to a known position (player ducked behind cover) for long enough,
  // OR the squad is grouped up on one spot and can't close. Gated by per-enemy +
  // squad-wide cooldowns, throwing range, and a visible cook windup (telegraph).
  function wantsGrenade(e, ep, dist, see, groupedCount){
    const G=DATA.enemyGrenade||{};
    if(e.nades<=0) return false;
    if(e.cooking) return false;                       // already winding up
    if(Clock.now<e.nextNade || Clock.now<nextSquadNade) return false;
    if(e.reloading || e.suppress>=(SUP.pinAt||0.5)) return false; // can't throw while pinned/reloading
    if(!haveLastKnown) return false;
    const tx=lastKnown.x, tz=lastKnown.z;
    const tdist=Math.hypot(tx-ep.x, tz-ep.z);
    if(tdist<(G.minRange||8) || tdist>(G.maxRange||34)) return false;
    // reason 1: target known but unseen for a beat (flush the camper)
    const losDenied = !see && e.losDeniedSince>0 && (Clock.now-e.losDeniedSince)>=(G.losDeniedFor||1.4);
    // reason 2: squad is stacked on this target and stalled — someone cooks one
    const grouped = groupedCount>=(G.groupedMin||2) && !see;
    if(!(losDenied || grouped)) return false;
    return true;
  }
  // begin the cook windup: a telegraph the player can read before it flies.
  function startCook(e, dist){
    const G=DATA.enemyGrenade||{};
    e.cooking=Clock.now+(G.cookTime||1.15);
    // lock the aim at the squad's last-known spot, led by the player's velocity
    const lead=G.leadFactor||0.35;
    e.cookAim=new T.Vector3(
      lastKnown.x + playerVel.x*lead,
      0.15,
      lastKnown.z + playerVel.z*lead
    );
    // throwers chirp the same "grenade" callout so the player hears it coming out
    if(dist<70) Audio.callout('grenade');
  }
  // release the frag once the windup completes.
  function releaseCook(e){
    const G=DATA.enemyGrenade||{};
    const ep=e.group.position;
    const from=new T.Vector3(ep.x, 1.5, ep.z);
    const err=G.aimError||2.2;
    const aim=(e.cookAim||lastKnown).clone();
    aim.x+=(Math.random()*2-1)*err; aim.z+=(Math.random()*2-1)*err;
    try{ Projectiles.enemyThrow(from, aim); }catch(_){ }
    e.nades--; e.cooking=0; e.cookAim=null;
    e.nextNade=Clock.now+(G.cooldown||9);
    nextSquadNade=Clock.now+(G.squadCooldown||4.5);
  }

  function update(dt){
    if(S.mode!==MODE.RAID) return;
    const pp=GFX.yaw.position; GFX.camera.getWorldPosition(camW);

    // player velocity (for leading grenade throws); smoothed a touch.
    if(havePrevPP && dt>0){ const vx=(pp.x-prevPP.x)/dt, vz=(pp.z-prevPP.z)/dt;
      playerVel.x+=(vx-playerVel.x)*0.4; playerVel.z+=(vz-playerVel.z)*0.4; }
    prevPP.copy(pp); havePrevPP=true;

    // squad-level intel computed once per tick (cheap; small mob counts)
    const nade=liveGrenade(); const nadePos = nade? nade.position : null;
    applySuppression();                       // incoming near-misses -> per-enemy suppression
    assignRoles(pp);
    // how many alert enemies are stacked up engaging (drives grouped grenade use)
    let groupedCount=0; for(const e of mobs){ if(!e.dead && e.alert && e.group.position.distanceTo(pp)<(e.def.range+10)) groupedCount++; }

    for(const e of mobs){ if(e.dead) continue;
      e.bar.lookAt(camW); e.barBg.lookAt(camW);
      const ep=e.group.position; const dist=ep.distanceTo(pp);
      const see=dist<e.def.range && los(ep,pp);
      if(see){
        e.alert=true; e.lastSeen=Clock.now; e.home.copy(pp);
        e.losDeniedSince=0; e.searchUntil=0; e.searchPt=null; // we can see them — no need to search
        // refresh the squad's shared last-known player position
        lastKnown.copy(pp); haveLastKnown=true; lastKnownAt=Clock.now;
        if(!e.sawPlayer){ e.sawPlayer=true; if(dist<60) Audio.callout('contact'); } // "Contact!" first spot
        if(e.def.alertRadius) Events.emit('alert',{pos:pp.clone(),radius:e.def.alertRadius});
      } else if(e.alert && haveLastKnown){
        // alert but no LOS: remember when we lost the player (gates the flush-frag)
        if(e.losDeniedSince===0) e.losDeniedSince=Clock.now;
      }

      // suppression bleeds off whenever rounds aren't whipping past
      if(e.suppress>0){ e.suppress=Math.max(0, e.suppress-(SUP.decay||0.55)*dt); }

      // ----- reload bookkeeping (dry mag -> reload, duck while doing it) -----
      if(e.reloading && Clock.now>=e.reloadEnd){ e.reloading=false; e.ammo=e.mag; }
      const wantReload = e.alert && e.ammo<=0 && !e.reloading;
      if(wantReload){ e.reloading=true; e.reloadEnd=Clock.now+e.reload; if(dist<55) Audio.callout('reloading'); }

      if(e.alert){
        e.group.rotation.y=Math.atan2(pp.x-ep.x, pp.z-ep.z);

        // ----- decide posture: cover when grenade/hurt/reloading; else engage/flank -----
        const grenadeNear = nadePos && ep.distanceTo(nadePos)<NADE_DANGER;
        if(grenadeNear && !e._nadeCalled){ e._nadeCalled=Clock.now; if(dist<70) Audio.callout('grenade'); }
        if(!grenadeNear){ if(e._nadeCalled && Clock.now-e._nadeCalled>2) e._nadeCalled=0; }
        // a frag landing close FLUSHES enemies out of their hole: drop cover/peek so
        // they relocate, and the blast pressure rattles them (suppression bump).
        if(grenadeNear && !e._nadeFlushed){ e._nadeFlushed=Clock.now;
          e.cover=null; e.peek=null; e.cooking=0; e.cookAim=null; // panic-drop a cook if one was incoming
          e.suppress=Math.min(SUP.max||1, e.suppress+(SUP.perBlast||0.6)); }
        if(!grenadeNear) e._nadeFlushed=0;

        // ----- GRENADE: cook a frag at a hard target, or release a cooked one -----
        if(e.cooking){
          if(Clock.now>=e.cooking) releaseCook(e);   // windup done -> it flies
        } else if(wantsGrenade(e, ep, dist, see, groupedCount)){
          startCook(e, dist);                        // begin the telegraph windup
        }

        const pinned = e.suppress>=(SUP.pinAt||0.5);  // heavy fire = hug cover, no peeking
        const reloadingOrHurt = e.reloading || Clock.now<e.hurtUntil;
        const exposed = !sheltered(ep.x,ep.z,pp);
        const wantCover = grenadeNear || pinned || (reloadingOrHurt && e.def.behavior!=='rush');

        // rushers ignore cover (existing behavior preserved); everyone else may use it
        let mv=new T.Vector3();
        if(wantCover && e.def.behavior!=='rush'){
          // (re)acquire cover; if grenade, force a fresh, farther-from-nade spot
          if(!e.cover || grenadeNear || Clock.now>e.nextCover){ e.cover=findCover(e,pp); e.nextCover=Clock.now+1.0; e.peek=null; }
          const tgt = e.cover || e.home;
          const toC=tmp.set(tgt.x-ep.x,0,tgt.z-ep.z); const dC=toC.length();
          if(grenadeNear && nadePos){ // also push directly away from the grenade
            const away=new T.Vector3(ep.x-nadePos.x,0,ep.z-nadePos.z); if(away.lengthSq()>0){ away.normalize(); mv.add(away.multiplyScalar(1.4)); }
          }
          if(dC>0.6){ toC.normalize(); mv.add(toC); }
          e.posture='tocover';
        } else if(!see && e.searchUntil>Clock.now && e.searchPt){
          // SEARCH: a teammate died — sweep toward the player's last-known spot,
          // re-rolling a nearby point on arrival so they fan out and clear the area.
          const toS=tmp.set(e.searchPt.x-ep.x,0,e.searchPt.z-ep.z); const dS=toS.length();
          if(dS<1.4){
            const R=(DATA.squadReact&&DATA.squadReact.searchRadius)||9;
            e.searchPt=new T.Vector3(lastKnown.x+(Math.random()*2-1)*R, 0, lastKnown.z+(Math.random()*2-1)*R);
          } else { toS.normalize(); mv.add(toS.multiplyScalar(0.9)); }
          e.posture='search';
        } else if(e.role2==='flank' && !see){
          // FLANK: arc around the player toward our assigned side until we get LOS
          const toP=tmp.set(pp.x-ep.x,0,pp.z-ep.z); const d=toP.length()||1; toP.multiplyScalar(1/d);
          const arc=new T.Vector3(-toP.z,0,toP.x).multiplyScalar(e.flankSide);
          mv.add(toP.clone().multiplyScalar(d>holdRange(e)?0.7:0.0)); // close a little
          mv.add(arc.multiplyScalar(1.1));
          e.posture='flank';
        } else {
          // ----- ENGAGE: original range-management + strafe, now cover-aware -----
          e.strafeT-=dt; if(e.strafeT<=0){ e.strafeDir*=-1; e.strafeT=1+Math.random()*1.5; }
          const toP=tmp.copy(pp).sub(ep); toP.y=0; const d=toP.length(); toP.normalize();
          const strafe=new T.Vector3(-toP.z,0,toP.x).multiplyScalar(e.strafeDir);
          const hold=holdRange(e);
          if(d>hold+6) mv.add(toP); else if(d<hold-4) mv.add(toP.clone().multiplyScalar(-1));
          if(e.def.behavior!=='rush') mv.add(strafe.multiplyScalar(0.6));
          // anchors that already have a sheltered spot edge out to a peek to fire —
          // but a PINNED (suppressed) anchor stays tucked and does NOT peek.
          if(e.role2==='anchor' && e.cover && !exposed && !pinned){
            if(!e.peek) e.peek=peekSpot(e,e.cover,pp);
            if(e.peek){ const toPk=new T.Vector3(e.peek.x-ep.x,0,e.peek.z-ep.z); if(toPk.length()>0.5){ mv.add(toPk.normalize().multiplyScalar(0.9)); } }
          }
          e.posture='engage';
        }

        // a thrower plants their feet during the cook windup (the telegraph reads
        // as a stationary wind-up rather than a moving target).
        if(e.cooking) mv.multiplyScalar(0.15);
        if(mv.lengthSq()>0){ mv.normalize().multiplyScalar(e.def.speed*dt); World.moveActor(ep,mv,0.5); }

        // ----- fire: only with LOS, not while reloading, not while diving for cover
        // from a grenade, and not mid grenade-cook. Suppression stretches cadence + accuracy.
        const fireGap = e.def.fireDelay * (1 + (SUP.fireDelayMult||1.8 - 1)*Math.min(1,e.suppress));
        const canFire = see && !e.reloading && e.ammo>0 && !grenadeNear && !e.cooking && Clock.now>e.nextShot;
        if(canFire){ e.nextShot=Clock.now+fireGap; e.ammo--;
          const hit=Math.random()<suppressedAccuracy(e);
          const from=new T.Vector3(ep.x,1.4,ep.z);
          const to = hit ? new T.Vector3(pp.x,1.5,pp.z)
                         : new T.Vector3(pp.x+(Math.random()-.5)*2.4, 1.5+(Math.random()-.5)*1.2, pp.z+(Math.random()-.5)*2.4);
          fxTracer(from,to,0xff6644); tagEnemyTracer(); // tag so suppression ignores our own rounds
          if(dist<46) Audio.play(dist<18?'shot':'shotSupp');
          if(hit){ const fall=Math.max(0.35,1-dist/e.def.range); Player.damage(e.dmg*fall, ep); } }

        // give up only once LOS has been cold AND any active search has expired.
        if(Clock.now-e.lastSeen>8 && Clock.now>=e.searchUntil){
          e.alert=false; e.cover=null; e.peek=null; e.posture='engage';
          e.cooking=0; e.cookAim=null; e.suppress=0; e.searchPt=null; e.losDeniedSince=0;
        }
      } else {
        const back=tmp.copy(e.home).sub(ep); back.y=0;
        if(back.length()>0.5){ back.normalize().multiplyScalar(1.2*dt); World.moveActor(ep,back,0.5); }
      }
    }
  }

  // ---------- FLANKING: split engaged squad into an anchor + flankers ----------
  // Among enemies actively engaging (alert + roughly in range), the closest one
  // ANCHORS (pins the player, uses cover/peeks). The rest are told to FLANK,
  // arcing to alternating sides. Solo enemies just engage as before.
  let lastFlankCall=0;
  function assignRoles(pp){
    const engaged=mobs.filter(e=>!e.dead && e.alert && e.group.position.distanceTo(pp)<e.def.range+10);
    if(engaged.length<2){ for(const e of mobs) e.role2=null; return; }
    engaged.sort((a,b)=>a.group.position.distanceTo(pp)-b.group.position.distanceTo(pp));
    let side=1, newFlankers=0;
    engaged.forEach((e,i)=>{
      if(i===0){ e.role2='anchor'; }
      else {
        if(e.role2!=='flank'){ e.flankSide=side; newFlankers++; }
        e.role2='flank'; side*=-1; // alternate sides so they spread out
      }
    });
    // a single "Flanking" chirp when the squad first commits, throttled
    if(newFlankers>0 && Clock.now-lastFlankCall>6){ lastFlankCall=Clock.now; Audio.callout('flank'); }
  }

  return { spawn, damage, update, clear, list, hitMeshes, aliveCount };
})();
