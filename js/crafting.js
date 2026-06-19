// crafting.js — SYS: Crafting. Recipes consume stash materials, produce into
// stash. Station tag = "printer".
import { Events } from "./state.js";
import { Inventory, newItem } from "./inventory.js";
import { UI } from "./ui.js";
import { Save } from "./save.js";

export const Crafting = (function(){
  function can(r){ return r.in.every(req=>Inventory.stash().count(req.id)>=req.qty); }
  function craft(r){ if(!can(r)){ UI.toast('Missing materials','neg'); return; }
    r.in.forEach(req=>Inventory.stash().consume(req.id,req.qty));
    const out=newItem(r.out.id, r.out.qty); if(Inventory.stash().add(out)!==0){ UI.toast('Stash full','neg'); return; }
    UI.toast(`Crafted ${out.def.name}`,'pos'); Events.emit('inv:changed'); Save.save(); }
  return { can, craft };
})();
