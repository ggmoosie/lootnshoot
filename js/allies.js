// allies.js — SYS: Allies. Deployable companions. Recon Drone follows the player,
// auto-fires at the nearest enemy in range, and expires after a lifetime. Deploy
// from a carried drone_kit (key T). Extend for turrets, AI teammates, etc.
import { T } from "./three.js";
import { DATA } from "./data.js";
import { S, MODE, Clock, Events } from "./state.js";
import { GFX } from "./gfx.js";
import { Inventory } from "./inventory.js";
import { UI } from "./ui.js";
import { Audio } from "./audio.js";
import { Enemies } from "./enemies.js";

export const Allies = (function(){
  let drones=[];
  function clear(){ for(const d of drones) GFX.world.remove(d.mesh); drones=[]; }
  function deploy(){
    if(S.mode!==MODE.RAID){ UI.toast('Deploy in a raid','neg'); return; }
    const grids=Inventory.carried(); let src=null;
    for(const g of grids){ const t=g.items.find(i=>i.def.deploy==='drone'); if(t){ src={g,t}; break; } }
    if(!src){ UI.toast('No drone kit','neg'); return; }
    if(src.t.qty>1) src.t.qty--; else src.g.remove(src.t.uid);
    const def=DATA.allies.drone;
    const m=new T.Mesh(new T.BoxGeometry(.5,.3,.5), new T.MeshStandardMaterial({color:0x9fd0ff,emissive:0x3a6f9f,emissiveIntensity:.4}));
    const p=GFX.yaw.position; m.position.set(p.x+1,2.2,p.z+1); GFX.world.add(m);
    drones.push({ mesh:m, def, hp:def.hp, next:0, life:def.life });
    UI.toast('Recon drone online','pos'); Events.emit('inv:changed');
  }
  function update(dt){
    if(S.mode!==MODE.RAID){ if(drones.length) clear(); return; }
    const p=GFX.yaw.position;
    for(let i=drones.length-1;i>=0;i--){ const d=drones[i]; d.life-=dt;
      const tx=p.x+Math.sin(Clock.now*0.6)*1.6, tz=p.z+Math.cos(Clock.now*0.6)*1.6;
      d.mesh.position.x+=(tx-d.mesh.position.x)*Math.min(1,dt*2.2);
      d.mesh.position.z+=(tz-d.mesh.position.z)*Math.min(1,dt*2.2);
      d.mesh.position.y=2.2; d.mesh.rotation.y+=dt*2.5;
      let best=null,bd=d.def.range;
      for(const e of Enemies.list()){ if(e.dead) continue; const ed=e.group.position.distanceTo(d.mesh.position); if(ed<bd){ bd=ed; best=e; } }
      if(best && Clock.now>d.next){ d.next=Clock.now+d.def.fireDelay; Enemies.damage(best, d.def.damage); Audio.play('drone'); }
      if(d.life<=0){ GFX.world.remove(d.mesh); drones.splice(i,1); UI.toast('Drone offline','neu'); }
    }
  }
  return { clear, deploy, update };
})();
