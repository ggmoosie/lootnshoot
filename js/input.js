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
  const st={ keys, firing:false, ads:false, crouch:false, touchMove:{x:0,y:0}, locked:false, isTouch, lean:0 };
  const SENS=0.0022;

  // ---- keybindings (read live from profile.settings, fallback to defaults) ----
  function binds(){ return (S.profile&&S.profile.settings&&S.profile.settings.binds)||DATA.binds; }
  function code(action){ return binds()[action]||DATA.binds[action]; }
  function down(action){ return !!keys[code(action)]; }
  function actionFor(c){ const b=binds(); for(const a in b) if(b[a]===c) return a; return null; }
  function sens(){ return (S.profile&&S.profile.settings?S.profile.settings.sens:1)*SENS; }
  function invY(){ return (S.profile&&S.profile.settings&&S.profile.settings.invertY)?-1:1; }
  function applySettings(){ const s=S.profile&&S.profile.settings; if(s&&s.fov){ GFX.baseFov=s.fov; if(S.mode!==MODE.RAID){ GFX.camera.fov=s.fov; GFX.camera.updateProjectionMatrix(); } } }
  let capture=null; // rebind capture: {cb}
  function beginCapture(cb){ capture={cb}; }
  function relock(){ try{ if(!st.isTouch && (S.mode===MODE.RAID||S.mode===MODE.HUB)) GFX.dom.requestPointerLock(); }catch(e){} }

  addEventListener('keydown',e=>{
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
      else if(a==='pickup') World.interact('pickup');
    }
    if(a==='interact' && (S.mode===MODE.RAID||S.mode===MODE.HUB)) World.interact('interact');
    if(a==='inventory'){ e.preventDefault(); if(S.mode===MODE.HUB||S.mode===MODE.RAID) UI.toggleInventory(); }
    if(e.code==='Escape'){ if(S.mode===MODE.MENU) UI.closeMenus(); else if(S.mode===MODE.PAUSE) UI.resume(); else if(S.mode===MODE.RAID) UI.pause(); else if(S.mode===MODE.HUB) UI.openStation('settings'); }
  });
  addEventListener('keyup',e=> keys[e.code]=false);

  GFX.dom.addEventListener('mousedown',e=>{ if(e.button===0&&S.mode===MODE.RAID&&st.locked) st.firing=true; if(e.button===2&&S.mode===MODE.RAID) st.ads=true; });
  addEventListener('mouseup',e=>{ if(e.button===0) st.firing=false; if(e.button===2) st.ads=false; });
  addEventListener('contextmenu',e=>e.preventDefault());

  GFX.dom.addEventListener('click',()=>{ if(st.isTouch) return; if((S.mode===MODE.HUB||S.mode===MODE.RAID)&&!st.locked) relock(); });
  document.addEventListener('pointerlockchange',()=>{ st.locked=document.pointerLockElement===GFX.dom; if(!st.locked&&S.mode===MODE.RAID) UI.pause(); });
  document.addEventListener('mousemove',e=>{ if(!st.locked) return;
    GFX.yaw.rotation.y -= e.movementX*sens();
    GFX.pitch.rotation.x = clamp(GFX.pitch.rotation.x - e.movementY*sens()*invY(), -1.5, 1.5);
  });

  // ---- touch (PUBG-style mobile HUD) ----
  // Reuses the SAME intents as keyboard/mouse — these handlers only set the
  // existing st.firing/st.ads/st.crouch/st.lean flags or call the existing
  // Weapons/Player/World/UI actions. No game logic is rewired here.
  if(st.isTouch) document.body.classList.add('touch');
  (function touch(){
    const $=id=>document.getElementById(id);
    const cv=GFX.dom;

    // ---- (1) left floating joystick: drag-anywhere origin within #joyZone ----
    const zone=$('joyZone'), joy=$('joy'), knob=$('joyK');
    let joyId=null,jx=0,jy=0;
    const KMAX=()=>Math.min(joy.clientWidth,joy.clientHeight)*0.5*0.82 || 52;
    function placeJoy(cx,cy){ // recentre the visible base under the thumb (clamped to viewport)
      const r=joy.getBoundingClientRect(), w=r.width, h=r.height;
      const x=clamp(cx-w/2,4,innerWidth-w-4), y=clamp(cy-h/2,4,innerHeight-h-4);
      joy.style.left=x+'px'; joy.style.bottom='auto'; joy.style.top=y+'px';
      jx=x+w/2; jy=y+h/2;
    }
    function kn(t){ const max=KMAX(); const dx=t.clientX-jx,dy=t.clientY-jy,d=Math.hypot(dx,dy),cl=Math.min(d,max);
      const nx=d?dx/d*cl:0, ny=d?dy/d*cl:0; knob.style.transform=`translate(calc(-50% + ${nx}px),calc(-50% + ${ny}px))`;
      st.touchMove.x=nx/max; st.touchMove.y=ny/max; }
    function resetJoy(){ joyId=null; st.touchMove.x=0; st.touchMove.y=0; knob.style.transform='translate(-50%,-50%)';
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

    // ---- (3) reload / crouch / jump + use / nade / med ----
    tap('bRld', ()=>{ if(S.mode===MODE.RAID) Weapons.reload(); });
    tap('bUse', ()=>{ World.interactAny(); });
    tap('bNade',()=>{ if(S.mode===MODE.RAID) Weapons.throwGrenade(); });
    tap('bHeal',()=>{ if(S.mode===MODE.RAID) Player.useMed(); });
    hold('bJump',()=>{ keys[code('jump')]=true; },()=>{ keys[code('jump')]=false; });
    const crouchBtn=$('bCrouch');
    crouchBtn.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();st.crouch=!st.crouch;crouchBtn.classList.toggle('active',st.crouch);},{passive:false});

    // ---- (4) lean / peek (presentational camera roll — not collision/movement) ----
    hold('bLeanL',()=>st.lean=-1,()=>{ if(st.lean<0) st.lean=0; });
    hold('bLeanR',()=>st.lean= 1,()=>{ if(st.lean>0) st.lean=0; });

    // ---- (5) weapon / throwable quick-bar ----
    const qb={ primary:()=>{ if(S.mode===MODE.RAID) Weapons.switchTo('primary'); },
               secondary:()=>{ if(S.mode===MODE.RAID) Weapons.switchTo('secondary'); },
               nade:()=>{ if(S.mode===MODE.RAID) Weapons.throwGrenade(); },
               med:()=>{ if(S.mode===MODE.RAID) Player.useMed(); } };
    document.querySelectorAll('#quickbar .qslot').forEach(slot=>{
      slot.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();slot.classList.add('active');const a=slot.dataset.act;qb[a]&&qb[a]();},{passive:false});
      const up=e=>{if(e.cancelable)e.preventDefault();slot.classList.remove('active');}; slot.addEventListener('touchend',up);slot.addEventListener('touchcancel',up);
    });

    // ---- top-right utility: fire-mode, sprint toggle, bag ----
    const modeBtn=$('bMode');
    modeBtn.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();if(S.mode===MODE.RAID){Weapons.cycleMode();const w=Weapons.activeItem();if(w)modeBtn.textContent=Weapons.modeOf(w).toUpperCase();}},{passive:false});
    const run=$('bRun');
    run.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();const sk=code('sprint');const on=!keys[sk];keys[sk]=on;run.classList.toggle('active',on);},{passive:false});
    tap('bInv',()=>{ if(S.mode===MODE.HUB||S.mode===MODE.RAID) UI.toggleInventory(); });

    // ---- lean roll: lerp camera.rotation.z toward the held lean (purely visual) ----
    if(st.isTouch){
      const LEAN=0.18, base=GFX.camera.position.x; let cur=0;
      (function leanLoop(){ requestAnimationFrame(leanLoop);
        const target=(S.mode===MODE.RAID? st.lean*LEAN : 0);
        cur += (target-cur)*0.18;
        GFX.camera.rotation.z = -cur;
        GFX.camera.position.x = base + cur*0.9;
      })();
    }
  })();

  Object.assign(st, { down, code, actionFor, beginCapture, applySettings, relock });
  return st;
})();
