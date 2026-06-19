// vendor.js — SYS: Vendor. Buy (into stash) / sell (from stash). Prices from item
// value.
import { DATA } from "./data.js";
import { S, Events } from "./state.js";
import { Inventory, newItem } from "./inventory.js";
import { UI } from "./ui.js";
import { Save } from "./save.js";

export const Vendor = (function(){
  function price(id){ return Math.round(DATA.items[id].value*1.6); }
  function buy(id){ const p=price(id); if(S.profile.credits<p){ UI.toast('Not enough credits','neg'); return; }
    const it=newItem(id, DATA.items[id].stack>1?Math.min(DATA.items[id].stack,30):1);
    if(Inventory.stash().add(it)!==0){ UI.toast('Stash full','neg'); return; }
    S.profile.credits-=p; UI.toast(`Bought ${it.def.name}`,'pos'); Events.emit('progress:changed'); Events.emit('inv:changed'); Save.save(); }
  function sell(uid){ const loc=Inventory.locate(uid); if(!loc||loc.where!=='grid') return; const v=Inventory.sellValue(loc.item);
    Inventory.dropOrDestroy(uid); S.profile.credits+=v; UI.toast(`Sold +${v}c`,'pos'); Events.emit('progress:changed'); Save.save(); }
  return { price, buy, sell };
})();
