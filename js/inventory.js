// inventory.js — SYS: Inventory. Grid containers + equipment. The Grid class is
// the spine of loot/gear/vendor/crafting. Items are instances:
// {uid, def, qty, x, y, rot, inst}. inst holds per-instance data (weapon
// ammo+attachments, container grids). Also exports the item factory/serialization
// helpers (newItem/serItem/desItem) that the whole game uses.
import { DATA } from "./data.js";
import { S, MODE, Events, EQUIP_SLOTS, uid } from "./state.js";

export class Grid {
  constructor(w,h){ this.w=w; this.h=h; this.items=[]; }
  _map(){
    const m=new Array(this.w*this.h).fill(null);
    for(const it of this.items){
      const w=it.rot?it.def.size[1]:it.def.size[0], h=it.rot?it.def.size[0]:it.def.size[1];
      for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
        const gx=it.x+xx, gy=it.y+yy;
        if(gx<this.w&&gy<this.h) m[gy*this.w+gx]=it.uid;
      }
    }
    return m;
  }
  fits(def,x,y,rot,ignore){
    const w=rot?def.size[1]:def.size[0], h=rot?def.size[0]:def.size[1];
    if(x<0||y<0||x+w>this.w||y+h>this.h) return false;
    const m=this._map();
    for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
      const c=m[(y+yy)*this.w+(x+xx)];
      if(c&&c!==ignore) return false;
    }
    return true;
  }
  // add: top up stacks, then place leftover. returns leftover qty (0 = fully added)
  add(item){
    if(item.def.stack>1){
      for(const it of this.items){
        if(it.def.id===item.def.id && it.qty<item.def.stack){
          const take=Math.min(item.def.stack-it.qty, item.qty);
          it.qty+=take; item.qty-=take;
          if(item.qty<=0) return 0;
        }
      }
    }
    for(let y=0;y<this.h;y++)for(let x=0;x<this.w;x++){
      for(const rot of [0,1]){
        if(this.fits(item.def,x,y,rot)){ item.x=x; item.y=y; item.rot=rot; this.items.push(item); return 0; }
      }
    }
    return item.qty;
  }
  remove(uid){ const i=this.items.findIndex(t=>t.uid===uid); return i>=0?this.items.splice(i,1)[0]:null; }
  find(uid){ return this.items.find(t=>t.uid===uid)||null; }
  count(id){ return this.items.filter(t=>t.def.id===id).reduce((a,b)=>a+b.qty,0); }
  consume(id,n){
    if(this.count(id)<n) return false;
    for(const it of [...this.items]){
      if(it.def.id===id){ const t=Math.min(it.qty,n); it.qty-=t; n-=t; if(it.qty<=0) this.remove(it.uid); if(n<=0) break; }
    }
    return true;
  }
  toJSON(){ return {w:this.w,h:this.h,items:this.items.map(serItem)}; }
  static fromJSON(o){ const g=new Grid(o.w,o.h); g.items=o.items.map(desItem); return g; }
}

export function defaultInst(def){
  if(def.type==='weapon') return {ammo:0, attachments:{}};
  if(def.grid) return {container:new Grid(def.grid[0],def.grid[1])};
  return {};
}
export function newItem(id, qty=1, inst){
  const def=DATA.items[id]; if(!def){ console.warn('no item',id); return null; }
  return {uid:uid(), def, qty:def.stack>1?qty:1, x:0,y:0,rot:0, inst: inst||defaultInst(def)};
}
export function serItem(it){
  const o={id:it.def.id, qty:it.qty, x:it.x, y:it.y, rot:it.rot, inst:{}};
  if(it.def.type==='weapon'){ o.inst.ammo=it.inst.ammo||0; o.inst.attachments=it.inst.attachments||{}; }
  if(it.def.grid){ o.inst.container=it.inst.container.toJSON(); }
  if(typeof it.def.maxDura==='number' && typeof it.inst.dura==='number') o.inst.dura=it.inst.dura; // gear wear (durability-lite)
  return o;
}
export function desItem(o){
  const def=DATA.items[o.id]; const inst={};
  if(def.type==='weapon'){ inst.ammo=o.inst.ammo||0; inst.attachments=o.inst.attachments||{}; }
  if(def.grid){ inst.container=o.inst&&o.inst.container?Grid.fromJSON(o.inst.container):new Grid(def.grid[0],def.grid[1]); }
  if(typeof def.maxDura==='number') inst.dura = (o.inst&&typeof o.inst.dura==='number')?o.inst.dura:def.maxDura; // restore/seed gear wear
  return {uid:uid(), def, qty:o.qty, x:o.x, y:o.y, rot:o.rot, inst};
}

