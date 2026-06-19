// harvest.js — SYS: Harvest. Resource nodes in raids. Interact (E) to pull
// materials into the inventory; nodes deplete after a few pulls. Feeds the
// 'gather' objective.
import { T } from "./three.js";
import { Events } from "./state.js";
import { GFX } from "./gfx.js";
import { Inventory } from "./inventory.js";
import { UI } from "./ui.js";
import { Audio } from "./audio.js";
import { World } from "./world.js";

export const Harvest = (function(){
  let nodes=[];
  function clear(){ nodes=[]; }
  function spawn(x,z,rng){
    const m=new T.Mesh(new T.BoxGeometry(1.1,1.1,1.1), new T.MeshStandardMaterial({color:0x3f5a3f,emissive:0x2f6f3f,emissiveIntensity:.22}));
    m.position.set(x,.55,z); GFX.world.add(m);
    const yieldId=(rng&&rng()>.55)?'mat_elec':'mat_scrap';
    const node={ pos:new T.Vector3(x,1,z), mesh:m, yieldId, left:3 };
    nodes.push(node);
    World.addInteract({ pos:node.pos, radius:2.4, label:'gather resources', action:()=>gather(node) });
  }
  function gather(node){
    if(node.left<=0){ UI.toast('Depleted','neg'); return; }
    const it=Inventory.newItem(node.yieldId, 1+Math.floor(Math.random()*2));
    if(Inventory.addLoot(it)){ node.left--; UI.toast(`+${it.qty} ${it.def.name}`,'neu'); Audio.play('pickup'); Events.emit('obj:material', it.qty);
      if(node.left<=0){ node.mesh.material.emissiveIntensity=0; node.mesh.material.color=new T.Color(0x33392c); } }
    else UI.toast('Inventory full','neg');
  }
  function update(dt){ for(const n of nodes) if(n.left>0) n.mesh.rotation.y+=dt*0.6; }
  return { clear, spawn, update };
})();
