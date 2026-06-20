// status.js — SYS: Status. One authority for all TIMED effects on the player AND
// on enemies. Player/meds/stims/throwables push effects in; this ticks them every
// frame and applies the per-kind logic. Kept deliberately simple (extraction
// shooter, not a survival sim): bleed/burn DoT, speed + stamina buffs, a heal-
// over-time "regen", screen-effect flags (blind/smoked), and the cosmetic
// consumable-use progress. Enemy effects (stun/burn) are mutated onto safe combat
// fields the AI already reads, so enemies.js needs no cooperation.
import { S, MODE, Events, Clock } from "./state.js";
import { Raid } from "./raid.js";
import { Player } from "./player.js";
import { Enemies } from "./enemies.js";

export const Status = (function(){
  let fx={}; // kind -> { dur, mag, ... }  (player-side timed effects)
  const enemyFx=new Map(); // enemy obj -> { burn?:{dur,tick}, slow?:{dur,mag} }

  // ---- player effects ----------------------------------------------------------
  // apply(kind,dur,mag) keeps the original 3-arg signature; opts merges extra data
  // (e.g. regen amount, cure flag) without breaking existing callers.
  function apply(kind,dur,mag,opts){ fx[kind]=Object.assign({ dur, mag:mag||1 }, opts||{}); Events.emit('status:changed'); }
  function clear(kind){ if(fx[kind]){ delete fx[kind]; Events.emit('status:changed'); } }
  function clearAll(){ fx={}; enemyFx.clear(); endUse(true); Events.emit('status:changed'); }
  function has(kind){ return !!fx[kind]; }
  function get(kind){ return fx[kind]||null; }
  function active(){ return Object.keys(fx); }
  // movement multiplier (Player.update reads this). speed.mag may exceed 1 for
  // stronger stims; older callers used mag=1 -> +35% as before.
  function speedMult(){ return fx.speed?(1+0.35*fx.speed.mag):1; }
  // stamina-regen multiplier (Player adds this hook in its stamina recovery).
  function staminaMult(){ return fx.stamina?(1+1.2*fx.stamina.mag):1; }

  // ---- enemy effects (applied by throwables; no enemies.js changes needed) ------
  // STUN: push their next-shot clock forward so they can't fire while flashed.
  function stunEnemy(e, secs){ if(!e||e.dead) return; e.nextShot=Math.max(e.nextShot||0, Clock.now+secs); e.reloading=false; }
  // BURN: timed DoT zone effect — ticked here so it works even though enemies.js
  // doesn't know about fire. Uses Enemies.damage so death/loot/alert all fire.
  function burnEnemy(e, dur, dps){ if(!e||e.dead) return; const cur=enemyFx.get(e)||{}; cur.burn={ dur:Math.max(dur,(cur.burn&&cur.burn.dur)||0), dps, acc:(cur.burn&&cur.burn.acc)||0 }; enemyFx.set(e,cur); }

  // ---- cosmetic consumable-use progress (drives the on-screen use bar) ---------
  let use=null; // { dur, t, label, onDone }
  function beginUse(dur, label, onDone){ use={ dur:Math.max(0.05,dur), t:0, label:label||'USING', onDone }; renderUse(); }
  function cancelUse(){ endUse(true); }
  function isUsing(){ return !!use; }
  function endUse(cancelled){ if(!use) return; const cb=use.onDone; use=null; renderUse(); if(!cancelled && cb) cb(); }
  function useProgress(){ return use? Math.min(1, use.t/use.dur) : 0; }

  // tiny self-managed DOM bar appended to #hud (does not touch ui.js). The screen
  // tints for blind/smoked are likewise injected here so the effect is visible
  // without editing the HUD markup.
  let bar=null, fill=null, lab=null, screen=null;
  function ensureDom(){
    if(bar) return;
    const hud=document.getElementById('hud')||document.body;
    bar=document.createElement('div'); bar.id='useBar';
    bar.style.cssText='position:fixed;left:50%;bottom:23%;transform:translateX(-50%);width:200px;height:26px;'
      +'background:rgba(8,12,16,.78);border:1px solid rgba(120,200,255,.5);border-radius:6px;'
      +'display:none;align-items:center;padding:0 8px;gap:8px;z-index:60;pointer-events:none;'
      +'font:600 11px/1 system-ui,sans-serif;letter-spacing:.08em;color:#bfe3ff;box-shadow:0 0 18px rgba(40,140,220,.35)';
    lab=document.createElement('span'); lab.style.cssText='white-space:nowrap';
    const track=document.createElement('div'); track.style.cssText='flex:1;height:7px;background:rgba(255,255,255,.12);border-radius:4px;overflow:hidden';
    fill=document.createElement('div'); fill.style.cssText='height:100%;width:0%;background:linear-gradient(90deg,#3fd0ff,#7af0c0);transition:width .05s linear';
    track.appendChild(fill); bar.appendChild(lab); bar.appendChild(track); hud.appendChild(bar);
    screen=document.createElement('div'); screen.id='fxScreen';
    screen.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:55;opacity:0;transition:opacity .25s ease';
    hud.appendChild(screen);
  }
  function renderUse(){ ensureDom(); if(!use){ bar.style.display='none'; return; }
    bar.style.display='flex'; lab.textContent=use.label; fill.style.width=(useProgress()*100).toFixed(0)+'%'; }
  function renderScreen(){
    if(!screen) return;
    const blind=fx.blind, smoked=fx.smoked;
    if(blind){ const k=Math.min(1, blind.dur/Math.max(0.001,blind.max||blind.dur)); screen.style.background='rgba(255,250,235,'+(0.15+0.8*k).toFixed(3)+')'; screen.style.opacity='1'; }
    else if(smoked){ screen.style.background='rgba(150,156,162,0.5)'; screen.style.opacity='1'; }
    else { screen.style.opacity='0'; }
  }

  // ---- per-frame tick ----------------------------------------------------------
  function update(dt){
    if(S.mode!==MODE.RAID){ if(use) endUse(true); renderScreen(); return; }

    // consumable use timer (cosmetic progress -> fire effect on completion)
    if(use){ use.t+=dt; if(use.t>=use.dur){ endUse(false); } else renderUse(); }

    // player timed effects
    for(const k in fx){ const f=fx[k]; f.dur-=dt;
      if(k==='bleed'){ S.player.health-=f.mag*dt; if(S.player.health<=0){ S.player.health=0; Raid.onDeath(); } Events.emit('player:changed'); }
      else if(k==='burn'){ S.player.health-=f.mag*dt; if(S.player.health<=0){ S.player.health=0; Raid.onDeath(); } Events.emit('player:changed'); }
      else if(k==='regen'){ const amt=f.mag*dt; const before=S.player.health; S.player.health=Math.min(S.player.maxHealth, S.player.health+amt); if(S.player.health!==before) Events.emit('player:changed'); }
      if(f.dur<=0) delete fx[k];
    }

    // enemy DoT (incendiary). 1Hz-ish damage application so the bar/feedback reads.
    if(enemyFx.size){
      for(const [e,cur] of enemyFx){
        if(!e || e.dead){ enemyFx.delete(e); continue; }
        if(cur.burn){ const b=cur.burn; b.dur-=dt; b.acc+=b.dps*dt;
          if(b.acc>=1){ const n=Math.floor(b.acc); b.acc-=n; try{ Enemies.damage(e, n); }catch(_){ } }
          if(b.dur<=0) delete cur.burn;
        }
        if(!cur.burn && !cur.slow) enemyFx.delete(e);
      }
    }

    renderScreen();
  }

  function reset(){ clearAll(); }

  return { apply, clear, clearAll, has, get, active, speedMult, staminaMult,
           stunEnemy, burnEnemy,
           beginUse, cancelUse, isUsing, useProgress,
           update, reset };
})();
