// fx.js — SYS: FX. Short-lived world effects (bullet impacts: spark flash +
// debris; muzzle flash: additive glow sprite + sparks) plus the shared tracer-line
// helper. Pooled-ish; ticks in the loop and self-prunes.
import { T } from "./three.js";
import { GFX } from "./gfx.js";

// one-shot tracer line a->b, auto-removed. Shared by Weapons (player) + Enemies.
export function fxTracer(a,b,color){ try{ const geo=new T.BufferGeometry().setFromPoints([a,b]); const line=new T.Line(geo,new T.LineBasicMaterial({color:color||0xffd27a,transparent:true,opacity:.7})); GFX.world.add(line); setTimeout(()=>{ GFX.world.remove(line); try{geo.dispose();}catch(e){} },70); }catch(e){} }

export const FX = (function(){
  const live=[];
  // shared soft-glow sprite texture: a radial gradient baked once, reused for every
  // additive flash/spark so a muzzle pop reads as a translucent halo'd flash instead
  // of an opaque blocking sphere. Built lazily, cached module-wide.
  let _glow=null;
  function glowTex(){
    if(_glow) return _glow;
    const c=document.createElement('canvas'); c.width=c.height=64; const x=c.getContext('2d');
    const g=x.createRadialGradient(32,32,0,32,32,32);
    g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.35,'rgba(255,255,255,0.55)');
    g.addColorStop(0.7,'rgba(255,255,255,0.12)'); g.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=g; x.beginPath(); x.arc(32,32,32,0,Math.PI*2); x.fill();
    _glow=new T.CanvasTexture(c); return _glow;
  }
  function impact(p, color){
    const c = color||0xb8b0a0;
    const flash=new T.Mesh(new T.SphereGeometry(0.1,6,6), new T.MeshBasicMaterial({color:c,transparent:true,opacity:.8}));
    flash.position.copy(p); GFX.world.add(flash); live.push({m:flash,t:0,life:0.1,flash:true});
    const n=4+Math.floor(Math.random()*3);
    for(let i=0;i<n;i++){ const m=new T.Mesh(new T.SphereGeometry(0.035,4,4), new T.MeshBasicMaterial({color:c,transparent:true,opacity:.9}));
      m.position.copy(p); GFX.world.add(m);
      live.push({m, v:new T.Vector3((Math.random()-.5)*3.4,Math.random()*2.6+0.4,(Math.random()-.5)*3.4), t:0, life:0.26+Math.random()*0.15}); }
  }
  // ---- MUZZLE FLASH: a SPARKY GLOWY pop at the muzzle WORLD position (`p`),
  // thrown along the bore direction (`dir`). It is NOT a screen-blocking block:
  // a small ADDITIVE glow SPRITE (always-faces-camera, depth-independent so it
  // never z-fights the gun) that flares then vanishes in ~70ms, plus a handful of
  // short-lived ADDITIVE spark sprites that streak forward off the muzzle. All
  // additive + transparent so the view stays clear. Reuses the cached glow texture.
  function muzzle(p, dir, color){
    if(!p) return;
    const c = color||0xffd9a0;
    const d = dir? dir.clone().normalize() : new T.Vector3(0,0,-1);
    // core flash sprite — small + additive, scales up briefly then dies fast.
    const fm=new T.SpriteMaterial({map:glowTex(),color:c,transparent:true,opacity:.95,blending:T.AdditiveBlending,depthTest:false,depthWrite:false});
    const fl=new T.Sprite(fm); fl.scale.setScalar(0.16); fl.position.copy(p);
    GFX.world.add(fl); live.push({m:fl, t:0, life:0.07, mflash:true, base:0.16});
    // forward sparks — tiny additive sprites that streak off the muzzle along the
    // bore with a little spread + slight gravity, dimming as they fly.
    const n=5+Math.floor(Math.random()*4);
    for(let i=0;i<n;i++){
      const sm=new T.SpriteMaterial({map:glowTex(),color:c,transparent:true,opacity:.9,blending:T.AdditiveBlending,depthTest:false,depthWrite:false});
      const s=new T.Sprite(sm); s.scale.setScalar(0.03+Math.random()*0.03); s.position.copy(p);
      // mostly forward, with a cone of jitter
      const v=d.clone().multiplyScalar(6+Math.random()*6);
      v.x+=(Math.random()-.5)*3.2; v.y+=(Math.random()-.5)*3.2; v.z+=(Math.random()-.5)*3.2;
      GFX.world.add(s); live.push({m:s, v, t:0, life:0.10+Math.random()*0.10, spark:true});
    }
  }
  function update(dt){
    for(let i=live.length-1;i>=0;i--){ const e=live[i]; e.t+=dt; const k=Math.max(0,1-e.t/e.life);
      if(e.mflash){ e.m.scale.setScalar(e.base*(1+e.t*10)); e.m.material.opacity=0.95*k; }
      else if(e.spark){ e.v.y-=10*dt; e.m.position.addScaledVector(e.v,dt); e.m.material.opacity=0.9*k; }
      else if(e.flash){ e.m.scale.setScalar(1+e.t*9); e.m.material.opacity=0.8*k; }
      else { e.v.y-=9*dt; e.m.position.addScaledVector(e.v,dt); e.m.material.opacity=0.9*k; }
      if(e.t>=e.life){ GFX.world.remove(e.m); try{e.m.geometry&&e.m.geometry.dispose();}catch(_){}; try{e.m.material&&e.m.material.dispose();}catch(_){}; live.splice(i,1); } }
  }
  function clear(){ for(const e of live) GFX.world.remove(e.m); live.length=0; }
  return { impact, muzzle, update, clear };
})();
