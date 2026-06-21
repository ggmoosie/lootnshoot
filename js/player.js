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
            startY, peakY, landY:plan.landY||0 };
    Audio.play('ui');
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
    // CLAMP XZ: only advance if the next point is clear. The body is ABOVE the
    // obstacle's top for the airborne middle of the move (eye/feet arc over the
    // lip), so probe with a SMALL radius there — we glide over the vaulted ledge
    // but still STOP dead at any real (taller) wall we'd otherwise clip through.
    const overLip = s.y > vault.peakY-0.25;       // near the top of the arc → forgiving probe
    const probeR = overLip ? RADIUS*0.3 : RADIUS*0.8;
    if(World.spotClear(s.x,s.z,probeR)){ vault.cx=s.x; vault.cz=s.z; vault.cy=s.y; }
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
  function spawn(x,z,faceY){ vault=null; groundY=World.groundTopAt?World.groundTopAt(x,z):0; groundCur=groundY; jumpY=0; velY=0; grounded=true; GFX.yaw.position.set(x,groundY+HEIGHT,z); GFX.yaw.rotation.y=faceY||0; GFX.pitch.rotation.x=0; }
  function heal(n){ S.player.health=Math.min(S.player.maxHealth, S.player.health+n); Events.emit('player:changed'); }

  // ---- simplified healing + buff consumables (added: feat/lns-throwables-healing)
  // Kept in their own functions so the damage-mitigation path (damage(), owned by
  // another agent) is never touched. A consumable now takes a short USE TIME with a
  // cosmetic progress bar (Status.beginUse) before its effect lands; effect data
  // comes from DATA.consumables. No hunger/thirst/weight — extraction shooter, not
  // a survival sim. ----
  function useMed(){
    if(Status.isUsing()){ return; }                     // one use at a time
    const grids = S.mode===MODE.RAID?Inventory.carried():[Inventory.stash()];
    let found=null;
    for(const g of grids){ const t=g.items.find(i=>i.def.type==='med'); if(t){ found={g,t}; break; } }
    if(!found){ UI.toast('No meds','neg'); return; }
    const def=found.t.def; const cfg=DATA.consumables[def.id]||{ useTime:0.1, heal:def.heal||0, cure:def.cure, buff:def.buff, buffDur:12, buffMag:1 };
    // consume the item up-front so it can't be double-used mid-animation
    found.t.qty--; if(found.t.qty<=0||!found.t.def.stack) found.g.remove(found.t.uid);
    Events.emit('inv:changed');
    UI.toast(`Using ${def.name}…`,'neu');
    Status.beginUse(cfg.useTime, (cfg.name||def.name).toUpperCase(), ()=>applyConsumable(def, cfg));
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
    Events.emit('player:tick');
  }
  function resetForRaid(){ S.player.health=S.player.maxHealth; S.player.stamina=S.player.maxStamina; Status.clearAll(); Input.crouch=false; vault=null; groundY=0; groundCur=0; jumpY=0; velY=0; grounded=true; }
  return { spawn, heal, useMed, damage, update, resetForRaid, isMoving:()=>movingFlag, inVault, RADIUS, HEIGHT };
})();
