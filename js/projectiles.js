// projectiles.js — SYS: Projectiles. Grenades (arc + radius damage). Minimal;
// extend for rockets.
import { T } from "./three.js";
import { DATA } from "./data.js";
import { GFX } from "./gfx.js";
import { Perception } from "./perception.js";
import { Audio } from "./audio.js";
import { Enemies } from "./enemies.js";

export const Projectiles = (function(){
  const live=[];
  function spawnGrenade(){
    const dir=new T.Vector3(); GFX.camera.getWorldDirection(dir);
    const org=new T.Vector3(); GFX.camera.getWorldPosition(org);
    const mesh=new T.Mesh(new T.SphereGeometry(.15,8,8), new T.MeshStandardMaterial({color:0x2f3a22}));
    mesh.position.copy(org); GFX.world.add(mesh);
    live.push({mesh, vel:dir.multiplyScalar(18).add(new T.Vector3(0,4,0)), t:0});
  }
  function boom(p){
    Perception.noise(p, DATA.noise.boom, 'boom'); Audio.play('boom');
    const def=DATA.items.nade_frag;
    for(const e of Enemies.list()){ if(e.dead) continue; const d=e.group.position.distanceTo(p); if(d<def.radius) Enemies.damage(e, def.dmg*(1-d/def.radius)); }
    const f=new T.Mesh(new T.SphereGeometry(def.radius,12,12), new T.MeshBasicMaterial({color:0xffaa33,transparent:true,opacity:.5}));
    f.position.copy(p); GFX.world.add(f);
    setTimeout(()=>GFX.world.remove(f),120);
  }
  function update(dt){
    for(let i=live.length-1;i>=0;i--){ const g=live[i]; g.t+=dt;
      g.vel.y-=20*dt; g.mesh.position.addScaledVector(g.vel,dt);
      if(g.mesh.position.y<=.15 || g.t>3){ g.mesh.position.y=.15; boom(g.mesh.position.clone()); GFX.world.remove(g.mesh); live.splice(i,1); } }
  }
  function clear(){ live.length=0; }
  return { spawnGrenade, update, clear };
})();
