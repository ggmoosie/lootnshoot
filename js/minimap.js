// minimap.js — SYS: Minimap. Top-down canvas radar + heading compass. Reads World
// footprints, loot/container marks, known enemies, extract, and the player
// transform.
//
// HEADING-UP radar: the player sits fixed at centre with a marker that always
// points UP, and the world rotates around it so "forward" is always the top of
// the dial — the standard, readable FPS minimap. (The previous build drew a
// north-up map with a spinning player arrow, which read as "weird" because the
// map never matched where you were looking.) A circular clip keeps the corners
// clean; markers outside the radius are dropped.
import { T } from "./three.js";
import { S, MODE } from "./state.js";
import { GFX } from "./gfx.js";
import { World } from "./world.js";
import { Loot } from "./loot.js";
import { Enemies } from "./enemies.js";

export const Minimap = (function(){
  let cv,ctx,acc=0,strip,SZ=180;
  function init(){ cv=document.getElementById('minimap'); if(cv&&cv.getContext){ ctx=cv.getContext('2d'); SZ=cv.width||180; } strip=document.getElementById('compassStrip'); }
  const _fwd=new T.Vector3();
  function bearing(){ GFX.camera.getWorldDirection(_fwd); let d=Math.atan2(_fwd.x,_fwd.z)*180/Math.PI; return ((d%360)+360)%360; }

  // ---- SMOOTHED HEADING (feat/audio-minimap) --------------------------------
  // The radar/compass used the raw camera bearing every frame, so tiny mouse
  // jitter + the headbob/shake offset on the camera made the dial twitch and snap.
  // We low-pass the heading: ease `smoothH` toward the live bearing along the
  // SHORTEST arc (handling the 360->0 wrap) at an exponential, frame-rate-
  // independent rate. The 0.36s timescale settles a real turn in a few frames
  // while killing per-frame jitter. NaN-safe + first-frame snap so it never starts
  // mid-spin.
  let smoothH=null;
  function smoothBearing(dt){
    const target=bearing();
    if(smoothH===null || !isFinite(smoothH)){ smoothH=target; return smoothH; }
    // shortest signed delta in (-180,180]
    let d=((target-smoothH+540)%360)-180;
    // exponential smoothing: a = 1 - e^(-dt/tau); tau ~= 0.06s feels snappy-but-smooth.
    const a=1-Math.exp(-(dt>0?dt:0.016)/0.06);
    smoothH=((smoothH + d*a)%360+360)%360;
    return smoothH;
  }
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
    if(!inRaid){ ctx.clearRect(0,0,SZ,SZ); if(strip) strip.innerHTML=''; smoothH=null; return; }
    // Integrate the heading low-pass EVERY frame (not only on redraw) so the smooth
    // converges at the true frame rate; then redraw at ~30fps. (Was a single 0.08s
    // throttle reading the RAW bearing — that drove the frame-to-frame jitter.)
    const h=smoothBearing(dt);
    acc+=dt; if(acc<0.034) return; acc=0;

    const info=World.mapInfo(), p=GFX.yaw.position;
    const cx=SZ/2, cy=SZ/2, rad=SZ/2-1;      // radar centre + drawable radius
    const RANGE=56;                            // world units shown from centre to edge
    const S2=rad/RANGE;                        // world→radar px scale (fills the dial)
    const rot=-h*Math.PI/180;                  // rotate world so (smoothed) heading is UP
    const cosT=Math.cos(rot), sinT=Math.sin(rot);
    // map a world point → radar pixel (player-relative, heading-up rotation baked in)
    function toRadar(wx,wz){
      const dx=(wx-p.x)*S2, dy=-(wz-p.z)*S2;   // north-up offset (px), +z = up
      return { x:cx + dx*cosT - dy*sinT, y:cy + dx*sinT + dy*cosT };
    }
    const inDial=(x,y)=>{ const ddx=x-cx, ddy=y-cy; return ddx*ddx+ddy*ddy <= rad*rad; };

    // --- backdrop -----------------------------------------------------------
    ctx.clearRect(0,0,SZ,SZ);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx,cy,rad,0,Math.PI*2); ctx.clip();   // circular radar face
    ctx.fillStyle='rgba(10,12,14,.62)'; ctx.fillRect(0,0,SZ,SZ);

    // --- building footprints (rotated rects) --------------------------------
    ctx.fillStyle='#2c333b';
    for(const b of info.boxes){
      // skip far-away boxes cheaply (radius test on the box centre + half-diagonal)
      const c=toRadar(b.x,b.z); const half=(Math.hypot(b.w,b.d)/2)*S2;
      if((c.x-cx)*(c.x-cx)+(c.y-cy)*(c.y-cy) > (rad+half)*(rad+half)) continue;
      // draw the rect as a rotated quad (corners transformed individually)
      const c1=toRadar(b.x-b.w/2,b.z-b.d/2), c2=toRadar(b.x+b.w/2,b.z-b.d/2),
            c3=toRadar(b.x+b.w/2,b.z+b.d/2), c4=toRadar(b.x-b.w/2,b.z+b.d/2);
      ctx.beginPath(); ctx.moveTo(c1.x,c1.y); ctx.lineTo(c2.x,c2.y); ctx.lineTo(c3.x,c3.y); ctx.lineTo(c4.x,c4.y); ctx.closePath(); ctx.fill();
    }

    // --- loot / containers / corpses ----------------------------------------
    for(const m of Loot.mapMarks()){ const q=toRadar(m.x,m.z); if(!inDial(q.x,q.y)) continue;
      ctx.fillStyle = m.kind==='cont'?'#e8a33d':m.kind==='contdone'?'#5a5040':m.kind==='corpse'?'#888':'#caa84a';
      ctx.beginPath(); ctx.arc(q.x,q.y,m.kind==='cont'?2.6:1.8,0,7); ctx.fill(); }

    // --- extract pad --------------------------------------------------------
    if(info.extract){ const q=toRadar(info.extract.x,info.extract.z);
      // clamp the extract marker to the rim so it's always visible as a bearing cue
      let ex=q.x, ey=q.y; const off=inDial(ex,ey);
      if(!off){ const a=Math.atan2(ey-cy,ex-cx); ex=cx+Math.cos(a)*(rad-7); ey=cy+Math.sin(a)*(rad-7); }
      ctx.strokeStyle='#57c06b'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(ex,ey,5,0,7); ctx.stroke();
      ctx.fillStyle='#57c06b'; ctx.font='8px monospace'; ctx.fillText('EXT',ex-7,ey-8); }

    // --- known enemies (alerted or within sight range) ----------------------
    for(const e of Enemies.list()){ if(e.dead) continue;
      if(!(e.alert||e.group.position.distanceTo(p)<22)) continue;
      const q=toRadar(e.group.position.x,e.group.position.z); if(!inDial(q.x,q.y)) continue;
      ctx.fillStyle='#d8453e'; ctx.beginPath(); ctx.arc(q.x,q.y,2.6,0,7); ctx.fill(); }

    ctx.restore();   // drop the circular clip before the static overlay

    // --- player marker: fixed at centre, always pointing UP (= forward) -----
    ctx.fillStyle='#e8a33d';
    ctx.beginPath(); ctx.moveTo(cx,cy-7); ctx.lineTo(cx+5,cy+6); ctx.lineTo(cx,cy+3); ctx.lineTo(cx-5,cy+6); ctx.closePath(); ctx.fill();

    // --- dial frame + forward tick ------------------------------------------
    ctx.strokeStyle='#2a3138'; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(cx,cy,rad,0,Math.PI*2); ctx.stroke();
    ctx.strokeStyle='rgba(232,163,61,.5)'; ctx.beginPath(); ctx.moveTo(cx,cy-rad); ctx.lineTo(cx,cy-rad+5); ctx.stroke(); // N-of-screen = forward
    compass(h);
  }
  return { update, init };
})();
