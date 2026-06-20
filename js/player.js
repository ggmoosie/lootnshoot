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
  function spawn(x,z,faceY){ GFX.yaw.position.set(x,HEIGHT,z); GFX.yaw.rotation.y=faceY||0; GFX.pitch.rotation.x=0; }
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
    // jump + gravity (vertical only; XZ collision is 2D)
    const eye = HEIGHT*(crouch?0.72:1);
    if(grounded && !crouch && Input.down('jump') && (S.mode===MODE.RAID||S.mode===MODE.HUB)){ velY=JUMP; grounded=false; Audio.play('ui'); }
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
  function resetForRaid(){ S.player.health=S.player.maxHealth; S.player.stamina=S.player.maxStamina; Status.clearAll(); Input.crouch=false; }
  return { spawn, heal, useMed, damage, update, resetForRaid, isMoving:()=>movingFlag, RADIUS, HEIGHT };
})();
