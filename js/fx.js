// fx.js — SYS: FX. Short-lived world effects (bullet impacts: spark flash +
// debris) plus the shared tracer-line helper. Pooled-ish; ticks in the loop and
// self-prunes.
import { T } from "./three.js";
import { GFX } from "./gfx.js";

// one-shot tracer line a->b, auto-removed. Shared by Weapons (player) + Enemies.
export function fxTracer(a,b,color){ try{ const geo=new T.BufferGeometry().setFromPoints([a,b]); const line=new T.Line(geo,new T.LineBasicMaterial({color:color||0xffd27a,transparent:true,opacity:.7})); GFX.world.add(line); setTimeout(()=>{ GFX.world.remove(line); try{geo.dispose();}catch(e){} },70); }catch(e){} }

export const FX = (function(){
  const live=[];
  function impact(p, color){
    const c = color||0xb8b0a0;
    const flash=new T.Mesh(new T.SphereGeometry(0.1,6,6), new T.MeshBasicMaterial({color:c,transparent:true,opacity:.8}));
    flash.position.copy(p); GFX.world.add(flash); live.push({m:flash,t:0,life:0.1,flash:true});
    const n=4+Math.floor(Math.random()*3);
    for(let i=0;i<n;i++){ const m=new T.Mesh(new T.SphereGeometry(0.035,4,4), new T.MeshBasicMaterial({color:c,transparent:true,opacity:.9}));
      m.position.copy(p); GFX.world.add(m);
      live.push({m, v:new T.Vector3((Math.random()-.5)*3.4,Math.random()*2.6+0.4,(Math.random()-.5)*3.4), t:0, life:0.26+Math.random()*0.15}); }
  }
  function update(dt){
    for(let i=live.length-1;i>=0;i--){ const e=live[i]; e.t+=dt; const k=Math.max(0,1-e.t/e.life);
      if(e.flash){ e.m.scale.setScalar(1+e.t*9); e.m.material.opacity=0.8*k; }
      else { e.v.y-=9*dt; e.m.position.addScaledVector(e.v,dt); e.m.material.opacity=0.9*k; }
      if(e.t>=e.life){ GFX.world.remove(e.m); try{e.m.geometry.dispose();}catch(_){}; live.splice(i,1); } }
  }
  function clear(){ for(const e of live) GFX.world.remove(e.m); live.length=0; }
  return { impact, update, clear };
})();
