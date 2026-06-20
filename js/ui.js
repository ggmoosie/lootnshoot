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
import { Projectiles } from "./projectiles.js";
import { createPreview } from "./preview.js";
import { buildMannequin } from "./mannequin.js";
import { Account } from "./account.js";

export const UI = (function(){
  const $=id=>document.getElementById(id);
  let selUid=null;
  const GAME_VERSION='v0.2'; // shown on the start card + sent as report context.version

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
    // ammo readout: rounds-in-mag / reserve-of-the-loaded-type, plus the loaded
    // ammo TYPE so the X-key ammo cycling (FMJ/AP/HP/TR) is legible. Reserve is the
    // real carried count (raid: rig+pack, hub: stash) — the ammo/mags system feeds
    // reload from it, so the HUD shows it instead of the old fake ∞.
    if(w){
      const reserve = Weapons.reserveOf? Weapons.reserveOf(w) : 0;
      const at = Weapons.loadedType? Weapons.loadedType(w) : null;
      $('amN').innerHTML = `<span class="mg">${w.inst.ammo}</span> <span class="rs${reserve<=0?' out':''}">/ ${reserve}</span>`;
      $('atype').textContent = (S.mode===MODE.RAID && at) ? at.label : '';
    } else { $('amN').innerHTML='<span class="mg">—</span>'; $('atype').textContent=''; }
    $('amN').classList.toggle('low', !!(w&&st&&w.inst.ammo<=Math.ceil(st.mag*0.25)));
    $('wpn').textContent = w?w.def.name:'UNARMED';
    $('fmode').textContent = (S.mode===MODE.RAID&&w)?Weapons.modeOf(w).toUpperCase():'';
    $('stance').textContent = Input.crouch?'CROUCH':'STAND';
    document.querySelectorAll('.wslot').forEach(s=>s.classList.toggle('on', s.dataset.s===pl.activeSlot));
    $('cr').textContent=pr.credits; $('lvl').textContent=`LVL ${pr.level}`;
    $('nade').textContent = S.mode===MODE.RAID? throwLine():'';
    if(Input.isTouch) refreshTouchHUD(pl,pr);
  }
  // mobile-only HUD: kills/alive readout + the weapon/throwable quick-bar.
  // Reads the same state the desktop ammo/slots panel does — no new game data.
  function refreshTouchHUD(pl,pr){
    const inRaid=S.mode===MODE.RAID;
    const kK=$('kKills'), kA=$('kAlive');
    if(kK) kK.textContent = (S.run&&S.run.kills)||0;
    if(kA) kA.textContent = inRaid? Enemies.aliveCount():0;
    // quick-bar: primary / secondary weapons (icon = mag ammo) + nade / med counts
    const eq=pr.equip||{};
    const qslot=(id,item,active)=>{ const el=$(id); if(!el) return; const a=el.querySelector('.qa');
      el.classList.toggle('empty',!item); el.classList.toggle('on',!!active);
      if(a) a.textContent = item? (item.inst?item.inst.ammo:0) : '—'; };
    qslot('qbPrimary',   eq.primary,   pl.activeSlot==='primary');
    qslot('qbSecondary', eq.secondary, pl.activeSlot==='secondary');
    const nQ=$('qbNade'), nMed=$('qbMed');
    if(nQ){ const n=nadeCount(); nQ.querySelector('.qa').textContent=n; nQ.classList.toggle('empty',!inRaid||n<=0); }
    if(nMed){ const m=medCount(); nMed.querySelector('.qa').textContent=m; nMed.classList.toggle('empty',!inRaid||m<=0); }
  }
  function medCount(){ let n=0; for(const g of Inventory.carried()) for(const t of g.items) if(t.def.type==='med') n+=t.qty; return n; }
  function reserveOf(st){ if(!st) return 0; const grids=S.mode===MODE.RAID?Inventory.carried():[Inventory.stash()]; let n=0; for(const g of grids) for(const t of g.items) if(t.def.type==='ammo'&&t.def.cal===st.cal) n+=t.qty; return n; }
  function nadeCount(){ let n=0; for(const g of Inventory.carried()) n+=g.count('nade_frag'); return n; }
  // HUD throwable readout: frags (G / quickbar) + the currently-selected throwable
  // for the Q throw (smoke/flash/inc/etc.) so all carried ordnance is visible.
  function throwLine(){
    let line=`Frag: ${nadeCount()}`;
    try{ const sel=Projectiles.selectedKind&&Projectiles.selectedKind();
      const have=(Projectiles.carriedKinds&&Projectiles.carriedKinds())||{};
      const kinds=Object.keys(have);
      if(sel && sel!=='frag' && have[sel]) line+=` · ${sel.toUpperCase()}: ${have[sel]}`;
      else if(kinds.length>1) line+=` · +${kinds.length-1} type${kinds.length>2?'s':''}`;
    }catch(_){ }
    return line;
  }

  // ---------- overlay helpers ----------
  const OVS=['ovStart','ovInv','ovVendor','ovCraft','ovSkill','ovExtract','ovResult','ovPause','ovSettings','ovMod','ovReport'];
  function hideAll(){ OVS.forEach(o=>$(o).classList.remove('show')); }
  function closeMenus(){ hideAll(); hideCtx(); hideTip(); clearReveal(); loot=null; openCont=null; Inventory.setExternal(null); disposeGunPreview(); disposeMannequin(); disposeCorpseMannequin();
    if(S.mode===MODE.MENU){ const pm=prevMode; S.setMode(pm);
      if(pm===MODE.PAUSE){ $('ovPause').classList.add('show'); }
      else if(pm===MODE.BOOT){ $('ovStart').classList.add('show'); }
      else if(pm===MODE.RAID||pm===MODE.HUB){ Input.relock(); } } }
  let prevMode=MODE.HUB;
  function openOverlay(id){ prevMode = S.mode===MODE.MENU?prevMode:S.mode; S.setMode(MODE.MENU); document.exitPointerLock(); Input.clearKeys(); hideAll(); $(id).classList.add('show'); }
  // The mode the player is REALLY in. Opening a menu overlay flips S.mode to MENU,
  // which would otherwise hide HUB-only UI (the stash column) and break HUB/RAID
  // routing while the inventory is open. Fall back to prevMode in that case.
  function effMode(){ return S.mode===MODE.MENU ? prevMode : S.mode; }

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
      <div class="eb">Tactical Extraction // ${GAME_VERSION}</div><h1>LootNShoot</h1>
      <div id="acctRow"></div>
      <p class="sub">Gear up in the safehouse, ride the train out to a hostile stop, clear it, grab loot, then choose to extract or push the train deeper for bigger rewards and risk. Die in the field and your pack & rig are gone.</p>
      <div class="hint"><b>WASD</b> move · <b>SPACE</b> jump · <b>C</b> crouch · <b>L-CLICK</b> fire · <b>R-CLICK</b> ADS · <b>R</b> reload · <b>Z</b> melee · <b>G</b> grenade · <b>F</b> pick up · <b>E</b> loot/interact · <b>TAB</b> inventory · rebind all in Settings</div>
      <div class="btn" id="bGo"><span class="k">▶</span> ${has?'Continue':'Enter Safehouse'}</div>
      <div class="btn" id="bSet"><span class="k">⚙</span> Settings</div>
      <div class="btn" id="bRep"><span class="k">🐞</span> Report a bug / idea</div>
      ${has?'<div class="btn" id="bNew"><span class="k">＋</span> New Game (wipe save)</div>':''}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:18px;font-family:var(--mono);font-size:10px;letter-spacing:1px;color:var(--dim);text-transform:uppercase;">
        <span>${has?'Save loaded':'No save — fresh start'}</span><span class="soon">More stops &amp; bosses</span></div>`;
    $('bGo').onclick=()=>{ S.profile = has||Save.newProfile(); Progression.recompute(); Input.applySettings(); hideAll(); World.buildHub(); };
    $('bSet').onclick=()=>{ if(!S.profile){ S.profile = has||Save.newProfile(); Progression.recompute(); } openSettings(); };
    $('bRep').onclick=openReport;
    if(has) $('bNew').onclick=()=>{ Save.wipe(); S.profile=Save.newProfile(); Progression.recompute(); Input.applySettings(); hideAll(); World.buildHub(); };
    renderAccount();
  }

  // ---------- ACCOUNT (shared cross-game login) ----------
  // A self-contained block rendered into #acctRow on the start card. Logged-out →
  // a compact username/password sign-in/up form with a mode toggle; logged-in → the
  // username + a sign-out link. The username is the SAME one used in Riftspawn and
  // every other game on this origin. ENTIRELY OPTIONAL: if Firebase isn't available
  // (offline / blocked) the whole block is hidden and the game plays local-only.
  let _acctMode='login';   // 'login' | 'signup'
  let _acctBusy=false;
  function renderAccount(){
    const row=$('acctRow'); if(!row) return;
    if(!Account.available()){ row.innerHTML=''; return; } // offline / SDK blocked → no login chrome at all
    const acct=Account.current();
    if(acct){
      row.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:2px 0 14px;padding:9px 12px;border:1px solid var(--line);background:#0c0f12;font-family:var(--mono);font-size:12px">
          <span style="color:var(--go);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">◈ ${escAcct(acct.username)}</span>
          <span class="acctLink" id="acctLogout" style="color:var(--dim);cursor:pointer;flex:none">sign out</span>
        </div>`;
      const lo=$('acctLogout'); if(lo) lo.onclick=async ()=>{ try{ await Account.signOut(); }catch(_){} };
      return;
    }
    const isSignup=_acctMode==='signup';
    const fs=`width:100%;background:#0c0f12;border:1px solid var(--line);color:var(--text);padding:9px 11px;font-family:var(--mono);font-size:13px;box-sizing:border-box`;
    row.innerHTML=`<div style="margin:2px 0 14px;padding:11px 12px;border:1px solid var(--line);background:#0c0f12">
        <div style="font-family:var(--mono);font-size:11px;letter-spacing:1px;color:var(--dim);text-transform:uppercase;margin-bottom:8px">${isSignup?'Create account':'Sign in'} <span style="color:var(--blue)">· syncs across all the games</span></div>
        <input id="acctUser" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" placeholder="username" style="${fs};margin-bottom:7px">
        <input id="acctPass" type="password" autocomplete="${isSignup?'new-password':'current-password'}" placeholder="password" style="${fs}">
        <div id="acctMsg" style="min-height:16px;font-family:var(--mono);font-size:11px;margin:7px 0 2px;color:var(--dim)"></div>
        <div style="display:flex;gap:8px;align-items:center">
          <div class="btn" id="acctGo" style="width:auto;margin:0;flex:1;text-align:center"><span class="k">▸</span> ${isSignup?'Create account':'Log in'}</div>
        </div>
        <div class="acctLink" id="acctToggle" style="margin-top:9px;font-family:var(--mono);font-size:11px;color:var(--blue);cursor:pointer">${isSignup?'Have an account? Sign in ›':'New here? Create an account ›'}</div>
      </div>`;
    const user=$('acctUser'), pass=$('acctPass'), go=$('acctGo'), tog=$('acctToggle'), msg=$('acctMsg');
    const setMsg=(t,c)=>{ if(msg){ msg.textContent=t||''; msg.style.color=c||'var(--dim)'; } };
    const submit=async ()=>{
      if(_acctBusy) return;
      const u=(user.value||'').trim(), p=pass.value||'';
      if(!u||!p){ setMsg('Enter your username and password.','var(--amber)'); return; }
      _acctBusy=true; const lbl=go.innerHTML; go.innerHTML='<span class="k">…</span> Working'; go.classList.add('disabled'); setMsg('');
      try{
        if(isSignup) await Account.signUp(u,p); else await Account.signIn(u,p);
        // success → onAuthStateChanged fires 'account:changed' which re-renders this block
      }catch(err){ setMsg(Account.errText(err,isSignup),'var(--bad)'); _acctBusy=false; go.innerHTML=lbl; go.classList.remove('disabled'); }
    };
    go.onclick=submit;
    pass.onkeydown=ev=>{ if(ev.key==='Enter') submit(); };
    user.onkeydown=ev=>{ if(ev.key==='Enter') submit(); };
    if(tog) tog.onclick=()=>{ if(_acctBusy) return; _acctMode=isSignup?'login':'signup'; renderAccount(); };
  }
  // minimal text escape for the username we echo into the menu
  function escAcct(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  // ---------- INVENTORY (Tarkov-style spatial drag/drop) ----------
  const CELL=44;
  let loot=null;          // external container being looted (corpse/crate)
  let gridMap={};         // gridkey -> Grid (rebuilt each render)
  let drag=null;          // { uid, rot, def }
  let openCont=null;      // uid of a stash/inventory CONTAINER item whose contents panel is open (right-click → Open)

  function toggleInventory(){ if($('ovInv').classList.contains('show')) return closeMenus(); loot=null; Inventory.setExternal(null); openOverlay('ovInv'); renderInventory(); }
  // Loot a corpse (structured: equip slots + nested rig/backpack grids) or a crate
  // (flat grid). Register the right external shape so Inventory.locate/move can see
  // its slots + grids, then render the dual-panel loot screen.
  function openLoot(corpse){ loot=corpse; Inventory.setExternal(corpse.equip?{equip:corpse.equip}:corpse.grid); openOverlay('ovInv'); renderInventory();
    // Flat crate, first open → reveal its contents one at a time with per-item progress.
    if(corpse && !corpse.equip && corpse.grid && !corpse.revealed) startReveal(corpse);
  }
  function isCorpse(c){ return !!(c&&c.equip); }

  // ---- staggered crate reveal ----
  // Show the crate immediately (empty), then surface each item sequentially: a small
  // per-item progress bar fills, then the item pops into the grid. Re-opening a crate
  // that's already been revealed just shows everything (revealed=true short-circuits).
  let revealTimers=[];
  function clearReveal(){ for(const t of revealTimers){ clearTimeout(t); clearInterval(t); } revealTimers=[]; }
  function startReveal(crate){
    clearReveal();
    const items=[...crate.grid.items];
    if(!items.length){ crate.revealed=true; return; }
    crate.grid.items=[];                       // empty the visible crate
    crate.revealing=true; crate.revealProg=0; crate.revealIdx=0; crate.revealTotal=items.length;
    renderInventory();
    // total search budget split across items (min feel), each item gets a fill then a pop
    const total=Math.max(0.6,(crate.searchTime||1.2));
    const per=Math.max(260, Math.min(900, (total*1000)/items.length));
    let i=0;
    const next=()=>{
      if(loot!==crate || !$('ovInv').classList.contains('show')){ // bailed out → dump the rest in
        crate.grid.items.push(...items.slice(i)); crate.revealing=false; crate.revealed=true; clearReveal(); return;
      }
      if(i>=items.length){ crate.revealing=false; crate.revealed=true; crate.revealProg=0; renderInventory(); return; }
      crate.revealIdx=i+1; crate.revealProg=0;
      const steps=12, stepMs=per/steps; let s=0;
      const iv=setInterval(()=>{ s++; crate.revealProg=s/steps; updateRevealBar(crate);
        if(s>=steps){ clearInterval(iv);
          crate.grid.items.push(items[i]);     // pop the item in
          Audio.play('ui'); i++; renderInventory();
          const t=setTimeout(next, 90); revealTimers.push(t);
        } }, stepMs);
      revealTimers.push(iv);
    };
    next();
  }
  // lightweight in-place update of the reveal progress bar (avoids a full re-render per frame)
  function updateRevealBar(crate){
    const fill=document.getElementById('revealFill'); if(fill) fill.style.width=Math.round((crate.revealProg||0)*100)+'%';
    const lab=document.getElementById('revealLab'); if(lab) lab.textContent=`Uncovering ${crate.revealIdx}/${crate.revealTotal}…`;
  }

  function gridHTML(grid,label,gk){
    let h=`<div class="col"><div class="colT"><span>${label}</span><span class="cap">${grid.w}×${grid.h}</span></div><div class="gridscroll"><div class="grid" data-gk="${gk}" style="width:${grid.w*CELL}px;height:${grid.h*CELL}px">`;
    for(let y=0;y<grid.h;y++)for(let x=0;x<grid.w;x++) h+=`<div class="cell" style="left:${x*CELL}px;top:${y*CELL}px;width:${CELL}px;height:${CELL}px"></div>`;
    for(const it of grid.items){ const w=(it.rot?it.def.size[1]:it.def.size[0])*CELL, hh=(it.rot?it.def.size[0]:it.def.size[1])*CELL; const small=it.def.size[0]===1&&it.def.size[1]===1;
      h+=`<div class="gi r-${it.def.rarity||1}${small?' small':''}" data-uid="${it.uid}" style="left:${it.x*CELL}px;top:${it.y*CELL}px;width:${w}px;height:${hh}px"><span class="ic">${iconFor(it.def)}</span><span class="nm">${it.def.name}</span>${it.qty>1?`<span class="q">${it.qty}</span>`:''}</div>`; }
    h+=`</div></div></div>`; return h;
  }
  // slotHTML(slot, item, corpse?) — one paper-doll slot. For the player (corpse=false)
  // the slot carries data-slot so it is a valid equip DROP target. For a corpse it
  // carries data-cslot instead (drag-source only — you can't gear up a dead body),
  // and its empty cells read "empty" rather than the player slot prompt.
  function slotHTML(s,it,corpse){ const meta={primary:['Primary','🔫'],secondary:['Sidearm','🔫'],helmet:['Helmet','⛑️'],armor:['Armor','🛡️'],clothing:['Clothing','👕'],rig:['Rig','🦺'],backpack:['Pack','🎒']}[s];
    const wide = (s==='primary'||s==='secondary');
    const tag = corpse ? `data-cslot="${s}"` : `data-slot="${s}"`;
    return `<div class="eslot ${wide?'wpn ':''}${corpse?'cslot ':''}${it?'full r-'+(it.def.rarity||1):''}" style="grid-area:${s}" ${tag} ${it?`data-uid="${it.uid}"`:''}>
      <span class="ei">${it?iconFor(it.def):meta[1]}</span><span class="sn">${it&&wide?it.def.name:meta[0]}</span>${it&&it.qty>1?`<span class="q">${it.qty}</span>`:''}</div>`; }

  // ---- the player's loadout (paper-doll + stat readout) as a column ----
  function playerLoadoutHTML(){
    const e=S.profile.equip;
    // gear readout from the unified armor/clothing system (helmet+armor+clothing)
    const gt=Inventory.gearTotals();
    const drPct=Math.round(gt.dr*100);
    const ergoPct=Math.round((gt.ergo||0)*100);
    const ergoStr=ergoPct===0?'—':(ergoPct>0?'+'+ergoPct+'%':ergoPct+'%');
    return `<div class="col gearcol"><div class="colT"><span>${loot?'You':'Loadout'}</span></div>
      <div class="doll">${EQUIP_SLOTS.map(s=>slotHTML(s,e[s])).join('')}<div class="dollfig" id="dollFig" aria-hidden="true"></div></div>
      <div class="gearstats"><div><span class="gl">HEALTH</span><span class="gv">${Math.round(S.player.maxHealth)}</span></div><div><span class="gl">ARMOR</span><span class="gv">AC${gt.ac} · ${drPct}%</span></div><div><span class="gl">MOBILITY</span><span class="gv">${ergoStr}</span></div></div>
      <div class="mini" style="margin-top:6px">Drag to equip · <b style="color:var(--amber)">R</b> rotate · <b style="color:var(--amber)">shift</b>+click quick-move · right-click menu</div></div>`;
  }
  // ---- a looted CORPSE's loadout (paper-doll, drag-source only) as a column ----
  // Mirrors the player widget: equip slots around a 3D body. Empty slots read as
  // empty; filled slots are draggable into the player's inventory.
  function corpseLoadoutHTML(c){
    const eq=c.equip;
    return `<div class="col gearcol corpsecol"><div class="colT"><span>${(c.label||'Body').replace(/'s kit$/,'')}</span></div>
      <div class="doll">${EQUIP_SLOTS.map(s=>slotHTML(s,eq[s],true)).join('')}<div class="dollfig" id="corpseFig" aria-hidden="true"></div></div>
      <div class="mini" style="margin-top:6px">Drag from the body · <b style="color:var(--amber)">shift</b>+click grab · right-click menu</div></div>`;
  }
  // grids on the corpse (its equipped rig + backpack containers), registered for d&d
  function corpseGridsHTML(c){
    let h=''; const eq=c.equip;
    if(eq.rig){ gridMap.crig=eq.rig.inst.container; h+=gridHTML(gridMap.crig,'Body Rig','crig'); }
    if(eq.backpack){ gridMap.cbag=eq.backpack.inst.container; h+=gridHTML(gridMap.cbag,'Body Pack','cbag'); }
    if(!eq.rig && !eq.backpack) h+=`<div class="col"><div class="colT"><span>Body</span></div><div class="mini" style="opacity:.6;padding:8px 2px">No rig or pack on this body.</div></div>`;
    return h;
  }
  // the player's own grids (rig + backpack in raid; stash in hub)
  function playerGridsHTML(){
    const e=S.profile.equip; let cols='';
    if(e.rig){ gridMap.rig=e.rig.inst.container; cols+=gridHTML(gridMap.rig,'Rig','rig'); }
    if(e.backpack){ gridMap.backpack=e.backpack.inst.container; cols+=gridHTML(gridMap.backpack,'Backpack','backpack'); }
    if(effMode()===MODE.HUB){ gridMap.stash=Inventory.stash(); cols+=gridHTML(gridMap.stash,'Stash','stash'); }
    // no carried containers (e.g. deployed with no rig/pack) — show why, not a void
    if(!cols && effMode()===MODE.RAID) cols=`<div class="col"><div class="emptyState"><span class="ic">🎒</span>No rig or pack equipped — you have nowhere to stow loot. Equip one back at the stash.</div></div>`;
    return cols;
  }
  // ---- the contents panel for a stash/inventory CONTAINER item opened via
  // right-click (or long-press on touch). Registers the container's nested grid as a
  // real d&d target under 'open', so dragging / shift-click moves items in & out and
  // the existing atomic Inventory.move/quickTo (which now recurse into nested grids)
  // do the bookkeeping — no duplication/loss. Resolves the open uid live each render;
  // if the container is gone (moved/sold/closed) the panel quietly drops away.
  function openContHTML(){
    if(openCont==null) return '';
    const loc=Inventory.locate(openCont);
    if(!loc || !Inventory.isContainer(loc.item)){ openCont=null; return ''; }
    const it=loc.item; gridMap.open=Inventory.containerGrid(it);
    // gridHTML already emits a self-contained .col (title + grid registered under
    // 'open'); we wrap it in .contpanel for the accent border + add a close affordance.
    let h=`<div class="contpanel">`;
    h+=gridHTML(gridMap.open, '📦 '+it.def.name, 'open');
    h+=`<div class="mini" style="margin:-4px 0 0 0;padding:0 2px">Drag items in/out · <b style="color:var(--amber)">shift</b>+click to ${effMode()===MODE.HUB?'stash':'pack'} · <span class="closecont" data-closecont="1">✕ close</span></div></div>`;
    return h;
  }

  function renderInventory(){
    hideTip();            // any tooltip from the previous render is now orphaned
    gridMap={};
    let body;
    const contPanel=openContHTML();   // contents panel for an opened stash/inv container (may register gridMap.open)
    if(loot && isCorpse(loot)){
      // STRUCTURED corpse loot: two mirrored halves — corpse (left) | you (right).
      const left=`<div class="lootside"><div class="lootsideT">Corpse</div><div class="invwrap">${corpseLoadoutHTML(loot)}${corpseGridsHTML(loot)}</div></div>`;
      const right=`<div class="lootside"><div class="lootsideT">You</div><div class="invwrap">${playerLoadoutHTML()}${playerGridsHTML()}${contPanel}</div></div>`;
      body=`<div class="lootcols">${left}${right}</div>`;
    } else if(loot){
      // legacy flat container (crate): its grid + the player's gear/grids
      gridMap.ext=loot.grid; const lootCol=gridHTML(loot.grid,(loot.label||'Loot').toUpperCase(),'ext');
      // while the crate is revealing its contents, show a per-item progress strip
      const revealBar = loot.revealing ? `<div class="reveal-strip"><div class="reveal-lab" id="revealLab">Uncovering ${loot.revealIdx||1}/${loot.revealTotal||1}…</div><div class="reveal-track"><div class="reveal-fill" id="revealFill" style="width:${Math.round((loot.revealProg||0)*100)}%"></div></div></div>` : '';
      body=`<div class="invwrap">${playerLoadoutHTML()}${playerGridsHTML()}${contPanel}<div class="lootcolwrap">${revealBar}${lootCol}</div></div>`;
    } else {
      body=`<div class="invwrap">${playerLoadoutHTML()}${playerGridsHTML()}${contPanel}</div>`;
    }
    $('invCard').innerHTML=`<div class="eb">${loot?'Body // Loot':'Loadout // Inventory'}</div><h1>${loot?'Loot':'Gear'}</h1>
      ${body}
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
      el.addEventListener('mouseenter', ev=>showTip(el.dataset.uid*1, ev.clientX, ev.clientY, el));
      el.addEventListener('mousemove', ev=>moveTip(ev.clientX, ev.clientY));
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('dblclick', ev=>{ ev.preventDefault(); hideTip(); smartUse(el.dataset.uid*1); });
    });
    $('invCard').querySelectorAll('.eslot').forEach(el=>{
      if(el.dataset.uid){ el.addEventListener('pointerdown', startDrag);
        el.addEventListener('contextmenu', ev=>{ ev.preventDefault(); showCtx(el.dataset.uid*1, ev.clientX, ev.clientY); }); }
    });
    // touch long-press → context menu (desktop already has right-click); close-X on the contents panel
    $('invCard').querySelectorAll('.gi,.eslot[data-uid]').forEach(bindLongPress);
    const closeX=$('invCard').querySelector('[data-closecont]'); if(closeX) closeX.onclick=()=>{ openCont=null; renderInventory(); };
    mountMannequin();
    if(loot && isCorpse(loot)) mountCorpseMannequin(loot); else disposeCorpseMannequin();
    hideCtx();
    if(loot && loot.cmesh) Loot.reflectCorpse(loot);
  }

  // ----- inventory paper-doll 3D mannequin -----
  // A rotating procedural humanoid in the .dollfig cell, reflecting equipped gear.
  // Like the gunsmith render, the canvas + its WebGLRenderer are created ONCE per
  // inventory open and survive renderInventory's innerHTML rebuilds (we re-parent
  // the persistent canvas back into the fresh #dollFig and just rebuild the model
  // to reflect the new loadout). Disposed in closeMenus → no leaked renderer/RAF.
  let manPrev=null, manCanvas=null, manEquipSig=null;
  function disposeMannequin(){
    if(manPrev){ manPrev.dispose(); manPrev=null; }
    if(manCanvas && manCanvas.parentNode) manCanvas.parentNode.removeChild(manCanvas);
    manCanvas=null; manEquipSig=null;
  }
  // a stable signature of the EQUIPPED gear the doll renders, so we only rebuild the
  // model when equipment actually changes — not on every inv:changed tick (which
  // would jitter/reset the model and its rotation each time a grid item moves).
  function equipSig(e){ if(!e) return ''; return EQUIP_SLOTS.map(s=>{ const it=e[s]; if(!it) return s+':-';
      const at = it.inst&&it.inst.attachments ? Object.keys(it.inst.attachments).sort().map(k=>k+'='+it.inst.attachments[k]).join(',') : '';
      return s+':'+it.def.id+(at?'#'+at:''); }).join('|'); }
  function refreshMannequin(){
    if(!manPrev || !S.profile) return;
    const sig=equipSig(S.profile.equip);
    if(sig===manEquipSig) return;            // gear unchanged → leave the model (and its rotation) alone
    const first=manEquipSig===null;
    manEquipSig=sig;
    manPrev.setModel(buildMannequin(S.profile.equip), !first); // keep rotation across rebuilds
  }
  function mountMannequin(){
    const fig=$('dollFig'); if(!fig) return;
    if(!manCanvas){
      manCanvas=document.createElement('canvas'); manCanvas.className='doll-3d';
      fig.appendChild(manCanvas);
      // no auto-spin: the doll only rotates while click-dragged (gunsmith control model)
      manPrev=createPreview(manCanvas, { autoRotate:false, fov:38, fitOffset:1.25 });
      manPrev.enableDragRotate({ onDragStart:hideTip });
      manPrev.start();
    } else {
      fig.appendChild(manCanvas);
      manPrev.resize();
    }
    refreshMannequin();
  }

  // ----- corpse paper-doll 3D mannequin -----
  // Same persistent-canvas pattern as the player doll, but for the looted body in
  // the left column. Built from the corpse's own equip object (which buildMannequin
  // already understands — it's the same {helmet,armor,rig,backpack,primary,...}
  // slot shape). Disposed when the loot screen closes (closeMenus).
  let corpsePrev=null, corpseCanvas=null, corpseEquipSig=null;
  function disposeCorpseMannequin(){
    if(corpsePrev){ corpsePrev.dispose(); corpsePrev=null; }
    if(corpseCanvas && corpseCanvas.parentNode) corpseCanvas.parentNode.removeChild(corpseCanvas);
    corpseCanvas=null; corpseEquipSig=null;
  }
  function mountCorpseMannequin(c){
    const fig=$('corpseFig'); if(!fig) return;
    if(!corpseCanvas){
      corpseCanvas=document.createElement('canvas'); corpseCanvas.className='doll-3d';
      fig.appendChild(corpseCanvas);
      corpsePrev=createPreview(corpseCanvas, { autoRotate:false, fov:38, fitOffset:1.25 });
      corpsePrev.enableDragRotate({ onDragStart:hideTip });
      corpsePrev.start();
    } else {
      fig.appendChild(corpseCanvas);
      corpsePrev.resize();
    }
    if(!corpsePrev) return;
    const sig=equipSig(c.equip);
    if(sig===corpseEquipSig) return;           // body's kit unchanged → don't rebuild/reset
    const first=corpseEquipSig===null;
    corpseEquipSig=sig;
    corpsePrev.setModel(buildMannequin(c.equip), !first);
  }

  // Take all: a corpse drains from its equip slots + nested grids; a crate from its
  // flat grid. Everything flows into the player's first carried grid (or stash).
  function lootItems(){
    if(!loot) return [];
    if(isCorpse(loot)){ const out=[]; const eq=loot.equip;
      for(const s of EQUIP_SLOTS) if(eq[s]) out.push(eq[s]);
      for(const g of Inventory.extGrids()) for(const it of g.items) out.push(it);
      return out; }
    return [...loot.grid.items];
  }
  function takeAll(){ if(!loot) return;
    // Tarkov sort each looted item: relevant → rig (fallback pack/stash), rest → pack
    for(const it of lootItems()) Inventory.quickToAny(it.uid, intakeTargets(it.def));
    renderInventory(); refreshHUD(); }

  // ----- touch long-press → context menu -----
  // Desktop opens the item menu with right-click (contextmenu). Touch has no
  // right-click, so a ~450ms press-and-hold on an item tile opens the same menu.
  // We cancel on move (that's a drag) or early release (that's a tap/double-tap).
  function bindLongPress(el){
    let timer=null, sx=0, sy=0;
    const clear=()=>{ if(timer){ clearTimeout(timer); timer=null; } };
    el.addEventListener('pointerdown', ev=>{
      if(ev.pointerType!=='touch') return;          // mouse/pen use real contextmenu
      sx=ev.clientX; sy=ev.clientY;
      clear(); timer=setTimeout(()=>{ timer=null;
        // a still 450ms hold is a MENU, not a drag — cancel any drag started on this press
        if(drag){ drag=null; $('dragGhost').style.display='none'; document.querySelectorAll('.gi.dragging').forEach(d=>d.classList.remove('dragging')); clearHi(); }
        const u=el.dataset.uid*1; hideTip(); showCtx(u, sx, sy);
      }, 450);
    });
    el.addEventListener('pointermove', ev=>{ if(timer && (Math.abs(ev.clientX-sx)>8||Math.abs(ev.clientY-sy)>8)) clear(); });
    el.addEventListener('pointerup', clear);
    el.addEventListener('pointercancel', clear);
  }

  // open / close a stash-or-inventory container's contents panel (right-click action
  // + long-press). Toggling the already-open one closes it; opening another swaps.
  function openContainer(uid){ openCont = (openCont===uid) ? null : uid; renderInventory(); }

  // ----- drag/drop -----
  function startDrag(ev){
    if(ev.button!==undefined && ev.button!==0) return;
    const uid=this.dataset.uid*1; const loc=Inventory.locate(uid); if(!loc) return;
    if(ev.altKey){ ev.preventDefault(); autoEquip(uid); return; }
    if(ev.shiftKey || ev.ctrlKey || ev.metaKey){ ev.preventDefault(); quickMove(uid); return; }
    ev.preventDefault(); hideCtx(); hideTip();
    drag={ uid, rot:loc.item.rot, def:loc.item.def };
    const g=$('dragGhost'); sizeGhost(); g.innerHTML=`<span>${iconFor(loc.item.def)}</span>`; g.style.display='flex';
    moveGhost(ev.clientX,ev.clientY); this.classList.add('dragging');
  }
  // is this located item on the open external actor (corpse equip/grids or crate)?
  function onExternal(loc){ return loc.where==='extequip' || loc.tag==='ext'; }
  // a place on the corpse for an incoming player item: its rig, else its pack
  function corpseStash(){ const gs=Inventory.extGrids(); return gs[0]||null; }
  // Tarkov-style auto-sort target list when pulling loot INTO the player: relevant
  // items (ammo/meds/throwables) prefer the RIG then fall back to the BACKPACK;
  // everything else prefers the BACKPACK then falls back to the RIG. carried() is
  // [rig, backpack]; in the hub it's empty, so we append the stash as a final sink.
  function intakeTargets(def){
    const cs=Inventory.carried(); const rig=cs[0]||null, bag=cs[1]||null;
    const order = Inventory.rigRelevant(def) ? [rig, bag] : [bag, rig];
    order.push(Inventory.stash());                 // final fallback (hub stash / nowhere-to-stow)
    return order;
  }
  // shift+click: send item to the logical "other" inventory
  function quickMove(uid){ const loc=Inventory.locate(uid); if(!loc) return;
    // pulling FROM a loot source (corpse/crate) into the player → Tarkov sort w/ fallback
    if(loot && onExternal(loc)){
      if(Inventory.quickToAny(uid, intakeTargets(loc.item.def))){ Audio.play('ui'); renderInventory(); refreshHUD(); }
      else UI_noRoom();
      return;
    }
    let dest=null;
    if(loot){ dest = isCorpse(loot)?corpseStash():loot.grid; }            // sending TO the body/crate
    else if(effMode()===MODE.HUB){ dest = loc.tag==='stash' ? (Inventory.carried()[0]||Inventory.stash()) : Inventory.stash(); }
    else { const cs=Inventory.carried(); dest = (loc.tag==='carried' && cs[1]) ? cs[1] : cs[0]; }
    if(dest && Inventory.quickTo(uid,dest)){ Audio.play('ui'); renderInventory(); refreshHUD(); } }
  function UI_noRoom(){ toast('No room','neg'); }
  // alt-click: auto-equip / swap a piece into its appropriate slot. Weapons fill the
  // primary slot first, else the secondary; gear (armor/helmet/clothing/rig/backpack)
  // goes to its own slot. Inventory.equip already swaps out whatever was there.
  function autoEquip(uid){
    const loc=Inventory.locate(uid); if(!loc) return; const def=loc.item.def; let ok=false;
    if(def.type==='weapon'){ const slot=S.profile.equip.primary?(S.profile.equip.secondary?'primary':'secondary'):'primary'; ok=Inventory.equip(uid, slot); }
    else if(['armor','helmet','clothing','rig','backpack'].includes(def.type) || Inventory.slotFor(def)){ ok=Inventory.equip(uid); }
    if(ok) Audio.play('ui');
    renderInventory(); refreshHUD();
  }
  // double-click: smart use/equip
  function smartUse(uid){ const loc=Inventory.locate(uid); if(!loc) return; const def=loc.item.def;
    if(def.type==='weapon') Inventory.equip(uid,'primary');
    else if(['armor','helmet','clothing','rig','backpack'].includes(def.type)) Inventory.equip(uid);
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
      else { if(Inventory.slotFor(def)===slot) Inventory.equip(d.uid); } // gear (armor/helmet/clothing/rig/backpack) → its own slot
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
    // CONTAINER (case/bag/rig with its own grid): view/manage its contents inline.
    // Listed first so it's the primary affordance for a stored container.
    if(Inventory.isContainer(it)) acts.push([openCont===uid?'Close contents':'Open contents',()=>{ openContainer(uid); }]);
    if(def.type==='weapon'){ acts.push(['Equip Primary',()=>Inventory.equip(uid,'primary')]); acts.push(['Equip Secondary',()=>Inventory.equip(uid,'secondary')]); acts.push(['Modify weapon',()=>openMod(uid)]); }
    else if(['armor','helmet','clothing','rig','backpack'].includes(def.type)) acts.push(['Equip',()=>Inventory.equip(uid)]);
    else if(def.type==='attachment') acts.push(['Install on weapon',()=>Inventory.installAttachment(uid)]);
    else if(def.type==='med'||def.type==='food') acts.push(['Use',()=>{ Player.heal(def.heal); if(def.cure)Status.clear('bleed'); Inventory.dropOrDestroy(uid); }]);
    else if(def.type==='deployable') acts.push(['Deploy',()=>Allies.deploy()]);
    // when a container panel is open, offer to stow loose items INTO it (skip the
    // container itself and items already inside — Inventory guards nesting anyway).
    if(openCont!=null && gridMap.open && loc.grid!==gridMap.open && uid!==openCont && !Inventory.isContainer(it)){
      acts.push(['→ Into case',()=>Inventory.quickTo(uid, gridMap.open)]);
    }
    if(loot && onExternal(loc)) acts.push(['Take',()=>Inventory.quickToAny(uid, intakeTargets(def))]);
    else if(loot){ const dest=isCorpse(loot)?corpseStash():loot.grid; if(dest) acts.push(['→ Body',()=>Inventory.quickTo(uid, dest)]); }
    if(effMode()===MODE.HUB){ if(loc.tag!=='stash') acts.push(['→ Stash',()=>Inventory.quickTo(uid,Inventory.stash())]); else { const c=Inventory.carried()[0]; if(c) acts.push(['→ Carry',()=>Inventory.quickTo(uid,c)]); } acts.push(['Sell '+Inventory.sellValue(it)+'c',()=>Vendor.sell(uid)]); }
    acts.push(['Discard',()=>Inventory.dropOrDestroy(uid)]);
    const ctx=$('ctx'); ctx.innerHTML=`<div class="ci t">${def.name}</div>`+acts.map((a,i)=>`<div class="ci" data-i="${i}">${a[0]}</div>`).join('');
    ctx.style.left=Math.min(x,innerWidth-170)+'px'; ctx.style.top=Math.min(y,innerHeight-280)+'px'; ctx.style.display='block';
    ctx.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>{ acts[b.dataset.i*1][1](); hideCtx(); renderInventory(); refreshHUD(); });
  }
  function hideCtx(){ const c=$('ctx'); if(c) c.style.display='none'; }
  addEventListener('pointerdown', ev=>{ const c=$('ctx'); if(c && c.style.display==='block' && !c.contains(ev.target)) hideCtx(); });

  // ----- hover tooltip -----
  // item is optional; gear reads it for live durability/worn-dr. Falls back to def.
  function statLines(def, item){
    const L=[]; if(def.type==='weapon'){ const w=DATA.weapons[def.weapon]; L.push(['Damage',w.damage],['RPM',w.rpm],['Mag',w.mag],['Modes',(w.modes||['auto']).join('/')]); }
    else if(def.type==='ammo') L.push(['Caliber',def.cal]);
    else if(def.type==='armor'||def.type==='helmet'||def.type==='clothing'){
      // unified gear readout (armor + clothing system)
      const g=Inventory.gearStat(item||{def, inst:{}});
      L.push(['Class', 'AC'+(g.ac||0)]);
      L.push(['Reduction', Math.round((g.dr||0)*100)+'%']);
      if(typeof g.maxDura==='number'){ const cur=Math.round(typeof g.dura==='number'?g.dura:g.maxDura); L.push(['Durability', cur+'/'+g.maxDura]); }
      if(g.ergo){ const e=Math.round(g.ergo*100); L.push(['Mobility', (e>0?'+':'')+e+'%']); }
      if(g.stealth){ L.push(['Stealth', '+'+Math.round(g.stealth*100)+'%']); }
    }
    else if(def.type==='med'){ L.push(['Heal',def.heal]); if(def.cure) L.push(['Cures',def.cure]); }
    else if(def.type==='throwable') L.push(['Damage',def.dmg],['Radius',def.radius+'m']);
    else if(def.type==='backpack'||def.type==='rig') L.push(['Grid',def.grid[0]+'×'+def.grid[1]]);
    L.push(['Size',def.size[0]+'×'+def.size[1]],['Value',def.value+'c']); return L;
  }
  // the element the current tooltip is sourced from — so we can detect when it
  // leaves the DOM (e.g. on a re-render) and auto-hide a now-orphaned tooltip.
  let tipSrc=null;
  function showTip(uid,x,y,srcEl){ if(drag) return; const loc=Inventory.locate(uid); if(!loc) return; const def=loc.item.def;
    tipSrc=srcEl||null;
    const t=$('tip'); t.innerHTML=`<div class="tn">${def.name}</div><div class="tt">${def.type}</div>`+statLines(def, loc.item).map(s=>`<div class="ts"><span>${s[0]}</span><b>${s[1]}</b></div>`).join('');
    t.style.left=Math.min(x+14,innerWidth-210)+'px'; t.style.top=Math.min(y+14,innerHeight-150)+'px'; t.style.display='block'; }
  function moveTip(x,y){ const t=$('tip'); if(t.style.display==='block'){
    // source element gone from the DOM (re-render/looted) → drop the stuck tip
    if(tipSrc && !document.body.contains(tipSrc)){ hideTip(); return; }
    t.style.left=Math.min(x+14,innerWidth-210)+'px'; t.style.top=Math.min(y+14,innerHeight-150)+'px'; } }
  function hideTip(){ const t=$('tip'); if(t) t.style.display='none'; tipSrc=null; }
  // global safety net: a tooltip must never linger. Kill it on blur, scroll, and any
  // drag-start, and whenever its source element is removed from the page.
  addEventListener('blur', hideTip);
  addEventListener('scroll', hideTip, true);
  addEventListener('pointerdown', ev=>{ if(tipSrc && ev.target!==tipSrc && (!tipSrc.contains||!tipSrc.contains(ev.target))) hideTip(); }, true);

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
    // baseline = the weapon with NO mods (1.0 scalars defaulted) so the live
    // readout's up/dn arrows compare the configured gun against the bare gun.
    const bareInst={...it, inst:{...it.inst, attachments:{}}};
    const bare=Weapons.stats(bareInst)||base;
    const slotIcon={optic:'🔭',muzzle:'🧪',foregrip:'🔦',stock:'🪵',laser:'🔆',magazine:'🔋',barrel:'📏',tactical:'🔦'};
    // card = where the callout sits over the 3D stage (percent of the stage box,
    // authored in a 0..60 vertical space matching the stage's 100/60 aspect).
    const layout={ optic:{card:[50,8]}, barrel:{card:[84,30]}, muzzle:{card:[84,52]},
      foregrip:{card:[62,52]}, laser:{card:[38,52]}, magazine:{card:[17,52]}, stock:{card:[15,30]},
      tactical:{card:[62,52]} };
    // available parts per slot from the player's INVENTORY (carried rig/backpack
    // grids + stash). Detection routes each attachment to a gunsmith slot by its
    // EFFECT-def slot (DATA.attachments[id].slot) first, falling back to the item
    // def slot — so a part whose two defs drifted apart (legacy data) still lands
    // in the right slot instead of silently vanishing (the old empty-set bug).
    const avail={}; wDef.slots.forEach(s=>avail[s]=[]);
    const partSlot=def=>{ const eff=DATA.attachments[def.id]; const s=(eff&&eff.slot)||def.slot; return s==='tactical'?'foregrip':s; };
    const grids=[...Inventory.carried(), Inventory.stash()];
    for(const g of grids){ if(!g) continue; for(const t of g.items){ if(t.def.type!=='attachment') continue; const s=partSlot(t.def); if(avail[s]) avail[s].push(t); } }
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
    // [label, current, baseline, betterDirection(+1 higher=better / -1 lower=better)]
    const rows=[
      ['Damage',st.damage,bare.damage,1],['RPM',st.rpm,bare.rpm,1],
      ['Recoil',st.recoil,bare.recoil,-1],['Spread',st.spread,bare.spread,-1],
      ['ADS',st.adsTime,bare.adsTime,-1],['Zoom',st.zoom,bare.zoom,1],
      ['Mag',st.mag,bare.mag,1],['Reload',st.reload,bare.reload,-1],
      ['Range',st.range,bare.range,1],['Velocity',st.velocity,bare.velocity,1],
      ['Handling',st.handling,bare.handling,1],['Mobility',st.mobility,bare.mobility,1],
      ['Hip Acc',st.hipAccuracy,bare.hipAccuracy,1],
    ];
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

  // ---------- REPORT (bug / feature) ----------
  // Mirrors the report widget shipped in Riftspawn/TableForge: a Bug/Feature
  // toggle, a persisted "your name" field, and a message box. Submit POSTs to the
  // Jarvis brain's /report endpoint with triage context (url, version, and the
  // last ~5 console errors captured by the ring buffer installed in index.html).
  // Built from state into #reportCard so it composes with the overlay manager and
  // reuses the game's HUD styling — no new palette, no new dependencies.
  const REPORT_URL='https://jarvis-brain.vgermade721.workers.dev/report';
  const REPORT_NAME_KEY='lootnshoot_report_name';
  let rpType='bug', rpSending=false;
  function openReport(){ rpType='bug'; rpSending=false; openOverlay('ovReport'); renderReport(); setTimeout(()=>{ try{ const n=$('rpName'); (n&&n.value?$('rpText'):n).focus(); }catch(_){} },30); }
  function renderReport(){
    // When signed in, default the name to the account username (and lock it — the
    // report is attributed to the account, with playerUid attached). Signed out /
    // offline falls back to the persisted manual name field exactly as before.
    const acct=Account.current();
    let savedName=''; try{ savedName=localStorage.getItem(REPORT_NAME_KEY)||''; }catch(_){}
    const nameVal = acct ? acct.username : savedName;
    const isBug=rpType==='bug';
    $('reportCard').innerHTML=`<div class="eb">Field Report // Intel</div><h1>Report</h1>
      <p class="sub">Hit a bug or have an idea? Send it straight to command — we read every one.</p>
      <div class="tabs">
        <span class="tab ${isBug?'on':''}" data-rptype="bug">🐞 Bug</span>
        <span class="tab ${isBug?'':'on'}" data-rptype="feature">✦ Feature request</span>
      </div>
      <div class="row" style="border:none;padding:0;display:block">
        <label class="lab" for="rpName" style="display:block;margin-bottom:5px">Your name${acct?' <span style="color:var(--go)">· signed in</span>':''}</label>
        <input id="rpName" type="text" maxlength="40" autocomplete="off" placeholder="Operator…" ${acct?'disabled':''}
          style="width:100%;background:#0c0f12;border:1px solid var(--line);color:var(--text);padding:10px 12px;font-family:var(--mono);font-size:14px;box-sizing:border-box${acct?';opacity:.7':''}">
      </div>
      <div class="row" style="border:none;padding:0;display:block;margin-top:12px">
        <label class="lab" for="rpText" id="rpTextLabel" style="display:block;margin-bottom:5px">${isBug?'What happened?':'What would you like?'}</label>
        <textarea id="rpText" maxlength="2000" rows="4"
          placeholder="${isBug?'The more detail, the faster we can fix it.':'Describe the feature or change you’d love to see.'}"
          style="width:100%;min-height:96px;background:#0c0f12;border:1px solid var(--line);color:var(--text);padding:10px 12px;font-family:var(--mono);font-size:14px;line-height:1.45;resize:vertical;box-sizing:border-box"></textarea>
      </div>
      <div id="rpMsg" style="min-height:18px;font-family:var(--mono);font-size:12px;margin:10px 0 2px;color:var(--dim)"></div>
      <div class="actbtns" style="display:flex;gap:9px;margin-top:6px">
        <div class="btn" id="rpCancel" style="width:auto;margin:0;flex:1;text-align:center"><span class="k">ESC</span> Cancel</div>
        <div class="btn" id="rpSubmit" style="width:auto;margin:0;flex:1;text-align:center"><span class="k">▸</span> Send report</div>
      </div>`;
    $('rpName').value=nameVal;
    $('reportCard').querySelectorAll('[data-rptype]').forEach(b=>b.onclick=()=>{
      if(rpSending) return;
      const t=b.dataset.rptype; if(t===rpType) return;
      // preserve in-progress text/name across the toggle re-render
      const keepName=$('rpName').value, keepText=$('rpText').value;
      rpType=t; renderReport();
      $('rpName').value=keepName; $('rpText').value=keepText;
    });
    $('rpCancel').onclick=closeMenus;
    $('rpSubmit').onclick=submitReport;
  }
  function reportMsg(text,color){ const m=$('rpMsg'); if(m){ m.textContent=text||''; m.style.color=color||'var(--dim)'; } }
  async function submitReport(){
    if(rpSending) return;                         // debounce double-submits
    // Signed in → attribute the report to the account (username + playerUid, which
    // the backend supports). Signed out / offline → the manual name field, persisted
    // as before. The username takes precedence so the field can't drift out of sync.
    const acct=Account.current();
    const name=acct ? acct.username : ($('rpName').value||'').trim();
    const message=($('rpText').value||'').trim();
    if(!message){ reportMsg('Tell us a little about it first.','var(--amber)'); $('rpText').focus(); return; }
    if(!acct){ try{ if(name) localStorage.setItem(REPORT_NAME_KEY,name); }catch(_){} } // only persist the manual name
    rpSending=true; const sub=$('rpSubmit'); if(sub){ sub.classList.add('disabled'); sub.innerHTML='<span class="k">…</span> Sending'; } reportMsg('');
    const payload={
      project:'lootnshoot',
      type:rpType,
      player:name||'anonymous',
      message,
      context:{
        url:location.href,
        version:GAME_VERSION,
        // last ~5 captured console errors, newline-joined (stored server-side as a string)
        console:(typeof window!=='undefined'&&Array.isArray(window.__LNS_ERRLOG)?window.__LNS_ERRLOG.slice(-5).join('\n'):'')
      }
    };
    // account-linked attribution when signed in (backend supports playerUid)
    if(acct) payload.playerUid=acct.uid;
    try{
      const res=await fetch(REPORT_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if(!res.ok) throw new Error('HTTP '+res.status);
      try{ await res.json(); }catch(_){}          // response is {id,status}; not needed
      reportMsg('✓ Submitted — thanks!','var(--go)');
      if(sub) sub.innerHTML='<span class="k">✓</span> Sent';
      setTimeout(()=>{ if($('ovReport').classList.contains('show')) closeMenus(); },1100);
    }catch(_){
      reportMsg('Couldn’t send — please try again.','var(--bad)');
      rpSending=false; if(sub){ sub.classList.remove('disabled'); sub.innerHTML='<span class="k">▸</span> Send report'; }
    }
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
  // Three tabs: Buy (live stock + restock timers), Sell (from stash, builds rep),
  // and Buy-back (re-purchase what you recently sold). A reputation bar sits under
  // the header — higher standing = cheaper buys + deeper, faster-restocking stock.
  let vendorTick=null;
  function openVendor(){ openOverlay('ovVendor'); renderVendor();
    // live countdown for restock timers while the buy tab is open (1s cadence)
    clearInterval(vendorTick);
    vendorTick=setInterval(()=>{ if($('ovVendor').classList.contains('show') && vendorTab==='buy') renderVendor(); else { clearInterval(vendorTick); vendorTick=null; } }, 1000);
  }
  function closeVendor(){ clearInterval(vendorTick); vendorTick=null; closeMenus(); }
  let vendorTab='buy';
  function fmtRestock(s){ if(s<=0) return ''; const m=Math.floor(s/60), ss=String(s%60).padStart(2,'0'); return m?`${m}:${ss}`:`${s}s`; }
  function renderVendor(){
    const cr=S.profile.credits;
    const rep=Vendor.repInfo();
    let body='';
    if(vendorTab==='buy'){
      body=`<div class="shopgrid">`+DATA.vendor.map(id=>{ const d=DATA.items[id]; if(!d) return '';
        const p=Vendor.price(id), si=Vendor.stockInfo(id), out=si.qty<=0, can=cr>=p&&!out;
        const stockLine = out
          ? `<div class="shopmeta" style="color:var(--bad)">Out · ${si.restockIn?'next '+fmtRestock(si.restockIn):'restocking'}</div>`
          : `<div class="shopmeta">Stock ${si.qty}/${si.max}${si.restockIn?` · +1 in ${fmtRestock(si.restockIn)}`:''}</div>`;
        return `<div class="shopcard r-${d.rarity||1}">
          <div class="shopic">${iconFor(d)}</div>
          <div class="shopnm">${d.name}</div><div class="shopmeta">${d.type}${d.size?` · ${d.size[0]}×${d.size[1]}`:''}</div>
          ${stockLine}
          <button class="shopbuy ${can?'':'no'}" data-buy="${id}" ${out?'disabled':''}>${out?'Out':p+'c'}</button></div>`; }).join('')+`</div>`;
    } else if(vendorTab==='sell'){
      const items=Inventory.stash().items;
      const sellTotal=items.reduce((a,it)=>a+Inventory.sellValue(it),0);
      body = items.length ? `<div class="shophead" style="margin:2px 0 10px"><span style="font-family:var(--mono);font-size:11px;color:var(--dim);letter-spacing:1px;text-transform:uppercase;">${items.length} item${items.length>1?'s':''} · ${sellTotal}c total</span><button class="shopbuy sell" id="sellAll" style="width:auto">⇪ Sell all +${sellTotal}c</button></div>`
        + `<div class="shopgrid">`+items.map(it=>`<div class="shopcard r-${it.def.rarity||1}">
          <div class="shopic">${iconFor(it.def)}</div>
          <div class="shopnm">${it.def.name}</div><div class="shopmeta">${it.def.type}${it.qty>1?` · ×${it.qty}`:''}</div>
          <button class="shopbuy sell" data-sell="${it.uid}">+${Inventory.sellValue(it)}c</button></div>`).join('')+`</div>`
        : '<div class="emptyState"><span class="ic">📦</span>Stash is empty — bring back loot from a raid to sell.</div>';
    } else { // buyback
      const list=Vendor.buybackList();
      body = list.length ? `<div class="shopgrid">`+list.map(b=>{ const d=DATA.items[b.id]||{}; const can=cr>=b.price;
        return `<div class="shopcard r-${d.rarity||1}">
          <div class="shopic">${iconFor(d)}</div>
          <div class="shopnm">${b.name}</div><div class="shopmeta">recently sold${b.qty>1?` · ×${b.qty}`:''}</div>
          <button class="shopbuy ${can?'':'no'}" data-bb="${b.uid}">${b.price}c</button></div>`; }).join('')+`</div>`
        : '<div class="emptyState"><span class="ic">↩️</span>Nothing to buy back — items you sell linger here for 30 minutes.</div>';
    }
    // reputation bar (standing + progress to the next tier + the active buy discount)
    const disc=Math.round((1-rep.buyMult)*100);
    const repBar=`<div style="margin:2px 0 14px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-family:var(--mono);font-size:11px;letter-spacing:1px;text-transform:uppercase;">
        <span style="color:var(--amber)">Standing · ${rep.name}${disc>0?` <span style="color:var(--go)">(−${disc}% buys)</span>`:''}</span>
        <span style="color:var(--dim)">${rep.next?`${rep.toNext}c to ${rep.next}`:'Max standing'}</span></div>
      <div style="height:6px;border-radius:4px;background:#0c0f12;border:1px solid var(--line);margin-top:5px;overflow:hidden;">
        <div style="height:100%;width:${Math.round(rep.progress*100)}%;background:linear-gradient(90deg,var(--amber-d),var(--amber));"></div></div></div>`;
    $('vendorCard').innerHTML=`<div class="eb">Black Market // Trader</div>
      <div class="shophead"><h1 style="margin:0">Trade</h1><div class="creditpill">💰 ${cr}c</div></div>
      ${repBar}
      <div class="tabs">
        <button class="tab ${vendorTab==='buy'?'on':''}" data-tab="buy">Buy</button>
        <button class="tab ${vendorTab==='sell'?'on':''}" data-tab="sell">Sell</button>
        <button class="tab ${vendorTab==='buyback'?'on':''}" data-tab="buyback">Buy-back</button>
      </div>
      ${body}
      <div class="btn" id="vClose" style="margin-top:16px;width:auto;display:inline-block"><span class="k">ESC</span> Close</div>`;
    $('vClose').onclick=closeVendor;
    $('vendorCard').querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{ vendorTab=b.dataset.tab; renderVendor(); });
    $('vendorCard').querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>{ Vendor.buy(b.dataset.buy); Audio.play('ui'); renderVendor(); refreshHUD(); });
    $('vendorCard').querySelectorAll('[data-sell]').forEach(b=>b.onclick=()=>{ Vendor.sell(b.dataset.sell*1); Audio.play('pickup'); renderVendor(); refreshHUD(); });
    { const sa=$('sellAll'); if(sa) sa.onclick=()=>{ Vendor.sellAll(); Audio.play('pickup'); renderVendor(); refreshHUD(); }; }
    $('vendorCard').querySelectorAll('[data-bb]').forEach(b=>b.onclick=()=>{ Vendor.buyback(b.dataset.bb); Audio.play('ui'); renderVendor(); refreshHUD(); });
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
    const armed=!!(e.primary||e.secondary);
    const hasMed=medCount()>0, hasPack=!!(e.rig||e.backpack);
    // a soft readiness checklist so the player isn't flung into a raid empty-handed
    const chk=(ok,t)=>`<div class="row"><span>${ok?'✓':'⚠'} ${t}</span><b style="color:${ok?'var(--go)':'var(--amber)'}">${ok?'Ready':'Missing'}</b></div>`;
    $('extractCard').innerHTML=`<div class="eb">Train // Deploy</div><h1>Deploy</h1>
      <p class="sub">Board the train to the first stop. Loot fills your rig and pack; bring meds and ammo. Die in the field and your pack &amp; rig are lost.</p>
      <div class="row"><span>Primary</span><b>${e.primary?e.primary.def.name:'—'}</b></div>
      <div class="row"><span>Secondary</span><b>${e.secondary?e.secondary.def.name:'—'}</b></div>
      <div class="row"><span>Armor</span><b>${e.armor?e.armor.def.name:'none'}</b></div>
      <div style="font-family:var(--mono);font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--amber);margin:14px 0 2px;">Loadout check</div>
      ${chk(armed,'Weapon equipped')}
      ${chk(hasPack,'Rig or pack for loot')}
      ${chk(hasMed,'Med in your kit')}
      ${armed?'':'<div class="emptyState" style="margin-top:12px"><span class="ic">🔫</span>No weapon equipped — gear up at the stash first.</div>'}
      <div class="btn ${armed?'':'disabled'}" id="dGo"><span class="k">▶</span> Board train · Deploy</div>
      <div class="btn" id="dClose"><span class="k">ESC</span> Not yet</div>`;
    $('dGo').onclick=()=>{ if(!armed){ toast('Equip a weapon before deploying','neg'); return; } Raid.deploy(); };
    $('dClose').onclick=closeMenus;
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
  // Full run-summary screen. Raid passes a structured payload (loot banked vs lost,
  // kills, depth, XP, credits, objective + bonus results). A legacy {rows:[[k,v]]}
  // shape is still accepted (falls back to the old plain table) so nothing else that
  // calls showResult breaks. Styled like the existing result card, just fuller.
  function showResult(p){ S.setMode(MODE.RESULT); hideAll(); $('ovResult').classList.add('show');
    const died=!!p.died;
    const head=`<div class="eb">${died?'Raid Report // KIA':'Raid Report // Success'}</div>`
      +`<h1 class="${died?'bad':'good'}">${p.title||(died?'You Died':'Extracted')}</h1>`
      +(p.sub?`<p class="sub">${p.sub}</p>`:'');
    // legacy fallback: just render the supplied rows.
    if(p.rows && !p.loot){
      $('resultCard').innerHTML = head
        + p.rows.map(r=>`<div class="row"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')
        + `<div class="btn" id="rBack" style="margin-top:14px"><span class="k">▶</span> Return to safehouse</div>`;
      $('rBack').onclick=()=>{ hideAll(); S.run=null; World.buildHub(); };
      return;
    }
    const L=p.loot||{carried:0,banked:0,lost:0,mult:1};
    const sec = i=>String.fromCharCode(65+(i||0));
    // inline styles keep this self-contained (no shared stylesheet edit); colors
    // come from the existing palette vars so it matches the result-card aesthetic.
    const col={good:'var(--go)',bad:'var(--bad)',warn:'var(--amber)',neutral:'var(--dim)'};
    const objCol=(p.objective&&col[p.objective.state])||'var(--dim)';
    const secHdr='font-family:var(--mono);font-size:11px;letter-spacing:3px;text-transform:uppercase;color:var(--amber);margin:18px 0 4px;';
    // headline loot banner: green banked on extract, red lost on death.
    const lootBanner = died
      ? `<div style="border:1px solid var(--bad);background:rgba(216,69,62,.1);border-radius:8px;padding:16px 18px;margin:6px 0 4px;text-align:center;">
           <div style="font-family:var(--mono);font-size:11px;letter-spacing:3px;text-transform:uppercase;color:var(--dim);">Loot lost</div>
           <div style="font-family:var(--cond);font-weight:800;font-size:40px;color:var(--bad);line-height:1.1;">−${L.lost}c</div></div>`
      : `<div style="border:1px solid var(--go);background:rgba(87,192,107,.1);border-radius:8px;padding:16px 18px;margin:6px 0 4px;text-align:center;">
           <div style="font-family:var(--mono);font-size:11px;letter-spacing:3px;text-transform:uppercase;color:var(--dim);">Loot banked</div>
           <div style="font-family:var(--cond);font-weight:800;font-size:40px;color:var(--go);line-height:1.1;">+${L.banked}c</div>
           <div style="font-family:var(--mono);font-size:11px;color:var(--dim);margin-top:2px;">${L.carried}c carried × ${(L.mult||1).toFixed(2)} extract bonus</div></div>`;
    // tiles: kills / depth / xp (compact stat grid, reuses the result-card vibe).
    const tileWrap='display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0 4px;';
    const tileCss='border:1px solid var(--line);border-radius:8px;background:linear-gradient(160deg,#11171c,#0b0e12);padding:12px 8px;text-align:center;';
    const tiles=[
      ['Kills', p.kills||0],
      ['Depth', `Sector ${sec(p.maxDepth!=null?p.maxDepth:p.depth)}`],
      ['XP earned', `+${p.xp||0}`],
    ].map(t=>`<div style="${tileCss}"><div style="font-family:var(--cond);font-weight:800;font-size:26px;color:var(--amber);line-height:1;">${t[1]}</div>
       <div style="font-family:var(--mono);font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--dim);margin-top:5px;">${t[0]}</div></div>`).join('');
    // objective + bonus recap.
    const obj = p.objective ? `<div class="row"><span>Objective</span><b style="color:${objCol}">${p.objective.label}</b></div>` : '';
    const bonuses = (p.bonuses&&p.bonuses.length)
      ? p.bonuses.map(b=>`<div class="row"><span>${b.done?'✓':'✗'} ${b.label}</span><b style="color:${b.done?'var(--go)':'var(--dim)'}">${b.done?'+'+b.reward+'c':'—'}</b></div>`).join('')
      : '';
    // credits ledger: before -> after, with the delta.
    const delta=(p.creditsAfter!=null&&p.creditsBefore!=null)?(p.creditsAfter-p.creditsBefore):null;
    const credits = (p.creditsAfter!=null)
      ? `<div class="row"><span>Credits</span><b>${p.creditsBefore!=null?p.creditsBefore+'c → ':''}${p.creditsAfter}c`
        + (delta!=null?` <span style="color:${delta>=0?'var(--go)':'var(--bad)'}">(${delta>=0?'+':''}${delta}c)</span>`:'') + `</b></div>`
      : '';
    $('resultCard').innerHTML = head
      + lootBanner
      + `<div style="${tileWrap}">${tiles}</div>`
      + (obj||bonuses?`<div style="${secHdr}">Objectives</div>${obj}${bonuses}`:'')
      + (credits?`<div style="${secHdr}">Wallet</div>${credits}`:'')
      + `<div class="btn" id="rBack" style="margin-top:16px"><span class="k">▶</span> Return to safehouse</div>`;
    $('rBack').onclick=()=>{ hideAll(); S.run=null; World.buildHub(); };
  }
  let confirmAbandon=false;
  function pause(){ if(S.mode!==MODE.RAID) return; confirmAbandon=false; S.setMode(MODE.PAUSE); hideAll(); $('ovPause').classList.add('show'); renderPause(); }
  function renderPause(){
    const kills=(S.run&&S.run.kills)||0, depth=String.fromCharCode(65+((S.run&&S.run.stopIndex)||0)), bag=(S.run&&S.run.bagValue)||0;
    $('pauseCard').innerHTML=`<div class="eb">Paused</div><h1>Standby</h1><p class="sub">Resume to lock back in, open settings, or abandon the run.</p>
      <div class="row"><span>Sector</span><b>${depth}</b></div>
      <div class="row"><span>Kills</span><b>${kills}</b></div>
      <div class="row"><span>Carried value</span><b>${bag}c</b></div>
      <div class="btn" id="pR"><span class="k">▶</span> Resume</div>
      <div class="btn" id="pS"><span class="k">⚙</span> Settings</div>
      <div class="btn" id="pRep"><span class="k">🐞</span> Report a bug / idea</div>
      <div class="btn" id="pA"><span class="k">✕</span> ${confirmAbandon?'<span style="color:var(--bad)">Confirm abandon — lose carried loot</span>':'Abandon run'}</div>`;
    $('pR').onclick=resume; $('pS').onclick=openSettings; $('pRep').onclick=openReport;
    $('pA').onclick=()=>{ if(!confirmAbandon){ confirmAbandon=true; renderPause(); return; } abandonRun(); };
  }
  // leave the field without banking: carried bag value is forfeit, but you keep your
  // equipped weapons/armor (same as death's gear rules) and walk away alive.
  function abandonRun(){ document.exitPointerLock(); for(const slot of ['rig','backpack']){ const it=S.profile.equip[slot]; if(it&&it.inst&&it.inst.container){ it.inst.container.items=[]; } } hideAll(); S.run=null; Save.save(); World.buildHub(); }
  function resume(){ hideAll(); S.setMode(MODE.RAID); if(!Input.isTouch) GFX.dom.requestPointerLock(); }

  // HUD reactive bindings
  Events.on('player:tick', refreshHUD);
  Events.on('player:changed', refreshHUD);
  Events.on('weapon:changed', refreshHUD);
  Events.on('progress:changed', refreshHUD);
  Events.on('inv:changed', ()=>{ if($('ovInv').classList.contains('show')) renderInventory(); refreshHUD(); });
  Events.on('threats:changed', ()=>{ $('thN').textContent=Enemies.aliveCount(); if(Input.isTouch) refreshTouchHUD(S.player,S.profile); });
  // Account state (sign-in / sign-out / restored session): refresh the menu's
  // account block, and the report form's name field if it's currently open.
  Events.on('account:changed', ()=>{ _acctBusy=false; renderAccount();
    if($('ovReport') && $('ovReport').classList.contains('show')) renderReport(); });

  return { setObjective, prompt, hit, dmgDir, banner, flashReload, toast, refreshHUD, renderStart, toggleInventory, openStation,
           openVendor, openCraft, openSkills, openLoot, openSettings, openMod, openReport, showExtractChoice, showResult, pause, resume, closeMenus };
})();