export const Inventory = (function(){
  // The currently-open external actor being looted (a corpse or a crate). A corpse
  // is a STRUCTURED second actor mirroring the player: its own equip slots
  // (primary/secondary/helmet/armor/rig/backpack) plus the nested grids inside its
  // rig + backpack. A crate is just a flat grid. setExternal() normalises either
  // shape into one descriptor: { equip:{slot:item}, grid:Grid|null }.
  //   - equip : the corpse's equipped pieces (item instance or null per slot)
  //   - grid  : a crate's single flat grid (null for corpses)
  // The corpse's lootable grids (rig + backpack containers) are derived live from
  // its equip via extGrids() so they always reflect what is still equipped.
  let ext=null;
  function setExternal(a){
    if(!a){ ext=null; return; }
    // a Grid (crate) → wrap as a flat container; an actor object → use as-is.
    if(a instanceof Grid){ ext={ equip:null, grid:a }; return; }
    ext={ equip:a.equip||null, grid:a.grid||null };
  }
  function externalActor(){ return ext; }
  // grids belonging to the external actor: a crate's flat grid, or a corpse's
  // equipped rig + backpack containers (in slot order, like the player's carried).
  function extGrids(){
    if(!ext) return [];
    if(ext.grid) return [ext.grid];
    if(!ext.equip) return [];
    const gs=[];
    if(ext.equip.rig) gs.push(ext.equip.rig.inst.container);
    if(ext.equip.backpack) gs.push(ext.equip.backpack.inst.container);
    return gs;
  }
  // carried grids during a raid = equipped rig + backpack containers (in order)
  function carried(){
    const e=S.profile.equip, gs=[];
    if(e.rig) gs.push(e.rig.inst.container);
    if(e.backpack) gs.push(e.backpack.inst.container);
    return gs;
  }
  function stash(){ return S.profile.stash; }

  // add loot during raid -> first carried grid with room. returns true if stored.
  function addLoot(item){
    for(const g of carried()){ if(g.add(item)===0){ Events.emit('inv:changed'); return true; } }
    Events.emit('inv:changed'); return false;
  }
  // locate an item by uid across player equip/stash/carried, then the external
  // actor: its equip slots (corpse paper-doll) + its grids (crate / corpse rig+pack).
  function locate(uid){
    for(const slot of EQUIP_SLOTS){ const it=S.profile.equip[slot]; if(it&&it.uid===uid) return {where:'equip', slot, item:it}; }
    if(ext&&ext.equip){ for(const slot of EQUIP_SLOTS){ const it=ext.equip[slot]; if(it&&it.uid===uid) return {where:'extequip', slot, item:it}; } }
    const grids=[{g:stash(),tag:'stash'}, ...carried().map(g=>({g,tag:'carried'}))];
    for(const g of extGrids()) grids.push({g,tag:'ext'});
    for(const {g,tag} of grids){ const it=g.find(uid); if(it) return {where:'grid', grid:g, tag, item:it}; }
    return null;
  }
  function removeFrom(loc){
    if(loc.where==='grid') loc.grid.remove(loc.item.uid);
    else if(loc.where==='equip') S.profile.equip[loc.slot]=null;
    else if(loc.where==='extequip' && ext&&ext.equip) ext.equip[loc.slot]=null;
  }
  // place an item into a grid at x,y,rot — merges onto a same-id stack if dropped on one
  function placeAt(item, grid, x, y, rot){
    if(item.def.stack>1 && x>=0 && y>=0 && x<grid.w && y<grid.h){
      const m=grid._map(); const cu=m[y*grid.w+x];
      if(cu){ const tgt=grid.find(cu); if(tgt&&tgt!==item&&tgt.def.id===item.def.id){ const take=Math.min(item.def.stack-tgt.qty, item.qty); if(take>0){ tgt.qty+=take; item.qty-=take; } if(item.qty<=0) return true; } }
    }
    if(grid.fits(item.def,x,y,rot,item.uid)){ item.x=x; item.y=y; item.rot=rot; if(!grid.items.includes(item)) grid.items.push(item); return true; }
    return false;
  }
  // put a detached item back where it came from (rollback when a move fails)
  function restore(loc, item){
    if(loc.where==='grid'){ if(!placeAt(item, loc.grid, item.x, item.y, item.rot)) loc.grid.add(item); }
    else if(loc.where==='equip'){ S.profile.equip[loc.slot]=item; }
    else if(loc.where==='extequip' && ext&&ext.equip){ ext.equip[loc.slot]=item; }
  }
  // drag/drop move: detach from wherever it is, place into target grid at cell; rollback on failure
  function move(uid, toGrid, x, y, rot){
    const loc=locate(uid); if(!loc) return false; const item=loc.item; const ox=item.x, oy=item.y, orot=item.rot;
    removeFrom(loc);
    if(placeAt(item, toGrid, x, y, rot)){ Events.emit('inv:changed'); return true; }
    item.x=ox; item.y=oy; item.rot=orot; restore(loc, item);
    Events.emit('inv:changed'); return false;
  }
  // move into best free spot of a grid (used by "take all" / shift-click)
  function quickTo(uid, toGrid){
    const loc=locate(uid); if(!loc) return false; const item=loc.item;
    removeFrom(loc);
    if(toGrid.add(item)===0){ Events.emit('inv:changed'); return true; }
    restore(loc, item);
    Events.emit('inv:changed'); return false;
  }
  function slotFor(def){
    if(def.type==='weapon') return null; // chosen primary/secondary by caller
    // gear pieces declare their target slot explicitly (def.slot); fall back to
    // a type→slot map for legacy defs that predate the gear system.
    if(def.slot && EQUIP_SLOTS.includes(def.slot)) return def.slot;
    return {armor:'armor', helmet:'helmet', clothing:'clothing', backpack:'backpack', rig:'rig'}[def.type]||null;
  }
  function equip(uid, weaponSlot){
    const loc=locate(uid); if(!loc) return false;
    const item=loc.item, def=item.def;
    let slot = def.type==='weapon' ? (weaponSlot||(S.profile.equip.primary?'secondary':'primary')) : slotFor(def);
    if(!slot) return false;
    removeFrom(loc);
    const prev=S.profile.equip[slot];
    S.profile.equip[slot]=item;
    if(prev){ // put old gear back where there's room (stash in hub, carried in raid)
      const dest = S.mode===MODE.RAID ? (carried()[0]||stash()) : stash();
      if(dest.add(prev)!==0) stash().add(prev);
    }
    Events.emit('inv:changed'); Events.emit('equip:changed'); return true;
  }
  function installAttachment(attUid){
    const loc=locate(attUid); if(!loc||loc.item.def.type!=='attachment') return false;
    const wItem=S.profile.equip[S.player.activeSlot] || S.profile.equip.primary;
    if(!wItem) return false;
    const wDef=DATA.weapons[wItem.def.weapon];
    const slot=loc.item.def.slot;
    if(!wDef.slots.includes(slot)) return false;
    // pop existing attachment back to a grid
    const existing=wItem.inst.attachments[slot];
    removeFrom(loc);
    wItem.inst.attachments[slot]=loc.item.def.id;
    if(existing){ const back=newItem(existing,1); (stash()).add(back); }
    Events.emit('inv:changed'); Events.emit('equip:changed'); return true;
  }
  function dropOrDestroy(uid){ const loc=locate(uid); if(loc){ removeFrom(loc); Events.emit('inv:changed'); return true; } return false; }
  function destForLoose(){ return S.mode===MODE.RAID ? (carried()[0]||stash()) : stash(); }
  // install a specific attachment onto a specific weapon's matching slot (weapon-mod screen)
  function installOn(weaponUid, attUid){
    const wl=locate(weaponUid); if(!wl||wl.item.def.type!=='weapon') return false;
    const al=locate(attUid); if(!al||al.item.def.type!=='attachment') return false;
    const wDef=DATA.weapons[wl.item.def.weapon]; const slot=al.item.def.slot;
    if(!wDef.slots.includes(slot)) return false;
    const existing=wl.item.inst.attachments[slot];
    removeFrom(al);
    wl.item.inst.attachments[slot]=al.item.def.id;
    if(existing){ const back=newItem(existing,1); if(destForLoose().add(back)!==0) stash().add(back); }
    Events.emit('inv:changed'); Events.emit('weapon:changed'); return true;
  }
  function removeAttachment(weaponUid, slot){
    const wl=locate(weaponUid); if(!wl||wl.item.def.type!=='weapon') return false;
    const id=wl.item.inst.attachments[slot]; if(!id) return false;
    delete wl.item.inst.attachments[slot];
    const back=newItem(id,1); if(destForLoose().add(back)!==0) stash().add(back);
    Events.emit('inv:changed'); Events.emit('weapon:changed'); return true;
  }
  function sellValue(item){ return Math.round((item.def.value||0)*0.6*(item.qty||1)); }

  // ----- gear stats (armor + clothing system) -----
  // Normalise one equipped piece's protective stats. New gear declares dr/ac/
  // dura/ergo directly; legacy vests/helmets only carry a numeric `armor` field,
  // so derive a flat dr from it (armor/120, matching the old mitigation curve).
  function gearStat(item){
    if(!item) return null;
    const d=item.def;
    let dr = (typeof d.dr==='number') ? d.dr : (d.armor ? d.armor/120 : 0);
    const inst=item.inst||{};
    // durability-lite: a worn piece protects less. dura lives on the instance so
    // wear persists with the item; seed it from def.maxDura on first read.
    if(typeof d.maxDura==='number'){
      if(typeof inst.dura!=='number') inst.dura=d.maxDura;
      const frac = d.maxDura>0 ? Math.max(0, inst.dura)/d.maxDura : 1;
      const f = DATA.gearMit.wornDrFactor;
      dr *= (f + (1-f)*frac);   // dr fades from full→wornDrFactor as dura→0
    }
    return { dr, ac:d.ac||0, ergo:d.ergo||0, dura:inst.dura, maxDura:d.maxDura, stealth:d.stealth||0 };
  }
  // Aggregate protective stats across the worn gear slots. Returns flat totals
  // used by Player (mitigation + move speed) and the UI doll readout.
  const GEAR_SLOTS=['helmet','armor','clothing'];
  function gearTotals(){
    const e=S.profile?S.profile.equip:{}; let dr=0, ergo=0, ac=0, stealth=0;
    for(const s of GEAR_SLOTS){ const g=gearStat(e[s]); if(!g) continue;
      dr += g.dr; ergo += g.ergo; ac = Math.max(ac, g.ac); stealth += g.stealth; }
    dr = Math.min(DATA.gearMit.drCap, dr);
    return { dr, ergo, ac, stealth };
  }
  // Apply hit wear to worn gear that has durability (called by Player on damage).
  // Splits the chip across pieces proportional to their dr contribution.
  function wearGear(rawDmg){
    const e=S.profile?S.profile.equip:{}; const pieces=[];
    let drSum=0;
    for(const s of GEAR_SLOTS){ const it=e[s]; if(it&&typeof it.def.maxDura==='number'){ const g=gearStat(it); if(g.dr>0){ pieces.push({it,dr:g.dr}); drSum+=g.dr; } } }
    if(!pieces.length||drSum<=0) return;
    const loss = rawDmg*DATA.gearMit.duraLossPerDmg;
    for(const p of pieces){ const it=p.it; it.inst.dura=Math.max(0, (typeof it.inst.dura==='number'?it.inst.dura:it.def.maxDura) - loss*(p.dr/drSum)); }
  }

  return { Grid, carried, stash, addLoot, locate, move, quickTo, moveTo:quickTo, placeAt, setExternal, externalActor, extGrids, equip, installAttachment, installOn, removeAttachment, dropOrDestroy, sellValue, newItem, slotFor, gearStat, gearTotals, wearGear };
})();
