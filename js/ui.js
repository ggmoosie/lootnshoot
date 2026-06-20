// ui.js — SYS: UI. HUD + all menu screens. Screens are generated from state so
// adding a field is a one-line change. Spatial drag/drop inventory, gunsmith,
// vendor, crafting, skills, deploy/extract, result/pause, settings.
import { DATA } from "./data.js";
import { S, MODE, EQUIP_SLOTS, Events } from "./state.js";
import { GFX } from "./gfx.js";
import { iconFor, keyName, clamp } from "./util.js";
import { Save } from "./save.js";
import { Progression } from "./progression.js";
import { Input } from "./input.js";
import { World } from "./world.js";
import { Inventory } from "./inventory.js";
import { Weapons } from "./weapons.js";
import { Vendor } from "./vendor.js";
import { Crafting } from "./crafting.js";
import { Enemies } from "./enemies.js";
import { Allies } from "./allies.js";
import { Player } from "./player.js";
import { Status } from "./status.js";
import { Loot } from "./loot.js";
import { Audio } from "./audio.js";
import { Raid } from "./raid.js";
import { createPreview } from "./preview.js";

export const UI = (function(){
  const $=id=>document.getElementById(id);
  let selUid=null;

  // ---------- HUD ----------
  function setObjective(t,x,z){ $('objT').textContent=t; $('objX').textContent=x; $('zone').textContent=z; }
  function prompt(html){ const el=$('prompt'); if(!html){el.style.opacity=0;return;} el.innerHTML=html; el.style.opacity=1; }
  function hit(head, kill){ const h=$('hit'); h.className=''; if(kill) h.classList.add('kill'); h.style.opacity=1; h.style.filter=head?'drop-shadow(0 0 3px #ff3b30)':'none'; if(kill) Audio.play('ui'); setTimeout(()=>{h.style.opacity=0;h.className='';},110); }
  let dmgT=null;
  function dmgDir(rel){ const el=$('dmgdir'); if(!el) return; el.style.transform=`translate(-50%,-50%) rotate(${rel*180/Math.PI}deg)`; el.style.opacity='1'; clearTimeout(dmgT); dmgT=setTimeout(()=>{ el.style.opacity='0'; },90); }
  let bannerT=null;
  function banner(title, sub){ const b=$('banner'); if(!b) return; b.querySelector('.bt').textContent=title||''; b.querySelector('.bs').textContent=sub||''; b.classList.add('show'); clearTimeout(bannerT); bannerT=setTimeout(()=>b.classList.remove('show'), 2600); }
  function flashReload(t){ $('rld').textContent=t; }
  function toast(text,kind='neu'){ const f=$('feed'); const el=document.createElement('div'); el.className='toast'; el.innerHTML=`<span class="${kind}">▸ ${text}</span>`; f.appendChild(el); setTimeout(()=>el.classList.add('f'),2600); setTimeout(()=>el.remove(),3100); }
  function refreshHUD(){
    const pl=S.player, pr=S.profile;
    const hp=Math.max(0,Math.round(pl.health)); $('hpF').style.width=(hp/pl.maxHealth*100)+'%'; $('hpT').textContent=`${hp}/${Math.round(pl.maxHealth)}`;
    $('stmF').style.width=(pl.stamina/pl.maxStamina*100)+'%';
    const w=Weapons.activeItem(); const st=w?Weapons.stats(w):null;
    $('amN').innerHTML = w?`<span class="mg">${w.inst.ammo}</span> <span class="rs">/ ∞</span>`:'<span class="mg">—</span>';
    $('amN').classList.toggle('low', !!(w&&st&&w.inst.ammo<=Math.ceil(st.mag*0.25)));
    $('wpn').textContent = w?w.def.name:'UNARMED';
    $('fmode').textContent = (S.mode===MODE.RAID&&w)?Weapons.modeOf(w).toUpperCase():'';
    $('stance').textContent = Input.crouch?'CROUCH':'STAND';
    document.querySelectorAll('.wslot').forEach(s=>s.classList.toggle('on', s.dataset.s===pl.activeSlot));
    $('cr').textContent=pr.credits; $('lvl').textContent=`LVL ${pr.level}`;
    $('nade').textContent = S.mode===MODE.RAID? `Grenades: ${nadeCount()}`:'';
  }
  function reserveOf(st){ if(!st) return 0; const grids=S.mode===MODE.RAID?Inventory.carried():[Inventory.stash()]; let n=0; for(const g of grids) for(const t of g.items) if(t.def.type==='ammo'&&t.def.cal===st.cal) n+=t.qty; return n; }
  function nadeCount(){ let n=0; for(const g of Inventory.carried()) n+=g.count('nade_frag'); return n; }

  // ---------- overlay helpers ----------
  const OVS=['ovStart','ovInv','ovVendor','ovCraft','ovSkill','ovExtract','ovResult','ovPause','ovSettings','ovMod'];
  function hideAll(){ OVS.forEach(o=>$(o).classList.remove('show')); }
  function closeMenus(){ hideAll(); hideCtx(); loot=null; Inventory.setExternal(null); disposeGunPreview();
    if(S.mode===MODE.MENU){ const pm=prevMode; S.setMode(pm);
      if(pm===MODE.PAUSE){ $('ovPause').classList.add('show'); }
      else if(pm===MODE.BOOT){ $('ovStart').classList.add('show'); }
      else if(pm===MODE.RAID||pm===MODE.HUB){ Input.relock(); } } }
  let prevMode=MODE.HUB;
  function openOverlay(id){ prevMode = S.mode===MODE.MENU?prevMode:S.mode; S.setMode(MODE.MENU); document.exitPointerLock(); hideAll(); $(id).classList.add('show'); }

  function openStation(kind){
    if(kind==='inventory') return toggleInventory();
    if(kind==='vendor') return openVendor();
    if(kind==='craft') return openCraft();
    if(kind==='skills') return openSkills();
    if(kind==='deploy') return openDeploy();
    if(kind==='settings') return openSettings();
  }

  // ---------- START ----------
  function renderStart(){
    const has=Save.load();
    $('startCard').innerHTML=`
      <div class="eb">Tactical Extraction // v0.2</div><h1>LootNShoot</h1>
      <p class="sub">Gear up in the safehouse, ride the train out to a hostile stop, clear it, grab loot, then choose to extract or push the train deeper for bigger rewards and risk. Die in the field and your pack & rig are gone.</p>
      <div class="hint"><b>WASD</b> move · <b>SPACE</b> jump · <b>C</b> crouch · <b>L-CLICK</b> fire · <b>R-CLICK</b> ADS · <b>R</b> reload · <b>F</b> pick up · <b>E</b> loot/interact · <b>TAB</b> inventory · rebind all in Settings</div>
      <div class="btn" id="bGo"><span class="k">▶</span> ${has?'Continue':'Enter Safehouse'}</div>
      <div class="btn" id="bSet"><span class="k">⚙</span> Settings</div>
      ${has?'<div class="btn" id="bNew"><span class="k">＋</span> New Game (wipe save)</div>':''}`;
    $('bGo').onclick=()=>{ S.profile = has||Save.newProfile(); Progression.recompute(); Input.applySettings(); hideAll(); World.buildHub(); };
    $('bSet').onclick=()=>{ if(!S.profile){ S.profile = has||Save.newProfile(); Progression.recompute(); } openSettings(); };
    if(has) $('bNew').onclick=()=>{ Save.wipe(); S.profile=Save.newProfile(); Progression.recompute(); Input.applySettings(); hideAll(); World.buildHub(); };
  }

  // ---------- INVENTORY (Tarkov-style spatial drag/drop) ----------
  const CELL=44;
  let loot=null;          // external container being looted (corpse/crate)
  let gridMap={};         // gridkey -> Grid (rebuilt each render)
  let drag=null;          // { uid, rot, def }

  function toggleInventory(){ if($('ovInv').classList.contains('show')) return closeMenus(); loot=null; Inventory.setExternal(null); openOverlay('ovInv'); renderInventory(); }
  function openLoot(corpse){ loot=corpse; Inventory.setExternal(corpse.grid); openOverlay('ovInv'); renderInventory(); }

  function gridHTML(grid,label,gk){
    let h=`<div class="col"><div class="colT"><span>${label}</span><span class="cap">${grid.w}×${grid.h}</span></div><div class="gridscroll"><div class="grid" data-gk="${gk}" style="width:${grid.w*CELL}px;height:${grid.h*CELL}px">`;
    for(let y=0;y<grid.h;y++)for(let x=0;x<grid.w;x++) h+=`<div class="cell" style="left:${x*CELL}px;top:${y*CELL}px;width:${CELL}px;height:${CELL}px"></div>`;
    for(const it of grid.items){ const w=(it.rot?it.def.size[1]:it.def.size[0])*CELL, hh=(it.rot?it.def.size[0]:it.def.size[1])*CELL; const small=it.def.size[0]===1&&it.def.size[1]===1;
      h+=`<div class="gi r-${it.def.rarity||1}${small?' small':''}" data-uid="${it.uid}" style="left:${it.x*CELL}px;top:${it.y*CELL}px;width:${w}px;height:${hh}px"><span class="ic">${iconFor(it.def)}</span><span class="nm">${it.def.name}</span>${it.qty>1?`<span class="q">${it.qty}</span>`:''}</div>`; }
    h+=`</div></div></div>`; return h;
  }
  function slotHTML(s,it){ const meta={primary:['Primary','🔫'],secondary:['Sidearm','🔫'],helmet:['Helmet','⛑️'],armor:['Armor','🛡️'],rig:['Rig','🦺'],backpack:['Pack','🎒']}[s];
    const wide = (s==='primary'||s==='secondary');
    return `<div class="eslot ${wide?'wpn ':''}${it?'full r-'+(it.def.rarity||1):''}" style="grid-area:${s}" data-slot="${s}" ${it?`data-uid="${it.uid}"`:''}>
      <span class="ei">${it?iconFor(it.def):meta[1]}</span><span class="sn">${it&&wide?it.def.name:meta[0]}</span>${it&&it.qty>1?`<span class="q">${it.qty}</span>`:''}</div>`; }

  function renderInventory(){
    gridMap={}; const e=S.profile.equip;
    const armorVal=(e.armor?e.armor.def.armor:0)+(e.helmet?Math.round(e.helmet.def.armor*0.4):0);
    const eq=`<div class="col gearcol"><div class="colT"><span>Loadout</span></div>
      <div class="doll">${EQUIP_SLOTS.map(s=>slotHTML(s,e[s])).join('')}<div class="dollfig" aria-hidden="true"><span>🧍</span></div></div>
      <div class="gearstats"><div><span class="gl">HEALTH</span><span class="gv">${Math.round(S.player.maxHealth)}</span></div><div><span class="gl">ARMOR</span><span class="gv">${armorVal}</span></div><div><span class="gl">WEIGHT</span><span class="gv">—</span></div></div>
      <div class="mini" style="margin-top:6px">Drag to equip · <b style="color:var(--amber)">R</b> rotate · <b style="color:var(--amber)">shift</b>+click quick-move · right-click menu</div></div>`;
    let cols='';
    if(e.rig){ gridMap.rig=e.rig.inst.container; cols+=gridHTML(gridMap.rig,'Rig','rig'); }
    if(e.backpack){ gridMap.backpack=e.backpack.inst.container; cols+=gridHTML(gridMap.backpack,'Backpack','backpack'); }
    if(S.mode===MODE.HUB){ gridMap.stash=Inventory.stash(); cols+=gridHTML(gridMap.stash,'Stash','stash'); }
    let lootCol='';
    if(loot){ gridMap.ext=loot.grid; lootCol=gridHTML(loot.grid,(loot.label||'Loot').toUpperCase(),'ext'); }
    $('invCard').innerHTML=`<div class="eb">${loot?'Body // Loot':'Loadout // Inventory'}</div><h1>${loot?'Loot':'Gear'}</h1>
      <div class="invwrap">${eq}${cols}${lootCol}</div>
      <div style="margin-top:16px">
        <span class="btn" id="invClose" style="width:auto;display:inline-block;margin:0"><span class="k">ESC</span> Close</span>
        ${loot?'<span class="btn" id="invTakeAll" style="width:auto;display:inline-block;margin:0 0 0 8px"><span class="k">⇪</span> Take all</span>':''}
      </div>`;
    $('invClose').onclick=closeMenus;
    if(loot) $('invTakeAll').onclick=takeAll;
    $('invCard').querySelectorAll('.grid[data-gk]').forEach(el=>{ el.__grid=gridMap[el.dataset.gk]; });
    $('invCard').querySelectorAll('.gi').forEach(el=>{
      el.addEventListener('pointerdown', startDrag);
      el.addEventListener('contextmenu', ev=>{ ev.preventDefault(); showCtx(el.dataset.uid*1, ev.clientX, ev.clientY); });
      el.addEventListener('mouseenter', ev=>showTip(el.dataset.uid*1, ev.clientX, ev.clientY));
      el.addEventListener('mousemove', ev=>moveTip(ev.clientX, ev.clientY));
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('dblclick', ev=>{ ev.preventDefault(); hideTip(); smartUse(el.dataset.uid*1); });
    });
    $('invCard').querySelectorAll('.eslot').forEach(el=>{
      if(el.dataset.uid){ el.addEventListener('pointerdown', startDrag);
        el.addEventListener('contextmenu', ev=>{ ev.preventDefault(); showCtx(el.dataset.uid*1, ev.clientX, ev.clientY); }); }
    });
    hideCtx();
    if(loot && loot.cmesh) Loot.reflectCorpse(loot);
  }
  function takeAll(){ if(!loot) return; for(const it of [...loot.grid.items]) Inventory.quickTo(it.uid, Inventory.carried()[0]||Inventory.stash()); renderInventory(); refreshHUD(); }

  // ----- drag/drop -----
  function startDrag(ev){
    if(ev.button!==undefined && ev.button!==0) return;
    const uid=this.dataset.uid*1; const loc=Inventory.locate(uid); if(!loc) return;
    if(ev.shiftKey || ev.ctrlKey || ev.metaKey){ ev.preventDefault(); quickMove(uid); return; }
    ev.preventDefault(); hideCtx(); hideTip();
    drag={ uid, rot:loc.item.rot, def:loc.item.def };
    const g=$('dragGhost'); sizeGhost(); g.innerHTML=`<span>${iconFor(loc.item.def)}</span>`; g.style.display='flex';
    moveGhost(ev.clientX,ev.clientY); this.classList.add('dragging');
  }
  // shift+click: send item to the logical "other" inventory
  function quickMove(uid){ const loc=Inventory.locate(uid); if(!loc) return; let dest=null;
    if(loot){ dest = loc.tag==='ext' ? (Inventory.carried()[0]||Inventory.stash()) : loot.grid; }
    else if(S.mode===MODE.HUB){ dest = loc.tag==='stash' ? (Inventory.carried()[0]||Inventory.stash()) : Inventory.stash(); }
    else { const cs=Inventory.carried(); dest = (loc.tag==='carried' && cs[1]) ? cs[1] : cs[0]; }
    if(dest && Inventory.quickTo(uid,dest)){ Audio.play('ui'); renderInventory(); refreshHUD(); } }
  // double-click: smart use/equip
  function smartUse(uid){ const loc=Inventory.locate(uid); if(!loc) return; const def=loc.item.def;
    if(def.type==='weapon') Inventory.equip(uid,'primary');
    else if(['armor','helmet','rig','backpack'].includes(def.type)) Inventory.equip(uid);
    else if(def.type==='med'){ Player.heal(def.heal); if(def.cure)Status.clear('bleed'); Inventory.dropOrDestroy(uid); Audio.play('ui'); }
    else if(def.type==='attachment') Inventory.installAttachment(uid);
    else if(loot) quickMove(uid);
    renderInventory(); refreshHUD(); }
  function sizeGhost(){ if(!drag) return; const w=(drag.rot?drag.def.size[1]:drag.def.size[0])*CELL, h=(drag.rot?drag.def.size[0]:drag.def.size[1])*CELL; const g=$('dragGhost'); g.style.width=w+'px'; g.style.height=h+'px'; }
  function moveGhost(x,y){ const g=$('dragGhost'); g.style.left=(x-g.offsetWidth/2)+'px'; g.style.top=(y-g.offsetHeight/2)+'px'; }
  function gridUnder(x,y){ let el=document.elementFromPoint(x,y); while(el && !(el.classList&&el.classList.contains('grid'))) el=el.parentElement; return el; }
  function slotUnder(x,y){ let el=document.elementFromPoint(x,y); while(el && !(el.dataset&&el.dataset.slot)) el=el.parentElement; return el; }
  function modslotUnder(x,y){ let el=document.elementFromPoint(x,y); while(el && !(el.dataset&&el.dataset.modslot)) el=el.parentElement; return el; }
  function clearHi(){ document.querySelectorAll('.grid.drop-ok,.grid.drop-bad,.eslot.drop-ok,.mtile.drop-ok').forEach(el=>el.classList.remove('drop-ok','drop-bad')); }
  function highlight(x,y){ clearHi(); if(!drag) return;
    // weapon-mod slot targets take priority while the gunsmith is open
    if(modUid!=null && drag.def.type==='attachment'){ const ms=modslotUnder(x,y); if(ms){ ms.classList.add(ms.dataset.modslot===drag.def.slot?'drop-ok':'drop-bad'); return; } }
    const gel=gridUnder(x,y);
    if(gel&&gel.__grid){ const r=gel.getBoundingClientRect(); const w=drag.rot?drag.def.size[1]:drag.def.size[0], h=drag.rot?drag.def.size[0]:drag.def.size[1];
      const gx=clamp(Math.floor((x-r.left)/CELL)-Math.floor(w/2),0,gel.__grid.w-w), gy=clamp(Math.floor((y-r.top)/CELL)-Math.floor(h/2),0,gel.__grid.h-h);
      gel.classList.add(gel.__grid.fits(drag.def,gx,gy,drag.rot,drag.uid)?'drop-ok':'drop-bad'); }
    const sel=slotUnder(x,y); if(sel) sel.classList.add('drop-ok'); }
  function drop(d,x,y){
    // gunsmith: drop an attachment onto its matching slot to install
    if(modUid!=null && d.def.type==='attachment'){ const ms=modslotUnder(x,y);
      if(ms){ if(ms.dataset.modslot===d.def.slot){ Inventory.installOn(modUid, d.uid); renderMod(); refreshHUD(); } return; } }
    const slotEl=slotUnder(x,y);
    if(slotEl){ const slot=slotEl.dataset.slot, def=d.def;
      if(def.type==='weapon'){ if(slot==='primary'||slot==='secondary') Inventory.equip(d.uid,slot); }
      else { const tgt={armor:'armor',helmet:'helmet',rig:'rig',backpack:'backpack'}[def.type]; if(tgt===slot) Inventory.equip(d.uid); }
      renderInventory(); refreshHUD(); return;
    }
    const gel=gridUnder(x,y);
    if(gel&&gel.__grid){ const grid=gel.__grid; const r=gel.getBoundingClientRect();
      const w=d.rot?d.def.size[1]:d.def.size[0], h=d.rot?d.def.size[0]:d.def.size[1];
      const px=clamp(Math.floor((x-r.left)/CELL)-Math.floor(w/2),0,grid.w-w), py=clamp(Math.floor((y-r.top)/CELL)-Math.floor(h/2),0,grid.h-h);
      Inventory.move(d.uid, grid, px, py, d.rot); renderInventory(); refreshHUD(); }
  }
  addEventListener('pointermove', ev=>{ if(!drag) return; moveGhost(ev.clientX,ev.clientY); highlight(ev.clientX,ev.clientY); });
  addEventListener('keydown', ev=>{ if(drag && ev.code==='KeyR'){ ev.preventDefault(); drag.rot=drag.rot?0:1; sizeGhost(); } });
  addEventListener('pointerup', ev=>{ if(!drag) return; const d=drag; drag=null; $('dragGhost').style.display='none';
    document.querySelectorAll('.gi.dragging').forEach(el=>el.classList.remove('dragging')); clearHi(); drop(d, ev.clientX, ev.clientY); });

  // ----- right-click context menu -----
  function showCtx(uid,x,y){ const loc=Inventory.locate(uid); if(!loc) return; const it=loc.item, def=it.def; const acts=[];
    if(def.type==='weapon'){ acts.push(['Equip Primary',()=>Inventory.equip(uid,'primary')]); acts.push(['Equip Secondary',()=>Inventory.equip(uid,'secondary')]); acts.push(['Modify weapon',()=>openMod(uid)]); }
    else if(['armor','helmet','rig','backpack'].includes(def.type)) acts.push(['Equip',()=>Inventory.equip(uid)]);
    else if(def.type==='attachment') acts.push(['Install on weapon',()=>Inventory.installAttachment(uid)]);
    else if(def.type==='med'||def.type==='food') acts.push(['Use',()=>{ Player.heal(def.heal); if(def.cure)Status.clear('bleed'); Inventory.dropOrDestroy(uid); }]);
    else if(def.type==='deployable') acts.push(['Deploy',()=>Allies.deploy()]);
    if(loot && loc.tag==='ext') acts.push(['Take',()=>Inventory.quickTo(uid, Inventory.carried()[0]||Inventory.stash())]);
    else if(loot) acts.push(['→ Body',()=>Inventory.quickTo(uid, loot.grid)]);
    if(S.mode===MODE.HUB){ if(loc.tag!=='stash') acts.push(['→ Stash',()=>Inventory.quickTo(uid,Inventory.stash())]); else { const c=Inventory.carried()[0]; if(c) acts.push(['→ Carry',()=>Inventory.quickTo(uid,c)]); } acts.push(['Sell '+Inventory.sellValue(it)+'c',()=>Vendor.sell(uid)]); }
    acts.push(['Discard',()=>Inventory.dropOrDestroy(uid)]);
    const ctx=$('ctx'); ctx.innerHTML=`<div class="ci t">${def.name}</div>`+acts.map((a,i)=>`<div class="ci" data-i="${i}">${a[0]}</div>`).join('');
    ctx.style.left=Math.min(x,innerWidth-170)+'px'; ctx.style.top=Math.min(y,innerHeight-280)+'px'; ctx.style.display='block';
    ctx.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>{ acts[b.dataset.i*1][1](); hideCtx(); renderInventory(); refreshHUD(); });
  }
  function hideCtx(){ const c=$('ctx'); if(c) c.style.display='none'; }
  addEventListener('pointerdown', ev=>{ const c=$('ctx'); if(c && c.style.display==='block' && !c.contains(ev.target)) hideCtx(); });

  // ----- hover tooltip -----
  function statLines(def){
    const L=[]; if(def.type==='weapon'){ const w=DATA.weapons[def.weapon]; L.push(['Damage',w.damage],['RPM',w.rpm],['Mag',w.mag],['Modes',(w.modes||['auto']).join('/')]); }
    else if(def.type==='ammo') L.push(['Caliber',def.cal]);
    else if(def.type==='armor'||def.type==='helmet') L.push(['Armor',def.armor]);
    else if(def.type==='med'){ L.push(['Heal',def.heal]); if(def.cure) L.push(['Cures',def.cure]); }
    else if(def.type==='throwable') L.push(['Damage',def.dmg],['Radius',def.radius+'m']);
    else if(def.type==='backpack'||def.type==='rig') L.push(['Grid',def.grid[0]+'×'+def.grid[1]]);
    L.push(['Size',def.size[0]+'×'+def.size[1]],['Value',def.value+'c']); return L;
  }
  function showTip(uid,x,y){ if(drag) return; const loc=Inventory.locate(uid); if(!loc) return; const def=loc.item.def;
    const t=$('tip'); t.innerHTML=`<div class="tn">${def.name}</div><div class="tt">${def.type}</div>`+statLines(def).map(s=>`<div class="ts"><span>${s[0]}</span><b>${s[1]}</b></div>`).join('');
    t.style.left=Math.min(x+14,innerWidth-210)+'px'; t.style.top=Math.min(y+14,innerHeight-150)+'px'; t.style.display='block'; }
  function moveTip(x,y){ const t=$('tip'); if(t.style.display==='block'){ t.style.left=Math.min(x+14,innerWidth-210)+'px'; t.style.top=Math.min(y+14,innerHeight-150)+'px'; } }
  function hideTip(){ $('tip').style.display='none'; }

  // ----- weapon modding screen (live 3D gunsmith) -----
  // The schematic SVG was replaced by a LIVE 3D render of the configured weapon
  // (M1 preview renderer). The per-slot callout cards/dropdowns are unchanged —
  // only the visual swapped. The canvas + its WebGLRenderer are created ONCE per
  // open and kept across re-renders (renderMod rebuilds #modCard's innerHTML on
  // every attachment change, so we re-parent the persistent canvas back in and
  // just rebuild the gun model — no per-toggle WebGL context churn). Disposed in
  // closeMenus to leave no leaked renderer/RAF.
  let modUid=null, openSlot=null, gunPrev=null, gunCanvas=null;
  function openMod(weaponUid){ disposeGunPreview(); modUid=weaponUid; openSlot=null; openOverlay('ovMod'); renderMod(); }
  function disposeGunPreview(){
    if(gunPrev){ gunPrev.dispose(); gunPrev=null; }
    if(gunCanvas && gunCanvas.parentNode) gunCanvas.parentNode.removeChild(gunCanvas);
    gunCanvas=null;
  }
  // (re)build the 3D model for the current weapon config and frame it
  function refreshGunModel(){
    const loc=Inventory.locate(modUid); if(!loc||!gunPrev) return;
    gunPrev.setModel(Weapons.buildPreviewModel(loc.item));
  }
  function renderMod(){
    const loc=Inventory.locate(modUid); if(!loc||loc.item.def.type!=='weapon'){ closeMenus(); return; }
    const it=loc.item, wDef=DATA.weapons[it.def.weapon], st=Weapons.stats(it), base=DATA.weapons[it.def.weapon];
    const slotIcon={optic:'🔭',muzzle:'🧪',tactical:'🔦'};
    // card = where the callout sits over the 3D stage (percent of the stage box)
    const layout={ optic:{card:[50,8]}, muzzle:{card:[17,51]}, tactical:{card:[63,52]} };
    // available parts per slot from inventory (carried + stash)
    const avail={}; wDef.slots.forEach(s=>avail[s]=[]);
    for(const g of [...Inventory.carried(), Inventory.stash()]) if(g) for(const t of g.items) if(t.def.type==='attachment'&&avail[t.def.slot]) avail[t.def.slot].push(t);
    // HTML callout cards with dropdowns
    let cards='';
    for(const sl of wDef.slots){ const L=layout[sl]; if(!L) continue;
      const cur=it.inst.attachments[sl], curDef=cur?DATA.items[cur]:null; const open=openSlot===sl;
      const opts = (cur?`<div class="bpopt rem" data-rem="${sl}"><span class="bpic">✕</span><span>Remove</span></div>`:'')
        + ((avail[sl]||[]).map(a=>`<div class="bpopt ${cur===a.def.id?'sel':''}" data-ins="${a.uid}"><span class="bpic">${iconFor(a.def)}</span><span>${a.def.name}</span></div>`).join('')
           || (cur?'':'<div class="bpopt none">No parts in your kit</div>'));
      cards+=`<div class="bpcard ${cur?'filled':''} ${open?'open':''}" style="left:${L.card[0]}%;top:${(L.card[1]/60*100).toFixed(2)}%">
        <div class="bphd" data-toggle="${sl}"><span class="bpic">${cur?iconFor(curDef):slotIcon[sl]}</span>
          <span class="bptxt"><span class="bpsl">${sl}</span><span class="bpnm">${cur?curDef.name:'— empty'}</span></span><span class="bpcar">▾</span></div>
        ${open?`<div class="bpdrop">${opts}</div>`:''}</div>`;
    }
    const rows=[['Damage',st.damage,base.damage,1],['RPM',st.rpm,base.rpm,1],['Recoil',st.recoil,base.recoil,-1],['Spread',st.spread,base.spread,-1],['ADS',st.adsTime,base.adsTime,-1],['Zoom',st.zoom,base.zoom,1]];
    const statHTML=rows.map(r=>{ const cur=r[1], bs=r[2], better=r[3]; let cls=''; if(Math.abs(cur-bs)>1e-6) cls=((cur>bs)===(better>0))?'up':'dn'; const fmt=v=>(Math.round(v*1000)/1000); return `<div class="bpstat"><span class="sl">${r[0]}</span><span class="sv ${cls}">${fmt(cur)}</span></div>`; }).join('');
    $('modCard').innerHTML=`<div class="eb">Gunsmith // Live Render</div><div class="shophead"><h1 style="margin:0">${it.def.name}</h1><div class="creditpill">${Object.keys(it.inst.attachments||{}).length}/${wDef.slots.length} slots</div></div>
      <div class="bpstage" id="bpstage">${cards}</div>
      <div class="bpstats">${statHTML}</div>
      <div class="btn" id="modClose" style="margin-top:8px;width:auto;display:inline-block"><span class="k">ESC</span> Done</div>`;
    // create the persistent 3D canvas + preview once; on later re-renders just
    // re-attach the existing canvas (innerHTML above wiped the stage) so the
    // WebGL context survives, then rebuild the model to reflect the new config.
    const stage=$('bpstage');
    if(!gunCanvas){
      gunCanvas=document.createElement('canvas'); gunCanvas.className='gunsmith-3d';
      stage.insertBefore(gunCanvas, stage.firstChild);
      gunPrev=createPreview(gunCanvas, { autoRotate:true });
      gunPrev.start();
    } else {
      stage.insertBefore(gunCanvas, stage.firstChild);
      gunPrev.resize();
    }
    refreshGunModel();
    $('modClose').onclick=closeMenus;
    $('bpstage').addEventListener('pointerdown', ev=>{ if(!ev.target.closest('.bpcard')){ openSlot=null; renderMod(); } });
    $('modCard').querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>{ openSlot=openSlot===b.dataset.toggle?null:b.dataset.toggle; renderMod(); });
    $('modCard').querySelectorAll('[data-ins]').forEach(b=>b.onclick=()=>{ Inventory.installOn(modUid,b.dataset.ins*1); openSlot=null; renderMod(); refreshHUD(); });
    $('modCard').querySelectorAll('[data-rem]').forEach(b=>b.onclick=()=>{ Inventory.removeAttachment(modUid,b.dataset.rem); openSlot=null; renderMod(); refreshHUD(); });
  }

  // ---------- SETTINGS ----------
  function openSettings(){ openOverlay('ovSettings'); renderSettings(); }
  function renderSettings(){
    const s=S.profile.settings, b=s.binds;
    const kb=Object.keys(DATA.bindLabels).map(a=>`<div class="kbind"><span>${DATA.bindLabels[a]}</span><span class="key" data-bind="${a}">${keyName(b[a])}</span></div>`).join('');
    $('settingsCard').innerHTML=`<div class="eb">System // Settings</div><h1>Settings</h1>
      <div class="set"><span class="sl">Mouse sensitivity</span><span><input type="range" id="setSens" min="0.3" max="2.5" step="0.05" value="${s.sens}"> <span class="sv" id="setSensV">${s.sens.toFixed(2)}×</span></span></div>
      <div class="set"><span class="sl">Field of view</span><span><input type="range" id="setFov" min="60" max="100" step="1" value="${s.fov}"> <span class="sv" id="setFovV">${s.fov}°</span></span></div>
      <div class="set"><span class="sl">Invert Y axis</span><span class="btn" id="setInv" style="width:auto;margin:0;padding:6px 14px">${s.invertY?'ON':'OFF'}</span></div>
      <div class="colT" style="margin-top:16px"><span>Keybinds</span><span class="cap">click a key, then press</span></div>${kb}
      <div class="set"><span class="sl">Mouse <b style="color:var(--amber)">L</b> Fire · <b style="color:var(--amber)">R</b> ADS</span><span></span></div>
      <div style="margin-top:12px">
        <span class="btn" id="setReset" style="width:auto;display:inline-block;margin:0"><span class="k">↺</span> Reset binds</span>
        <span class="btn" id="setClose" style="width:auto;display:inline-block;margin:0 0 0 8px"><span class="k">ESC</span> Close</span>
      </div>`;
    const sens=$('setSens'), fov=$('setFov');
    sens.oninput=()=>{ s.sens=parseFloat(sens.value); $('setSensV').textContent=s.sens.toFixed(2)+'×'; Save.save(); };
    fov.oninput=()=>{ s.fov=parseInt(fov.value); $('setFovV').textContent=s.fov+'°'; Input.applySettings(); Save.save(); };
    $('setInv').onclick=()=>{ s.invertY=!s.invertY; Save.save(); renderSettings(); };
    $('setReset').onclick=()=>{ s.binds=Object.assign({},DATA.binds); Save.save(); renderSettings(); };
    $('setClose').onclick=closeMenus;
    $('settingsCard').querySelectorAll('[data-bind]').forEach(el=>{ el.onclick=()=>{ el.classList.add('bind'); el.textContent='press…';
      Input.beginCapture(c=>{ for(const k in s.binds) if(s.binds[k]===c) delete s.binds[k]; s.binds[el.dataset.bind]=c; Save.save(); renderSettings(); }); }; });
  }

  // ---------- VENDOR ----------
  function openVendor(){ openOverlay('ovVendor'); renderVendor(); }
  let vendorTab='buy';
  function renderVendor(){
    const cr=S.profile.credits;
    let body='';
    if(vendorTab==='buy'){
      body=`<div class="shopgrid">`+DATA.vendor.map(id=>{ const d=DATA.items[id], p=Vendor.price(id), can=cr>=p;
        return `<div class="shopcard r-${d.rarity||1}">
          <div class="shopic">${iconFor(d)}</div>
          <div class="shopnm">${d.name}</div><div class="shopmeta">${d.type}${d.size?` · ${d.size[0]}×${d.size[1]}`:''}</div>
          <button class="shopbuy ${can?'':'no'}" data-buy="${id}">${p}c</button></div>`; }).join('')+`</div>`;
    } else {
      const items=Inventory.stash().items;
      body = items.length ? `<div class="shopgrid">`+items.map(it=>`<div class="shopcard r-${it.def.rarity||1}">
          <div class="shopic">${iconFor(it.def)}</div>
          <div class="shopnm">${it.def.name}</div><div class="shopmeta">${it.def.type}${it.qty>1?` · ×${it.qty}`:''}</div>
          <button class="shopbuy sell" data-sell="${it.uid}">+${Inventory.sellValue(it)}c</button></div>`).join('')+`</div>`
        : '<div class="mini" style="padding:30px 0;text-align:center">Stash is empty — bring back loot to sell.</div>';
    }
    $('vendorCard').innerHTML=`<div class="eb">Black Market // Trader</div>
      <div class="shophead"><h1 style="margin:0">Trade</h1><div class="creditpill">💰 ${cr}c</div></div>
      <div class="tabs"><button class="tab ${vendorTab==='buy'?'on':''}" data-tab="buy">Buy</button><button class="tab ${vendorTab==='sell'?'on':''}" data-tab="sell">Sell</button></div>
      ${body}
      <div class="btn" id="vClose" style="margin-top:16px;width:auto;display:inline-block"><span class="k">ESC</span> Close</div>`;
    $('vClose').onclick=closeMenus;
    $('vendorCard').querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{ vendorTab=b.dataset.tab; renderVendor(); });
    $('vendorCard').querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>{ Vendor.buy(b.dataset.buy); Audio.play('ui'); renderVendor(); refreshHUD(); });
    $('vendorCard').querySelectorAll('[data-sell]').forEach(b=>b.onclick=()=>{ Vendor.sell(b.dataset.sell*1); Audio.play('pickup'); renderVendor(); refreshHUD(); });
  }

  // ---------- CRAFTING ----------
  function openCraft(){ openOverlay('ovCraft'); renderCraft(); }
  function renderCraft(){
    const rows=DATA.recipes.map((r,i)=>{ const can=Crafting.can(r);
      const ins=r.in.map(q=>`${DATA.items[q.id].name.split(' ')[0]} ${Inventory.stash().count(q.id)}/${q.qty}`).join(' · ');
      return `<div class="li"><span class="nm">${r.name}<br><span class="meta">${ins}</span></span><span class="btn ${can?'':'disabled'}" data-craft="${i}" style="width:auto;margin:0;padding:6px 12px">Craft</span></div>`; }).join('');
    $('craftCard').innerHTML=`<div class="eb">Fabrication // 3D Printer</div><h1>Craft</h1>
      <p class="sub">Consumes materials from your stash. Filament + scrap → ammo, parts, and gear.</p>${rows}
      <div class="btn" id="cClose" style="margin-top:14px"><span class="k">ESC</span> Close</div>`;
    $('cClose').onclick=closeMenus;
    $('craftCard').querySelectorAll('[data-craft]').forEach(b=>b.onclick=()=>{ Crafting.craft(DATA.recipes[b.dataset.craft*1]); renderCraft(); refreshHUD(); });
  }

  // ---------- SKILLS ----------
  function openSkills(){ openOverlay('ovSkill'); renderSkills(); }
  function renderSkills(){
    const rows=Object.keys(DATA.skills).map(k=>{ const d=DATA.skills[k], rank=S.profile.skills[k], can=S.profile.skillPoints>0&&rank<d.max;
      return `<div class="li"><span class="nm">${d.name} <span class="meta">${d.desc}</span><br><span class="meta">Rank ${rank}/${d.max}</span></span><span class="btn ${can?'':'disabled'}" data-sk="${k}" style="width:auto;margin:0;padding:6px 12px">+1</span></div>`; }).join('');
    $('skillCard').innerHTML=`<div class="eb">Workbench // Skills</div><h1>Skills</h1>
      <div class="row"><span>Skill points</span><b>${S.profile.skillPoints}</b></div>
      <div class="row"><span>Level</span><b>${S.profile.level} (${S.profile.xp} xp)</b></div>
      <div style="margin-top:12px">${rows}</div>
      <div class="btn" id="sClose" style="margin-top:14px"><span class="k">ESC</span> Close</div>`;
    $('sClose').onclick=closeMenus;
    $('skillCard').querySelectorAll('[data-sk]').forEach(b=>b.onclick=()=>{ Progression.spend(b.dataset.sk); renderSkills(); refreshHUD(); });
  }

  // ---------- DEPLOY ----------
  function openDeploy(){ openOverlay('ovExtract'); const e=S.profile.equip;
    $('extractCard').innerHTML=`<div class="eb">Train // Deploy</div><h1>Deploy</h1>
      <p class="sub">Board the train to the first stop. Loot fills your rig and pack; bring meds and ammo.</p>
      <div class="row"><span>Primary</span><b>${e.primary?e.primary.def.name:'—'}</b></div>
      <div class="row"><span>Secondary</span><b>${e.secondary?e.secondary.def.name:'—'}</b></div>
      <div class="row"><span>Armor</span><b>${e.armor?e.armor.def.name:'none'}</b></div>
      <div class="btn" id="dGo"><span class="k">▶</span> Board train · Deploy</div>
      <div class="btn" id="dClose"><span class="k">ESC</span> Not yet</div>`;
    $('dGo').onclick=()=>Raid.deploy(); $('dClose').onclick=closeMenus;
  }

  // ---------- EXTRACT CHOICE ----------
  function showExtractChoice(){ document.exitPointerLock(); prevMode=MODE.RAID; S.setMode(MODE.MENU); hideAll(); $('ovExtract').classList.add('show');
    const i=S.run.stopIndex, nextMult=DATA.stops.rewardMult(i+1).toFixed(2);
    $('extractCard').innerHTML=`<div class="eb">Extract Point</div><h1>Extract?</h1>
      <p class="sub">Bank your run now, or board the train one stop deeper — harder enemies, better loot, a ${nextMult}× value multiplier on everything you carry out.</p>
      <div class="row"><span>Carried value</span><b>${S.run.bagValue}c</b></div>
      <div class="row"><span>Bank now (×${DATA.stops.rewardMult(i).toFixed(2)})</span><b>${Math.round(S.run.bagValue*DATA.stops.rewardMult(i))}c</b></div>
      <div class="btn" id="eOut"><span class="k">▲</span> Extract to safehouse</div>
      <div class="btn" id="eDeep"><span class="k">▼</span> Push deeper · Stop ${i+2}</div>`;
    $('eOut').onclick=()=>Raid.extract(); $('eDeep').onclick=()=>Raid.pushDeeper();
  }

  // ---------- RESULT / PAUSE ----------
  function showResult({died,title,sub,rows}){ S.setMode(MODE.RESULT); hideAll(); $('ovResult').classList.add('show');
    $('resultCard').innerHTML=`<div class="eb">${died?'Raid Report // KIA':'Raid Report // Success'}</div><h1 class="${died?'bad':'good'}">${title}</h1>
      <p class="sub">${sub}</p>${rows.map(r=>`<div class="row"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')}
      <div class="btn" id="rBack" style="margin-top:14px"><span class="k">▶</span> Return to safehouse</div>`;
    $('rBack').onclick=()=>{ hideAll(); S.run=null; World.buildHub(); };
  }
  function pause(){ if(S.mode!==MODE.RAID) return; S.setMode(MODE.PAUSE); hideAll(); $('ovPause').classList.add('show');
    $('pauseCard').innerHTML=`<div class="eb">Paused</div><h1>Standby</h1><p class="sub">Resume to lock back in, or open settings.</p>
      <div class="btn" id="pR"><span class="k">▶</span> Resume</div>
      <div class="btn" id="pS"><span class="k">⚙</span> Settings</div>`;
    $('pR').onclick=resume; $('pS').onclick=openSettings; }
  function resume(){ hideAll(); S.setMode(MODE.RAID); if(!Input.isTouch) GFX.dom.requestPointerLock(); }

  // HUD reactive bindings
  Events.on('player:tick', refreshHUD);
  Events.on('player:changed', refreshHUD);
  Events.on('weapon:changed', refreshHUD);
  Events.on('progress:changed', refreshHUD);
  Events.on('inv:changed', ()=>{ if($('ovInv').classList.contains('show')) renderInventory(); refreshHUD(); });
  Events.on('threats:changed', ()=> $('thN').textContent=Enemies.aliveCount());

  return { setObjective, prompt, hit, dmgDir, banner, flashReload, toast, refreshHUD, renderStart, toggleInventory, openStation,
           openVendor, openCraft, openSkills, openLoot, openSettings, openMod, showExtractChoice, showResult, pause, resume, closeMenus };
})();
