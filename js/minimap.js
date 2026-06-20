// minimap.js — SYS: Minimap. Top-down canvas radar + heading compass. Reads World
// footprints, loot/container marks, known enemies, extract, and the player
// transform.
import { T } from "./three.js";
import { S, MODE } from "./state.js";
import { GFX } from "./gfx.js";
import { World } from "./world.js";
import { Loot } from "./loot.js";
import { Enemies } from "./enemies.js";

export const Minimap = (function(){
  let cv,ctx,acc=0,strip;
  function init(){ cv=document.getElementById('minimap'); if(cv&&cv.getContext) ctx=cv.getContext('2d'); strip=document.getElementById('compassStrip'); }
  const _fwd=new T.Vector3();
  function bearing(){ GFX.camera.getWorldDirection(_fwd); let d=Math.atan2(_fwd.x,_fwd.z)*180/Math.PI; return ((d%360)+360)%360; }
  function compass(h){ if(!strip) return; let html=''; const px=1.7;
    // center the strip on whatever width the (responsive) #compass actually is,
    // so the fixed marker at left:50% always lines up with the current heading.
    const cw=(strip.parentElement&&strip.parentElement.clientWidth)||340, half=cw/2; const base=Math.round(h/15)*15;
    const card={0:'N',45:'NE',90:'E',135:'SE',180:'S',225:'SW',270:'W',315:'NW'};
    for(let d=base-90; d<=base+90; d+=15){ const dd=((d%360)+360)%360; const lab=card[dd]||dd; const x=half+(d-h)*px;
      html+=`<span class="cd ${dd%45===0?'card':''}" style="position:absolute;left:${x-30}px;width:60px">${lab}</span>`; }
    strip.innerHTML=html;
  }
  let wrap;
  function update(dt){
    if(!ctx) init(); if(!ctx) return;
    if(!wrap) wrap=document.getElementById('mapwrap');
    // the radar is raid-only; hide the empty box (and compass) in the safehouse so
    // the HUD reads clean instead of showing a black void where the map will be.
    const inRaid=S.mode===MODE.RAID;
    if(wrap) wrap.style.display=inRaid?'':'none';
    const comp=document.getElementById('compass'); if(comp) comp.style.visibility=inRaid?'':'hidden';
    if(!inRaid){ ctx.clearRect(0,0,180,180); if(strip) strip.innerHTML=''; return; }
    acc+=dt; if(acc<0.08) return; acc=0;
    const info=World.mapInfo(), p=GFX.yaw.position, R=56, S2=88/R, cx=90, cy=90;
    const tx=wx=>cx+(wx-p.x)*S2, ty=wz=>cy-(wz-p.z)*S2;
    ctx.clearRect(0,0,180,180); ctx.fillStyle='rgba(10,12,14,.55)'; ctx.fillRect(0,0,180,180);
    ctx.fillStyle='#2c333b';
    for(const b of info.boxes){ const x=tx(b.x-b.w/2), y=ty(b.z+b.d/2), w=b.w*S2, h=b.d*S2; if(x>180||y>180||x+w<0||y+h<0) continue; ctx.fillRect(x,y,Math.max(1,w),Math.max(1,h)); }
    for(const m of Loot.mapMarks()){ const x=tx(m.x), y=ty(m.z); if(x<0||x>180||y<0||y>180) continue;
      ctx.fillStyle = m.kind==='cont'?'#e8a33d':m.kind==='contdone'?'#5a5040':m.kind==='corpse'?'#888':'#caa84a';
      ctx.beginPath(); ctx.arc(x,y,m.kind==='cont'?2.6:1.8,0,7); ctx.fill(); }
    if(info.extract){ const x=tx(info.extract.x), y=ty(info.extract.z); ctx.strokeStyle='#57c06b'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(x,y,5,0,7); ctx.stroke(); ctx.fillStyle='#57c06b'; ctx.font='8px monospace'; ctx.fillText('EXT',x-7,y-8); }
    for(const e of Enemies.list()){ if(e.dead) continue; if(!(e.alert||e.group.position.distanceTo(p)<22)) continue; const x=tx(e.group.position.x), y=ty(e.group.position.z); if(x<0||x>180||y<0||y>180) continue; ctx.fillStyle='#d8453e'; ctx.beginPath(); ctx.arc(x,y,2.6,0,7); ctx.fill(); }
    const h=bearing(); ctx.save(); ctx.translate(cx,cy); ctx.rotate(h*Math.PI/180); ctx.fillStyle='#e8a33d'; ctx.beginPath(); ctx.moveTo(0,-6); ctx.lineTo(4,5); ctx.lineTo(0,2); ctx.lineTo(-4,5); ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.strokeStyle='#2a3138'; ctx.lineWidth=1; ctx.strokeRect(0,0,180,180);
    compass(h);
  }
  return { update, init };
})();
