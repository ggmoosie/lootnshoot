// input.js — SYS: Input. Collects raw input into intents other systems read.
// Input.keys (held), Input.firing, Input.ads. Touch + mouse + keyboard unified.
// Runs at import time: attaches the keyboard/mouse/touch listeners and reads
// GFX.dom, so it must load after gfx.js. Cross-system actions (reload, switch,
// interact, etc.) are only fired at runtime inside handlers.
import { DATA } from "./data.js";
import { S, MODE } from "./state.js";
import { GFX } from "./gfx.js";
import { clamp } from "./util.js";
import { Weapons } from "./weapons.js";
import { Player } from "./player.js";
import { World } from "./world.js";
import { UI } from "./ui.js";
import { Allies } from "./allies.js";

export const Input = (function(){
  const keys={}; const isTouch = window.matchMedia('(pointer: coarse)').matches;
  const st={ keys, firing:false, ads:false, crouch:false, touchMove:{x:0,y:0}, locked:false, isTouch };
  const SENS=0.0022;

  // ---- keybindings (read live from profile.settings, fallback to defaults) ----
  function binds(){ return (S.profile&&S.profile.settings&&S.profile.settings.binds)||DATA.binds; }
  function code(action){ return binds()[action]||DATA.binds[action]; }
  function down(action){ return !!keys[code(action)]; }
  function actionFor(c){ const b=binds(); for(const a in b) if(b[a]===c) return a; return null; }
  function sens(){ return (S.profile&&S.profile.settings?S.profile.settings.sens:1)*SENS; }
  function invY(){ return (S.profile&&S.profile.settings&&S.profile.settings.invertY)?-1:1; }
  function applySettings(){ const s=S.profile&&S.profile.settings; if(!s) return;
    if(s.fov){ GFX.baseFov=s.fov; if(S.mode!==MODE.RAID){ GFX.camera.fov=s.fov; GFX.camera.updateProjectionMatrix(); } }
    // push the camera-feel (headbob / shake) toggles down to GFX so render-time
    // compositing honors them live (default ON when the field is absent on old saves).
    GFX.setFeel({ headbob:s.headbob!==false, camShake:s.camShake!==false }); }
  let capture=null; // rebind capture: {cb}
  function beginCapture(cb){ capture={cb}; }
  // Pointer-lock (re)acquire. requestPointerLock can be refused for ~1.25s after
  // an exitPointerLock (browser security throttle) — that's the "look is frozen
  // for a beat after returning to the safehouse" bug. We don't block input on a
  // timer; instead, if the request errors we arm a short retry so look frees the
  // instant the throttle clears, and the existing click handler is a manual
  // fallback. wantLock guards the retry so we never grab the cursor mid-menu.
  let wantLock=false, relockTimer=0, relockTries=0;
  function relock(){
    if(st.isTouch || !(S.mode===MODE.RAID||S.mode===MODE.HUB)){ wantLock=false; return; }
    wantLock=true; relockTries=0;
    try{ const r=GFX.dom.requestPointerLock(); if(r&&r.catch) r.catch(()=>{}); }catch(e){}
  }
  function _retryRelock(){
    if(relockTries++>=12) return;            // ~3s of retries, then defer to the click fallback
    clearTimeout(relockTimer);
    relockTimer=setTimeout(()=>{
      if(wantLock && !st.locked && !st.isTouch && (S.mode===MODE.RAID||S.mode===MODE.HUB)){
        try{ const r=GFX.dom.requestPointerLock(); if(r&&r.catch) r.catch(()=>{}); }catch(e){}
      }
    }, 250); // a touch past the typical throttle window; re-arms itself via the error event
  }
  document.addEventListener('pointerlockerror',()=>{ if(wantLock) _retryRelock(); });

  addEventListener('keydown',e=>{
    // Ignore keystrokes that belong to a focused form field (bug-report modal,
    // any input/textarea/select, or contenteditable) so typing a report doesn't
    // move/fire/trigger hotkeys. keyup stays unguarded so nothing sticks.
    const t=e.target;
    if(t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if(capture){ e.preventDefault(); if(e.code!=='Escape') capture.cb(e.code); capture=null; return; }
    keys[e.code]=true;
    const a=actionFor(e.code);
    if(a==='jump' && S.mode===MODE.RAID) e.preventDefault();
    if(S.mode===MODE.RAID){
      if(a==='reload') Weapons.reload();
      else if(a==='weapon1') Weapons.switchTo('primary');
      else if(a==='weapon2') Weapons.switchTo('secondary');
      else if(a==='grenade') Weapons.throwGrenade();
      else if(a==='heal') Player.useMed();
      else if(a==='crouch') st.crouch=!st.crouch;
      else if(a==='drone') Allies.deploy();
      else if(a==='firemode') Weapons.cycleMode();
      else if(a==='laser') Weapons.toggleLaser();
      else if(a==='pickup') World.interact('pickup');
    }
    if(a==='interact' && (S.mode===MODE.RAID||S.mode===MODE.HUB)) World.interact('interact');
    // CONSUMABLES HOTBAR — quick-use slots (works in RAID + HUB). Each hotbarN action
    // uses ONE of the consumable in that HUD slot via UI.useHotbarSlot (use-1 path).
    if(a && a.startsWith('hotbar') && (S.mode===MODE.RAID||S.mode===MODE.HUB)){
      const n=parseInt(a.slice(6),10)-1; if(n>=0 && UI.useHotbarSlot) UI.useHotbarSlot(n);
    }
    // TAB — universal "close any open overlay" key. If ANY menu/overlay is showing
    // (inventory, vendor, settings, gunsmith, map, etc.) Tab closes it and re-locks
    // for gameplay. Only when nothing is open does Tab fall through to its bound
    // action (default = open the inventory). Bound separately from the action map so
    // it works even when the bound key isn't Tab and regardless of which menu is up.
    if(e.code==='Tab'){
      e.preventDefault();
      if(UI.anyOverlayOpen && UI.anyOverlayOpen()){ UI.closeTopOverlay(); return; }
    }
    if(a==='inventory'){ e.preventDefault();
      // open the inventory from HUB/RAID. (Closing an already-open overlay is handled
      // by the universal Tab branch above + Escape, so this only needs the open path.)
      if(S.mode===MODE.HUB||S.mode===MODE.RAID) UI.toggleInventory(); }
    if(e.code==='Escape'){ if(S.mode===MODE.MENU) UI.closeMenus(); else if(S.mode===MODE.PAUSE) UI.resume(); else if(S.mode===MODE.RAID) UI.pause(); else if(S.mode===MODE.HUB) UI.openStation('settings'); }
  });
  addEventListener('keyup',e=> keys[e.code]=false);

  // Belt-and-suspenders: zero all held input. Called when an overlay/modal opens
  // (e.g. the bug-report modal) so a key held at that instant can't stay "down"
  // while focus is on a form field (keydown is guarded, so its keyup may still
  // fire and clear it — but this makes a stuck key impossible either way).
  function clearKeys(){ for(const k in keys) keys[k]=false; st.firing=false; st.ads=false; }

  GFX.dom.addEventListener('mousedown',e=>{ if(e.button===0&&S.mode===MODE.RAID&&st.locked) st.firing=true; if(e.button===2&&S.mode===MODE.RAID) st.ads=true; });
  addEventListener('mouseup',e=>{ if(e.button===0) st.firing=false; if(e.button===2) st.ads=false; });
  // pointerup as a second release path: a mouseup can be swallowed if the button is
  // released over an element (or iframe) that eats the event, or after focus shifts.
  // Clearing here too means a held fire/ADS can never get stuck "down".
  addEventListener('pointerup',e=>{ if(e.button===0) st.firing=false; if(e.button===2) st.ads=false; });
  addEventListener('contextmenu',e=>e.preventDefault());

  // ---- never-stuck guards (the "mouse gets stuck/broken" fix) ----
  // Losing window focus, tabbing away, or the page going to the background can
  // strand held mouse buttons / keys "down" (the matching up event fires on a
  // window we're no longer listening to). Zero ALL input on any of those so the
  // player never returns to a frozen look, a stuck trigger, or a stuck sprint.
  addEventListener('blur', clearKeys);
  document.addEventListener('visibilitychange', ()=>{ if(document.hidden) clearKeys(); });

  GFX.dom.addEventListener('click',()=>{ if(st.isTouch) return; if((S.mode===MODE.HUB||S.mode===MODE.RAID)&&!st.locked) relock(); });
  document.addEventListener('pointerlockchange',()=>{ st.locked=document.pointerLockElement===GFX.dom;
    if(st.locked){ wantLock=false; clearTimeout(relockTimer); }      // got it — stop retrying
    // Lost the lock: ALWAYS drop held mouse buttons (a click that opened a menu, or
    // the browser yanking the lock, leaves firing/ADS true otherwise → stuck trigger
    // when we re-lock). Only auto-pause when the loss happened mid-RAID with no menu
    // already taking over (an overlay open = the player chose to leave gameplay).
    if(!st.locked){ st.firing=false; st.ads=false;
      if(S.mode===MODE.RAID) UI.pause(); } });
  document.addEventListener('mousemove',e=>{ if(!st.locked) return;
    GFX.yaw.rotation.y -= e.movementX*sens();
    GFX.pitch.rotation.x = clamp(GFX.pitch.rotation.x - e.movementY*sens()*invY(), -1.5, 1.5);
  });

  // ---- touch (PUBG-style mobile HUD) ----
  // Reuses the SAME intents as keyboard/mouse — these handlers only set the
  // existing st.firing/st.ads/st.crouch flags (and the bound sprint/jump keys) or
  // call the existing Weapons/Player/World/UI actions. No game logic is rewired.
  if(st.isTouch) document.body.classList.add('touch');
  (function touch(){
    const $=id=>document.getElementById(id);
    const cv=GFX.dom;

    // ---- LEFT THUMB: floating joystick (drag-anywhere origin within #joyZone) ----
    // Push-to-edge = sprint: when the knob is held near the rim AND aimed mostly
    // forward, we hold the bound sprint key (so Player.update sprints) and light
    // the rim ring. This folds sprint into the stick — no separate RUN button.
    const zone=$('joyZone'), joy=$('joy'), knob=$('joyK');
    let joyId=null,jx=0,jy=0,running=false;
    const KMAX=()=>Math.min(joy.clientWidth,joy.clientHeight)*0.5*0.82 || 52;
    function setRun(on){ if(on===running) return; running=on; keys[code('sprint')]=on; joy.classList.toggle('run',on); }
    function placeJoy(cx,cy){ // recentre the visible base under the thumb (clamped to viewport)
      const r=joy.getBoundingClientRect(), w=r.width, h=r.height;
      const x=clamp(cx-w/2,4,innerWidth-w-4), y=clamp(cy-h/2,4,innerHeight-h-4);
      joy.style.left=x+'px'; joy.style.bottom='auto'; joy.style.top=y+'px';
      jx=x+w/2; jy=y+h/2;
    }
    function kn(t){ const max=KMAX(); const dx=t.clientX-jx,dy=t.clientY-jy,d=Math.hypot(dx,dy),cl=Math.min(d,max);
      const nx=d?dx/d*cl:0, ny=d?dy/d*cl:0; knob.style.transform=`translate(calc(-50% + ${nx}px),calc(-50% + ${ny}px))`;
      st.touchMove.x=nx/max; st.touchMove.y=ny/max;
      // sprint when pushed to the rim (>=88%) and heading forward (not backpedalling)
      setRun(cl/max>=0.88 && -ny/max>0.4); }
    function resetJoy(){ joyId=null; st.touchMove.x=0; st.touchMove.y=0; setRun(false);
      knob.style.transform='translate(-50%,-50%)';
      joy.style.left=''; joy.style.top=''; joy.style.bottom=''; joy.style.opacity=''; }
    zone.addEventListener('touchstart',e=>{ if(joyId!==null) return; e.preventDefault();e.stopPropagation();
      const t=e.changedTouches[0]; joyId=t.identifier; joy.style.opacity='1'; placeJoy(t.clientX,t.clientY); kn(t); },{passive:false});
    zone.addEventListener('touchmove',e=>{ e.preventDefault();e.stopPropagation(); for(const t of e.changedTouches)if(t.identifier===joyId)kn(t); },{passive:false});
    const ej=e=>{ for(const t of e.changedTouches)if(t.identifier===joyId) resetJoy(); };
    zone.addEventListener('touchend',ej); zone.addEventListener('touchcancel',ej);

    // ---- look: drag anywhere on the 3D canvas ----
    let lookId=null,lx=0,ly=0;
    cv.addEventListener('touchstart',e=>{ if(S.mode!==MODE.RAID&&S.mode!==MODE.HUB)return; for(const t of e.changedTouches)if(lookId===null){lookId=t.identifier;lx=t.clientX;ly=t.clientY;} },{passive:false});
    cv.addEventListener('touchmove',e=>{ if(lookId===null)return; e.preventDefault(); for(const t of e.changedTouches)if(t.identifier===lookId){
      GFX.yaw.rotation.y-=(t.clientX-lx)*0.005; GFX.pitch.rotation.x=clamp(GFX.pitch.rotation.x-(t.clientY-ly)*0.005,-1.5,1.5); lx=t.clientX; ly=t.clientY; } },{passive:false});
    const el=e=>{for(const t of e.changedTouches)if(t.identifier===lookId)lookId=null;};
    cv.addEventListener('touchend',el);cv.addEventListener('touchcancel',el);

    // ---- generic hold/tap helpers (multi-touch safe: tracks its own pointer id) ----
    const hold=(id,on,off)=>{ const el=$(id); if(!el) return; let pid=null;
      el.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();if(pid!==null)return;pid=e.changedTouches[0].identifier;el.classList.add('active');on&&on();},{passive:false});
      const up=e=>{ for(const t of e.changedTouches)if(t.identifier===pid){pid=null;el.classList.remove('active');off&&off();} };
      el.addEventListener('touchend',up);el.addEventListener('touchcancel',up); };
    const tap=(id,fn)=>{ const el=$(id); if(!el) return;
      el.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();el.classList.add('active');fn();},{passive:false});
      const up=e=>{if(e.cancelable)e.preventDefault();el.classList.remove('active');}; el.addEventListener('touchend',up);el.addEventListener('touchcancel',up); };

    // ---- (2) FIRE + ADS ----
    hold('bFire',()=>st.firing=true,()=>st.firing=false);
    hold('bAds', ()=>st.ads=true,  ()=>st.ads=false);

    // ---- (3) action ring: reload / jump / crouch / use (nade+med live in the bar) ----
    tap('bRld', ()=>{ if(S.mode===MODE.RAID) Weapons.reload(); });
    tap('bUse', ()=>{ World.interactAny(); });
    hold('bJump',()=>{ keys[code('jump')]=true; },()=>{ keys[code('jump')]=false; });
    const crouchBtn=$('bCrouch');
    crouchBtn.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();st.crouch=!st.crouch;crouchBtn.classList.toggle('active',st.crouch);},{passive:false});

    // ---- (5) weapon / throwable quick-bar ----
    const qb={ primary:()=>{ if(S.mode===MODE.RAID) Weapons.switchTo('primary'); },
               secondary:()=>{ if(S.mode===MODE.RAID) Weapons.switchTo('secondary'); },
               nade:()=>{ if(S.mode===MODE.RAID) Weapons.throwGrenade(); },
               med:()=>{ if(S.mode===MODE.RAID) Player.useMed(); } };
    document.querySelectorAll('#quickbar .qslot').forEach(slot=>{
      slot.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();slot.classList.add('active');const a=slot.dataset.act;qb[a]&&qb[a]();},{passive:false});
      const up=e=>{if(e.cancelable)e.preventDefault();slot.classList.remove('active');}; slot.addEventListener('touchend',up);slot.addEventListener('touchcancel',up);
    });

    // ---- top-right utility: fire-mode, bag (sprint is folded into the stick) ----
    const modeBtn=$('bMode');
    modeBtn.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();if(S.mode===MODE.RAID){Weapons.cycleMode();const w=Weapons.activeItem();if(w)modeBtn.textContent=Weapons.modeOf(w).toUpperCase();}},{passive:false});
    tap('bInv',()=>{ if(S.mode===MODE.HUB||S.mode===MODE.RAID) UI.toggleInventory(); });
  })();

  Object.assign(st, { down, code, actionFor, beginCapture, applySettings, relock, clearKeys });
  return st;
})();
