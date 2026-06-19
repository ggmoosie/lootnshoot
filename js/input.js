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

  // ---- touch ----
  if(st.isTouch) document.body.classList.add('touch');
  (function touch(){
    const joy=document.getElementById('joy'), knob=document.getElementById('joyK'), cv=GFX.dom;
    let joyId=null,jx=0,jy=0,lookId=null,lx=0,ly=0;
    function kn(t){ const dx=t.clientX-jx,dy=t.clientY-jy,max=52,d=Math.hypot(dx,dy),cl=Math.min(d,max);
      const nx=d?dx/d*cl:0, ny=d?dy/d*cl:0; knob.style.transform=`translate(calc(-50% + ${nx}px),calc(-50% + ${ny}px))`;
      st.touchMove.x=nx/max; st.touchMove.y=ny/max; }
    joy.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();const t=e.changedTouches[0];joyId=t.identifier;const r=joy.getBoundingClientRect();jx=r.left+r.width/2;jy=r.top+r.height/2;kn(t);},{passive:false});
    joy.addEventListener('touchmove',e=>{e.preventDefault();e.stopPropagation();for(const t of e.changedTouches)if(t.identifier===joyId)kn(t);},{passive:false});
    const ej=e=>{for(const t of e.changedTouches)if(t.identifier===joyId){joyId=null;st.touchMove.x=0;st.touchMove.y=0;knob.style.transform='translate(-50%,-50%)';}};
    joy.addEventListener('touchend',ej);joy.addEventListener('touchcancel',ej);
    cv.addEventListener('touchstart',e=>{ if(S.mode!==MODE.RAID&&S.mode!==MODE.HUB)return; for(const t of e.changedTouches)if(lookId===null){lookId=t.identifier;lx=t.clientX;ly=t.clientY;} },{passive:false});
    cv.addEventListener('touchmove',e=>{ if(lookId===null)return; e.preventDefault(); for(const t of e.changedTouches)if(t.identifier===lookId){
      GFX.yaw.rotation.y-=(t.clientX-lx)*0.005; GFX.pitch.rotation.x=clamp(GFX.pitch.rotation.x-(t.clientY-ly)*0.005,-1.5,1.5); lx=t.clientX; ly=t.clientY; } },{passive:false});
    const el=e=>{for(const t of e.changedTouches)if(t.identifier===lookId)lookId=null;};
    cv.addEventListener('touchend',el);cv.addEventListener('touchcancel',el);
    const hold=(id,on,off)=>{ const el=document.getElementById(id);
      el.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();el.classList.add('active');on&&on();},{passive:false});
      const up=e=>{if(e.cancelable)e.preventDefault();el.classList.remove('active');off&&off();}; el.addEventListener('touchend',up);el.addEventListener('touchcancel',up); };
    hold('bFire',()=>st.firing=true,()=>st.firing=false);
    hold('bAds',()=>st.ads=true,()=>st.ads=false);
    hold('bRld',()=>{ if(S.mode===MODE.RAID) Weapons.reload(); });
    hold('bUse',()=>{ World.interactAny(); });
    hold('bNade',()=>{ if(S.mode===MODE.RAID) Weapons.throwGrenade(); });
    hold('bHeal',()=>{ if(S.mode===MODE.RAID) Player.useMed(); });
    hold('bSwap',()=>{ if(S.mode===MODE.RAID) Weapons.switchTo(S.player.activeSlot==='primary'?'secondary':'primary'); });
    hold('bJump',()=>{ keys[code('jump')]=true; },()=>{ keys[code('jump')]=false; });
    const crouchBtn=document.getElementById('bCrouch');
    crouchBtn.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();st.crouch=!st.crouch;crouchBtn.classList.toggle('active',st.crouch);},{passive:false});
    const modeBtn=document.getElementById('bMode');
    modeBtn.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();if(S.mode===MODE.RAID){Weapons.cycleMode();const w=Weapons.activeItem();if(w)modeBtn.textContent=Weapons.modeOf(w).toUpperCase();}},{passive:false});
    const run=document.getElementById('bRun');
    run.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();const on=!keys['ShiftLeft'];keys['ShiftLeft']=on;run.classList.toggle('active',on);},{passive:false});
    hold('bInv',()=>{ if(S.mode===MODE.HUB||S.mode===MODE.RAID) UI.toggleInventory(); });
  })();

  Object.assign(st, { down, code, actionFor, beginCapture, applySettings, relock });
  return st;
})();
