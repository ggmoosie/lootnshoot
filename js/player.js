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
  // ---- vault / climb (placeholder traversal) -------------------------------
  // A short scripted slide that carries the player OVER a low obstacle (vault) or
  // UP-and-over a chest/head-high ledge (climb). Player Y is fixed-eye, so the
  // "animation" is a cosmetic eye-height arc (rise then settle) + a small forward
  // pitch dip — a clean placeholder for a real clamber anim. While a vault runs,
  // normal WASD/jump/collision are suspended and the body lerps from start→land.
  // Trigger = JUMP key while moving into a surmountable face (no rebind needed;
  // a plain hop still happens when there's nothing to vault). jumpLatch debounces
  // the key so one press = one traversal.
  let vault=null, jumpLatch=false;
  function inVault(){ return !!vault; }
  function startVault(plan){
    const p=GFX.yaw.position;
    vault={ t:0, dur:plan.dur||0.45, type:plan.type,
            sx:p.x, sz:p.z, lx:plan.land.x, lz:plan.land.z,
            peak:(plan.type==='climb'?0.85:0.5)+ (plan.rise||1)*0.15 };  // eye-arc height
    Audio.play('ui');
  }
  function tickVault(dt){
    vault.t+=dt; const k=Math.min(1, vault.t/vault.dur);
    const ease=k<0.5 ? 2*k*k : 1-Math.pow(-2*k+2,2)/2;            // easeInOutQuad
    const p=GFX.yaw.position;
    p.x=vault.sx+(vault.lx-vault.sx)*ease;
    p.z=vault.sz+(vault.lz-vault.sz)*ease;
    // cosmetic clamber arc: eye rises over the lip then settles to stand height
    const arc=Math.sin(k*Math.PI)*vault.peak;
    GFX.yaw.position.y=HEIGHT+arc*(vault.type==='climb'?0.7:0.45);
    eyeCur=HEIGHT;                                                 // keep the base eye in sync for after
    // a brief downward pitch nudge so the camera "looks at the lip" mid-clamber
    const dip=Math.sin(k*Math.PI)*0.18;
    GFX.pitch.rotation.x=clamp(GFX.pitch.rotation.x*(1-dt*6) - dip*dt*6, -1.5, 1.5);
    if(k>=1){ jumpY=0; velY=0; grounded=true; GFX.yaw.position.y=HEIGHT; vault=null; }
  }
  function spawn(x,z,faceY){ vault=null; GFX.yaw.position.set(x,HEIGHT,z); GFX.yaw.rotation.y=faceY||0; GFX.pitch.rotation.x=0; }
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
    if(moving){ if(mv.lengthSq()>1) mv.normalize(); mv.multiplyScalar(speed*dt*(S.player.ads?0.55:1)); World.moveActor(GFX.yaw.position, mv, RADIUS); }
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
    if(!grounded){ velY-=GRAV*dt; jumpY+=velY*dt; if(jumpY<=0){ jumpY=0; velY=0; grounded=true; } }
    eyeCur += (eye-eyeCur)*Math.min(1,dt*12);
    GFX.yaw.position.y = eyeCur + jumpY;
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
  function resetForRaid(){ S.player.health=S.player.maxHealth; S.player.stamina=S.player.maxStamina; Status.clearAll(); Input.crouch=false; vault=null; }
  return { spawn, heal, useMed, damage, update, resetForRaid, isMoving:()=>movingFlag, inVault, RADIUS, HEIGHT };
})();
