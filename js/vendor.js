// vendor.js — SYS: Vendor. Buy (into stash) / sell (from stash). Prices derive
// from item value. This module also owns the R4 "vendor depth" layer:
//   • restock timer   — each stock line has a finite quantity that regenerates
//                        over real time (Date.now based, so it ticks even while
//                        you're out on a raid or after a reload).
//   • reputation tiers — selling builds standing; higher tiers buy cheaper and
//                        unlock deeper stock (more units, restock faster).
//   • buy-back tab     — recently sold items linger in a buy-back queue so you can
//                        re-purchase something you sold by mistake (at a premium).
// All of this is layered on the EXISTING vendor data (DATA.vendor / DATA.items) —
// no data.js changes. Vendor's own persistent slice (rep, stock clocks, buy-back)
// lives in its OWN localStorage key so save.js stays untouched.
import { DATA } from "./data.js";
import { S, Events } from "./state.js";
import { Inventory, newItem } from "./inventory.js";
import { UI } from "./ui.js";
import { Save } from "./save.js";

export const Vendor = (function(){
  // ---- tuning (kept here, not in data.js — this module owns the economy depth) --
  const TUNE = {
    // reputation tiers: reach `at` cumulative sold-credits to unlock. buyMult
    // scales buy prices (lower = cheaper); stockMult scales per-line max units;
    // restockMult scales how fast lines refill (higher = faster).
    tiers:[
      { name:'Stranger',  at:0,     buyMult:1.00, stockMult:1.0, restockMult:1.0 },
      { name:'Regular',   at:1500,  buyMult:0.95, stockMult:1.3, restockMult:1.2 },
      { name:'Trusted',   at:5000,  buyMult:0.90, stockMult:1.6, restockMult:1.5 },
      { name:'Insider',   at:14000, buyMult:0.85, stockMult:2.0, restockMult:1.8 },
      { name:'Kingpin',   at:35000, buyMult:0.78, stockMult:2.6, restockMult:2.2 },
    ],
    baseMarkup: 1.6,        // buy price = item value * baseMarkup (* tier buyMult)
    sellFactor: 0.6,        // matches Inventory.sellValue (kept in sync for display)
    restockSeconds: 90,     // seconds to regenerate ONE unit of a stock line (tier-scaled)
    buybackMarkup: 1.15,    // buy-back costs a touch more than the original buy price
    buybackMax: 12,         // most buy-back entries kept (FIFO)
    buybackTtlMs: 30*60*1000, // a sold item lingers in buy-back this long (30 min real time)
  };

  // ---- persistent slice (own key, so save.js is untouched) -------------------
  const KEY='lootnshoot.vendor.v1';
  // shape: { rep:Number, stock:{id:{qty,base,t}}, buyback:[{id,qty,price,uid,ts}] }
  let V = load();

  function load(){
    try{ const s=localStorage.getItem(KEY); if(s){ const o=JSON.parse(s); return normalize(o); } }catch(e){}
    return normalize(null);
  }
  function normalize(o){
    o=o||{}; o.rep=+o.rep||0; o.stock=o.stock||{}; o.buyback=Array.isArray(o.buyback)?o.buyback:[];
    return o;
  }
  function persist(){ try{ localStorage.setItem(KEY, JSON.stringify(V)); }catch(e){} }

  // ---- reputation ------------------------------------------------------------
  function tierIndex(){ let idx=0; for(let k=0;k<TUNE.tiers.length;k++){ if(V.rep>=TUNE.tiers[k].at) idx=k; } return idx; }
  function tier(){ return TUNE.tiers[tierIndex()]; }
  function nextTier(){ const i=tierIndex(); return i<TUNE.tiers.length-1?TUNE.tiers[i+1]:null; }
  // 0..1 progress toward the next tier (1 at the cap).
  function tierProgress(){ const t=tier(), n=nextTier(); if(!n) return 1; const span=n.at-t.at; return span>0?Math.max(0,Math.min(1,(V.rep-t.at)/span)):1; }
  function addRep(n){ if(n<=0) return; const before=tierIndex(); V.rep+=n; const after=tierIndex();
    if(after>before){ UI.toast(`Vendor standing: ${TUNE.tiers[after].name}`,'rare'); }
    persist(); }

  // ---- pricing ---------------------------------------------------------------
  // buy price reflects current reputation tier (cheaper as you climb).
  function price(id){ const d=DATA.items[id]; if(!d) return 0; return Math.max(1, Math.round(d.value*TUNE.baseMarkup*tier().buyMult)); }

  // ---- stock + restock -------------------------------------------------------
  // Per-line max units scale with the item's rarity (rarer = scarcer) and tier.
  function baseMaxFor(id){ const d=DATA.items[id]||{}; const r=d.rarity||1; return Math.max(1, Math.round((8 - r) )); }
  function maxFor(id){ return Math.max(1, Math.round(baseMaxFor(id)*tier().stockMult)); }
  function restockPeriod(){ return TUNE.restockSeconds*1000 / Math.max(0.1, tier().restockMult); }
  // Lazily reconcile a stock line against elapsed real time, regenerating whole
  // units toward the (tier-scaled) max. Called whenever the line is read/used.
  function lineFor(id){
    const now=Date.now(); const max=maxFor(id);
    let s=V.stock[id];
    if(!s){ s=V.stock[id]={ qty:max, t:now }; return s; }
    if(s.qty<max){
      const per=restockPeriod();
      const gained=Math.floor((now - (s.t||now))/per);
      if(gained>0){ s.qty=Math.min(max, s.qty+gained); s.t=(s.t||now)+gained*per; }
      // never let the clock drift far ahead of a full line
      if(s.qty>=max) s.t=now;
    } else { s.qty=max; s.t=now; }
    return s;
  }
  function stockOf(id){ return lineFor(id).qty; }
  // seconds until the next unit restocks for a line (0 if full), for the HUD.
  function restockIn(id){ const s=lineFor(id); if(s.qty>=maxFor(id)) return 0; const per=restockPeriod(); const elapsed=Date.now()-(s.t||Date.now()); return Math.max(0, Math.ceil((per-elapsed)/1000)); }

  // ---- buy -------------------------------------------------------------------
  function buy(id){
    const d=DATA.items[id]; if(!d){ return; }
    const p=price(id);
    if(S.profile.credits<p){ UI.toast('Not enough credits','neg'); return; }
    const line=lineFor(id);
    if(line.qty<=0){ UI.toast('Out of stock','neg'); return; }
    const it=newItem(id, d.stack>1?Math.min(d.stack,30):1);
    if(Inventory.stash().add(it)!==0){ UI.toast('Stash full','neg'); return; }
    S.profile.credits-=p;
    line.qty-=1; if(line.qty<maxFor(id)) line.t=line.t||Date.now();
    persist();
    UI.toast(`Bought ${it.def.name}`,'pos');
    Events.emit('progress:changed'); Events.emit('inv:changed'); Save.save();
  }

  // ---- sell ------------------------------------------------------------------
  function sell(uid){
    const loc=Inventory.locate(uid); if(!loc||loc.where!=='grid') return;
    const it=loc.item; const v=Inventory.sellValue(it);
    const sold={ id:it.def.id, qty:it.qty||1, name:it.def.name };
    Inventory.dropOrDestroy(uid);
    S.profile.credits+=v;
    addRep(v);                 // selling builds standing
    pushBuyback(sold);         // and queues the item for buy-back
    UI.toast(`Sold +${v}c`,'pos');
    Events.emit('progress:changed'); Save.save();
  }

  // sell EVERY sellable item currently in the stash, in one action. Snapshots the
  // uid list first (selling mutates the grid as it goes). Returns the count sold.
  function sellAll(){
    const uids=Inventory.stash().items.map(it=>it.uid);
    if(!uids.length){ UI.toast('Nothing to sell','neg'); return 0; }
    let total=0, n=0;
    for(const uid of uids){
      const loc=Inventory.locate(uid); if(!loc||loc.where!=='grid') continue;
      const it=loc.item; const v=Inventory.sellValue(it);
      const sold={ id:it.def.id, qty:it.qty||1, name:it.def.name };
      Inventory.dropOrDestroy(uid);
      S.profile.credits+=v; addRep(v); pushBuyback(sold);
      total+=v; n++;
    }
    if(n){ UI.toast(`Sold ${n} item${n>1?'s':''} +${total}c`,'pos'); Events.emit('progress:changed'); Events.emit('inv:changed'); Save.save(); }
    return n;
  }

  // ---- buy-back --------------------------------------------------------------
  let _bbId=1;
  function pushBuyback(sold){
    const def=DATA.items[sold.id]; if(!def) return;
    const qty=Math.max(1, sold.qty||1);
    // price the WHOLE lump you sold (per-unit buy price × qty, at a small premium),
    // snapped to the tier at sale time so a later tier bump doesn't re-price it.
    const unit=Math.max(1, Math.round(def.value*TUNE.baseMarkup*tier().buyMult*TUNE.buybackMarkup));
    V.buyback.unshift({ id:sold.id, qty, name:sold.name, price:unit*qty, uid:'bb'+(_bbId++), ts:Date.now() });
    if(V.buyback.length>TUNE.buybackMax) V.buyback.length=TUNE.buybackMax;
    persist();
  }
  function buybackList(){
    const now=Date.now();
    V.buyback=V.buyback.filter(b=>now-b.ts < TUNE.buybackTtlMs);   // expire stale entries
    return V.buyback;
  }
  function buyback(bbUid){
    const i=V.buyback.findIndex(b=>b.uid===bbUid); if(i<0) return;
    const b=V.buyback[i];
    const total=b.price; // total cost for the whole sold lump (snapped at sale time)
    if(S.profile.credits<total){ UI.toast('Not enough credits','neg'); return; }
    const it=newItem(b.id, b.qty);
    if(Inventory.stash().add(it)!==0){ UI.toast('Stash full','neg'); return; }
    S.profile.credits-=total;
    V.buyback.splice(i,1); persist();
    UI.toast(`Bought back ${b.name}`,'pos');
    Events.emit('progress:changed'); Events.emit('inv:changed'); Save.save();
  }

  // ---- readouts for the UI ---------------------------------------------------
  function repInfo(){
    const t=tier(), n=nextTier();
    return { name:t.name, rep:Math.round(V.rep), buyMult:t.buyMult,
             next:n?n.name:null, toNext:n?Math.max(0, n.at-V.rep):0, progress:tierProgress() };
  }
  function stockInfo(id){ return { qty:stockOf(id), max:maxFor(id), restockIn:restockIn(id) }; }

  return { price, buy, sell, sellAll, buyback, buybackList,
           stockOf, stockInfo, restockIn, maxFor,
           repInfo, tier, TUNE };
})();
