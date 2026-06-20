// projectiles.js — SYS: Projectiles. Throwables (arc toss + per-type effect).
//
// Two paths share this file:
//   (1) LEGACY frag — Weapons.throwGrenade() consumes a nade_frag then calls
//       spawnGrenade(); that path is UNCHANGED so the existing G keybind, mobile
//       NADE button, and enemy grenade-detection all keep working bit-for-bit.
//   (2) SELECTABLE throwables — a small selector (own key listeners, since
//       input.js is owned elsewhere): V cycles the carried throwable type, Q
//       throws the selected one with an arc. Each type runs its own effect on
//       detonation: frag (radius damage), smoke (vision screen), flash (blind +
//       stun), incendiary (burst + burning DoT zone). All tuning lives in
//       DATA.throwables (data.js).
import { T } from "./three.js";
import { DATA } from "./data.js";
import { S, MODE, Clock, Events } from "./state.js";
import { GFX } from "./gfx.js";
import { Perception } from "./perception.js";
import { Audio } from "./audio.js";
import { Enemies } from "./enemies.js";
import { Status } from "./status.js";
import { Player } from "./player.js";
import { FX } from "./fx.js";
import { Inventory } from "./inventory.js";
import { UI } from "./ui.js";

export const Projectiles = (function(){
  const live=[];   // in-flight thrown objects
  const zones=[];  // lingering ground effects (smoke clouds, fire pools)
  let selected='frag';

  // ---- helpers ---------------------------------------------------------------
  function tdef(kind){ return DATA.throwables[kind] || DATA.throwables.frag; }
  function camDir(){ const d=new T.Vector3(); GFX.camera.getWorldDirection(d); return d; }
  function camPos(){ const p=new T.Vector3(); GFX.camera.getWorldPosition(p); return p; }
  // grenade-ish toss: forward velocity + an upward arc component.
  function tossVel(dir){ return dir.clone().multiplyScalar(18).add(new T.Vector3(0,4,0)); }

  // spawn the airborne mesh for a given throwable kind.
  function spawnThrown(kind){
    const def=tdef(kind);
    const org=camPos(), dir=camDir();
    // frag keeps its exact original look so enemies.js liveGrenade() still sniffs
    // it out (olive SphereGeometry r=0.15, MeshStandardMaterial). Others differ.
    const isFrag = kind==='frag';
    const mesh=new T.Mesh(
      new T.SphereGeometry(0.15,8,8),
      new T.MeshStandardMaterial({ color:def.color!=null?def.color:0x2f3a22, emissive: isFrag?0x000000:def.color, emissiveIntensity: isFrag?0:0.25 })
    );
    mesh.position.copy(org); GFX.world.add(mesh);
    live.push({ mesh, kind, def, vel:tossVel(dir), t:0 });
  }

  // ---- LEGACY entry: called by Weapons.throwGrenade() (unchanged contract) ----
  // Always a frag, exactly as before — Weapons already consumed the nade_frag.
  function spawnGrenade(){ spawnThrown('frag'); }

  // ---- ENEMY grenade toss (added: feat/lns-ai-grenades) ----------------------
  // enemies.js calls this to LOB a frag from `from` toward `target` (both
  // T.Vector3-ish {x,y,z}). Unlike the player throw (camera-relative straight
  // toss), this solves a ballistic ARC so it drops onto the target's position,
  // and paints a visible landing TELEGRAPH so the player can dodge. The airborne
  // mesh keeps the exact frag signature (olive SphereGeometry r=0.15,
  // MeshStandardMaterial) so enemies.js liveGrenade() still sniffs it out and the
  // whole squad scatters from it. Detonation reuses effFrag -> damages enemies AND
  // the player, identical to a player frag.
  const GNADE_G = 20; // must match the gravity used in update() below
  function enemyThrow(from, target){
    const def = tdef('frag');
    const cfg = DATA.enemyGrenade || {};
    const fy = (from.y!=null ? from.y : 1.4);
    const ty = 0.15; // aim at the ground at the target
    const dx = target.x - from.x, dz = target.z - from.z;
    const R = Math.hypot(dx, dz) || 0.001;
    const vH = Math.max(6, cfg.arcSpeed || 17);
    const t = R / vH;                                  // time to cover the ground gap
    const vY = (ty - fy + 0.5*GNADE_G*t*t) / t;        // vertical so it lands at ty at time t
    const vel = new T.Vector3((dx/R)*vH, vY, (dz/R)*vH);
    const mesh = new T.Mesh(
      new T.SphereGeometry(0.15,8,8),
      new T.MeshStandardMaterial({ color:0x2f3a22 })   // frag look, no emissive (matches player frag)
    );
    mesh.position.set(from.x, fy, from.z); GFX.world.add(mesh);
    // give it a fuse that roughly matches the flight so it air/ground bursts on
    // arrival rather than rolling forever (clamped to the def fuse as an upper bound).
    const fuse = Math.min(def.fuse || 2.4, t + 0.5);
    live.push({ mesh, kind:'frag', def, vel, t:0, fuse, enemy:true });
    // landing telegraph: a flat pulsing ring on the ground at the predicted spot.
    spawnTelegraph(target.x, target.y, target.z, def.radius, t, cfg.markerColor||0xff5a1f);
    if(def.noise){ try{ Audio.play('ui'); }catch(_){ } }   // faint "pin pulled" tick
  }

  // pulsing ground ring that marks where an enemy frag will land. Distinct
  // geometry (RingGeometry) + MeshBasicMaterial so it never trips liveGrenade().
  function spawnTelegraph(x, y, z, radius, life, color){
    const r=Math.max(1, radius);
    const ring=new T.Mesh(new T.RingGeometry(r*0.55, r, 24),
      new T.MeshBasicMaterial({ color, transparent:true, opacity:0.0, side:T.DoubleSide, depthWrite:false }));
    ring.rotation.x=-Math.PI/2; ring.position.set(x, 0.06, z); GFX.world.add(ring);
    zones.push({ kind:'telegraph', mesh:ring, dur:Math.max(0.4, life+0.5), t:0 });
  }

  // ---- detonation effects ----------------------------------------------------
  function detonate(g){
    const p=g.mesh.position.clone(); const def=g.def, kind=g.kind;
    if(def.noise) { Perception.noise(p, DATA.noise[def.noise]||DATA.noise.boom); Audio.play('boom'); }
    if(kind==='frag') return effFrag(p, def);
    if(kind==='smoke') return effSmoke(p, def);
    if(kind==='flash') return effFlash(p, def);
    if(kind==='incendiary') return effIncendiary(p, def);
  }

  function effFrag(p, def){
    for(const e of Enemies.list()){ if(e.dead) continue; const d=e.group.position.distanceTo(p);
      if(d<def.radius) Enemies.damage(e, def.dmg*(1-d/def.radius)); }
    // player splash (own grenade can hurt you up close — reuse Player.damage)
    const pd=GFX.yaw.position.distanceTo(p);
    if(pd<def.radius && S.mode===MODE.RAID){ try{ Player.damage(def.dmg*0.6*(1-pd/def.radius), p); }catch(_){ } }
    flash(p, def.radius, 0xffaa33, 0.5, 130);
  }

  function effSmoke(p, def){
    // lingering cloud: a soft translucent sphere that fades when it expires.
    const cloud=new T.Mesh(new T.SphereGeometry(def.radius,16,12),
      new T.MeshBasicMaterial({ color:def.color, transparent:true, opacity:0.0, depthWrite:false }));
    cloud.position.copy(p); cloud.position.y=Math.max(1, p.y); GFX.world.add(cloud);
    zones.push({ kind:'smoke', mesh:cloud, pos:cloud.position.clone(), radius:def.radius, dur:def.duration, t:0, fade:1.2 });
  }

  function effFlash(p, def){
    flash(p, def.radius*0.7, def.color, 0.85, 200);
    // enemies in radius are stunned (can't fire) — only if they had LOS-ish (we
    // keep it simple: anyone inside the blast loses their next volley).
    for(const e of Enemies.list()){ if(e.dead) continue; if(e.group.position.distanceTo(p)<def.radius) Status.stunEnemy(e, def.stun); }
    // player blind if inside + roughly looking toward the pop (or very close).
    if(S.mode===MODE.RAID){
      const pp=GFX.yaw.position; const d=pp.distanceTo(p);
      if(d<def.radius){
        const look=camDir(); const toBlast=p.clone().sub(camPos()).normalize();
        const facing=look.dot(toBlast); // 1 = staring at it
        const close=1-Math.min(1,d/def.radius);
        const sev=Math.max(0, facing*0.7+0.3)*Math.max(0.4,close); // 0..~1
        const dur=def.blind*sev;
        if(dur>0.2) Status.apply('blind', dur, 1, { max:dur });
      }
    }
  }

  function effIncendiary(p, def){
    // initial burst damage
    for(const e of Enemies.list()){ if(e.dead) continue; const d=e.group.position.distanceTo(p);
      if(d<def.radius) Enemies.damage(e, def.dmg*(1-d/def.radius)); }
    flash(p, def.radius, 0xff5a1f, 0.6, 150);
    // burning ground zone: ticks DoT on anything inside (Status owns the ticks).
    const pool=new T.Mesh(new T.CircleGeometry(def.radius,20),
      new T.MeshBasicMaterial({ color:0xff5a1f, transparent:true, opacity:0.35, depthWrite:false }));
    pool.rotation.x=-Math.PI/2; pool.position.set(p.x, 0.05, p.z); GFX.world.add(pool);
    zones.push({ kind:'fire', mesh:pool, pos:new T.Vector3(p.x,0.2,p.z), radius:def.radius, dur:def.duration, tick:def.tick, t:0, ti:0, fade:0.6 });
  }

  // shared one-shot blast flash sphere (auto-removed)
  function flash(p, r, color, opacity, ms){
    const f=new T.Mesh(new T.SphereGeometry(r,12,12), new T.MeshBasicMaterial({color, transparent:true, opacity:opacity!=null?opacity:0.5}));
    f.position.copy(p); GFX.world.add(f); setTimeout(()=>GFX.world.remove(f), ms||120);
  }

  // ---- per-frame update ------------------------------------------------------
  function update(dt){
    // in-flight throwables: gravity arc + ground/fuse detonation
    for(let i=live.length-1;i>=0;i--){ const g=live[i]; g.t+=dt;
      g.vel.y-=20*dt; g.mesh.position.addScaledVector(g.vel,dt);
      const grounded=g.mesh.position.y<=0.15;
      if(grounded){ g.mesh.position.y=0.15; }
      const fuse=g.fuse!=null?g.fuse:(g.def.fuse||3);
      // frag detonates on ground OR fuse (matches old behavior of t>3 / y<=.15);
      // others detonate on fuse, and frag/incendiary also on contact.
      const pop = g.t>=fuse || (grounded && (g.kind==='frag'||g.kind==='incendiary'||g.kind==='smoke'));
      if(pop){ detonate(g); GFX.world.remove(g.mesh); live.splice(i,1); }
    }
    // lingering zones (smoke clouds / fire pools)
    if(S.mode===MODE.RAID){
      const pp=GFX.yaw.position; let inSmoke=false;
      for(let i=zones.length-1;i>=0;i--){ const z=zones[i]; z.t+=dt; const remain=z.dur-z.t;
        // grow-in then hold then fade-out (cosmetic)
        if(z.kind==='telegraph'){
          // pulse the warning ring; pulse quickens as detonation nears (urgency cue)
          const urgency=1+ (1-Math.max(0,remain)/Math.max(0.001,z.dur))*5;
          z.mesh.material.opacity=0.35+0.4*Math.abs(Math.sin(Clock.now*urgency*2.4));
        } else if(z.kind==='smoke'){
          const tIn=Math.min(1, z.t/0.6), tOut=Math.min(1, Math.max(0,remain)/z.fade);
          z.mesh.material.opacity=0.55*tIn*tOut;
          if(pp.distanceTo(z.pos)<z.radius) inSmoke=true;
        } else if(z.kind==='fire'){
          const tOut=Math.min(1, Math.max(0,remain)/z.fade);
          z.mesh.material.opacity=(0.3+0.12*Math.sin(Clock.now*9))*tOut;
          // tick DoT ~ every 0.5s on enemies + player inside
          z.ti=(z.ti||0)+dt;
          if(z.ti>=0.5){ z.ti=0;
            for(const e of Enemies.list()){ if(e.dead) continue; if(e.group.position.distanceTo(z.pos)<z.radius) Status.burnEnemy(e, 0.7, z.tick); }
            if(pp.distanceTo(z.pos)<z.radius) Status.apply('burn', 0.7, z.tick);
          }
        }
        if(remain<=0){ GFX.world.remove(z.mesh); try{ z.mesh.geometry.dispose(); }catch(_){ } zones.splice(i,1); }
      }
      // standing in smoke -> the screen veil (Status owns the overlay)
      if(inSmoke) Status.apply('smoked', 0.4, 1); else if(Status.has('smoked')) Status.clear('smoked');
    }
  }

  // ---- SELECTABLE throwable system (own input; input.js untouched) -----------
  // counts of each carried throwable kind, keyed by DATA.throwables.*
  function carriedKinds(){
    const out={}; const grids=Inventory.carried();
    for(const k of DATA.throwOrder){ const id=tdef(k).item; let n=0; for(const g of grids) n+=g.count(id); if(n>0) out[k]=n; }
    return out;
  }
  function countOf(kind){ const id=tdef(kind).item; let n=0; for(const g of Inventory.carried()) n+=g.count(id); return n; }
  function cycleSelected(){
    if(S.mode!==MODE.RAID) return;
    const have=carriedKinds(); const kinds=Object.keys(have);
    if(!kinds.length){ try{ UI.toast('No throwables','neg'); }catch(_){ } return; }
    // advance from current selection through DATA.throwOrder, wrapping
    const order=DATA.throwOrder.filter(k=>have[k]);
    let idx=order.indexOf(selected); idx=(idx+1)%order.length; selected=order[idx];
    try{ UI.toast(`${tdef(selected).label} ×${have[selected]}`,'neu'); }catch(_){ }
  }
  function throwSelected(){
    if(S.mode!==MODE.RAID) return;
    let kind=selected;
    if(countOf(kind)<=0){ // fall back to whatever is carried
      const have=carriedKinds(); const k=DATA.throwOrder.find(x=>have[x]);
      if(!k){ try{ UI.toast('No throwables','neg'); }catch(_){ } return; }
      kind=selected=k;
    }
    // consume one of the selected throwable, then toss it
    const id=tdef(kind).item; let used=false;
    for(const g of Inventory.carried()){ if(g.count(id)>0){ g.consume(id,1); used=true; break; } }
    if(!used){ try{ UI.toast('No throwables','neg'); }catch(_){ } return; }
    spawnThrown(kind);
    try{ UI.toast(`Threw ${tdef(kind).label}`,'neu'); }catch(_){ }
    Events.emit('inv:changed'); // notify HUD/inventory of the consumption
  }

  // own key listeners (V cycle, Q throw-selected). input.js owns G/mobile-NADE
  // for the legacy frag; we don't intercept those.
  // read live binds (respects a rebind in Settings; falls back to DATA.binds)
  function code(action){ return (S.profile&&S.profile.settings&&S.profile.settings.binds&&S.profile.settings.binds[action])||DATA.binds[action]; }
  addEventListener('keydown', e=>{
    if(S.mode!==MODE.RAID) return;
    // ignore while typing in an input (rebind capture, etc.)
    if(e.target && (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')) return;
    if(e.code===code('throwCycle')) cycleSelected();
    else if(e.code===code('throwUse')) throwSelected();
  });

  function clear(){ for(const z of zones){ try{ GFX.world.remove(z.mesh); }catch(_){ } } zones.length=0; live.length=0; }
  function selectedKind(){ return selected; }

  return { spawnGrenade, spawnThrown, enemyThrow, update, clear, cycleSelected, throwSelected, selectedKind, carriedKinds };
})();
