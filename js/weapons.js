// weapons.js — SYS: Weapons. Active weapon, attachment-applied stats, reload from
// inventory, ADS, hitscan fire + viewmodel. Reads Input; writes hit damage to
// Enemies via raycast.
import { T } from "./three.js";
import { DATA } from "./data.js";
import { S, MODE, Clock, Events } from "./state.js";
import { GFX } from "./gfx.js";
import { clamp, rarityColor } from "./util.js";
import { fxTracer, FX } from "./fx.js";
import { Audio } from "./audio.js";
import { Progression } from "./progression.js";
import { Input } from "./input.js";
import { UI } from "./ui.js";
import { Perception } from "./perception.js";
import { World } from "./world.js";
import { Enemies } from "./enemies.js";
import { Inventory } from "./inventory.js";
import { Projectiles } from "./projectiles.js";
import { Player } from "./player.js";

export const Weapons = (function(){
  const ray=new T.Raycaster();
  let lastShot=0, reloading=false, reloadEnd=0;
  let gun=null, muzzle=null, attachGroup=null, lastAttachSig='', laserDot=null;
  let prevFire=false, burstLeft=0, recoilDebt=0, bobT=0, swayX=0, swayY=0, lastYaw=0, lastPitch=0;

  function modeOf(it){ const modes=DATA.weapons[it.def.weapon].modes||['auto']; if(!it.inst.mode||!modes.includes(it.inst.mode)) it.inst.mode=modes[0]; return it.inst.mode; }
  function cycleMode(){ const it=activeItem(); if(!it) return; const modes=DATA.weapons[it.def.weapon].modes||['auto']; if(modes.length<2){ UI.toast(modes[0].toUpperCase()+' only','neu'); return; }
    const i=modes.indexOf(modeOf(it)); it.inst.mode=modes[(i+1)%modes.length]; Audio.play('ui'); UI.toast('Fire mode: '+it.inst.mode.toUpperCase(),'neu'); Events.emit('weapon:changed'); }
  function spawnTracer(a,b){ fxTracer(a,b,0xffd27a); }

  function buildViewmodel(){
    const g=new T.Group();
    const m=new T.MeshStandardMaterial({color:0x1c1f22,roughness:.6,metalness:.4});
    const body=new T.Mesh(new T.BoxGeometry(.09,.12,.5),m); body.position.set(.22,-.18,-.55);
    const bar=new T.Mesh(new T.BoxGeometry(.05,.06,.34),m); bar.position.set(.22,-.17,-.85);
    const grip=new T.Mesh(new T.BoxGeometry(.07,.16,.08),m); grip.position.set(.22,-.28,-.42);
    g.add(body,bar,grip);
    attachGroup=new T.Group(); g.add(attachGroup);
    const fm=new T.SpriteMaterial({color:0xffcc55,transparent:true,opacity:0,depthTest:false});
    muzzle=new T.Sprite(fm); muzzle.scale.set(.4,.4,.4); muzzle.position.set(.22,-.17,-1.05); g.add(muzzle);
    GFX.camera.add(g); gun=g;
    // laser dot: a small red sprite that lives in the WORLD (added to the scene,
    // not the camera) so it lands on whatever the muzzle points at. Hidden until
    // a LASER attachment is installed; positioned each frame in update().
    const lm=new T.SpriteMaterial({color:0xff3b30,transparent:true,opacity:0,depthTest:false});
    laserDot=new T.Sprite(lm); laserDot.scale.set(.08,.08,.08); laserDot.visible=false;
    (GFX.scene||GFX.camera.parent||GFX.camera).add(laserDot);
  }
  // rebuild visible attachment meshes from the active weapon's installed mods
  function refreshAttachments(){
    if(!attachGroup || !S.profile) return; const it=activeItem();
    const sig = it ? S.player.activeSlot+'|'+Object.entries(it.inst.attachments||{}).map(a=>a.join(':')).sort().join(',') : '';
    if(sig===lastAttachSig) return; lastAttachSig=sig;
    while(attachGroup.children.length) attachGroup.remove(attachGroup.children[0]);
    if(!it) return; const att=it.inst.attachments||{}; const dark=new T.MeshStandardMaterial({color:0x101316,roughness:.5,metalness:.6});
    if(att.optic){ const scope=att.optic==='att_scope';
      const mount=new T.Mesh(new T.BoxGeometry(.05,.05,scope?.26:.1), dark); mount.position.set(.22,-.10,scope?-.62:-.6); attachGroup.add(mount);
      const lens=new T.Mesh(new T.CylinderGeometry(scope?.045:.03,scope?.045:.03,.04,10), new T.MeshStandardMaterial({color:scope?0x224455:0x551111,emissive:scope?0x113344:0x440808,emissiveIntensity:.6})); lens.rotation.x=Math.PI/2; lens.position.set(.22,-.08,scope?-.5:-.55); attachGroup.add(lens); }
    if(att.muzzle){ const sup=att.muzzle==='att_suppressor'; const dev=new T.Mesh(new T.CylinderGeometry(sup?.04:.05,sup?.04:.05,sup?.2:.1,10), dark); dev.rotation.x=Math.PI/2; dev.position.set(.22,-.17,sup?-1.0:-.95); attachGroup.add(dev); }
    // foregrip (and legacy 'tactical' grips from older saves render the same)
    if(att.foregrip||att.tactical){ const fg=new T.Mesh(new T.BoxGeometry(.05,.1,.06), dark); fg.position.set(.22,-.27,-.72); attachGroup.add(fg); }
    if(att.stock){ const sk=new T.Mesh(new T.BoxGeometry(.06,.08,.22), dark); sk.position.set(.22,-.18,-.18); attachGroup.add(sk); }
    if(att.barrel){ const lng=att.barrel==='att_barrel_long'; const br=new T.Mesh(new T.CylinderGeometry(.022,.022,lng?.34:.12,8), dark); br.rotation.x=Math.PI/2; br.position.set(.22,-.17,lng?-1.1:-.92); attachGroup.add(br); }
    if(att.magazine){ const ext=att.magazine==='att_mag_ext'; const mg=new T.Mesh(new T.BoxGeometry(.05,ext?.2:.12,.05), dark); mg.position.set(.22,ext?-.36:-.32,-.46); attachGroup.add(mg); }
    if(att.laser){ const em=new T.Mesh(new T.BoxGeometry(.03,.03,.07), new T.MeshStandardMaterial({color:0x330000,emissive:0xff2200,emissiveIntensity:.9})); em.position.set(.15,-.2,-.7); attachGroup.add(em); }
  }

  // Build a standalone, CENTERED display model of a weapon item for the preview
  // renderer (gunsmith schematic, later item-inspect). Independent of the
  // first-person viewmodel meshes above — those are offset to the screen corner
  // and tuned for ADS pose; this one is a clean side-profile sized to frame
  // nicely. Procedural (receiver + barrel + magazine + stock + grip) with
  // attachment meshes added per equipped mod, tinted by the part's rarity.
  // Caller owns the returned Group (Preview.dispose frees its geo/materials).
  function buildPreviewModel(item){
    item = item || activeItem();
    const g = new T.Group();
    if(!item) return g;
    const wk = item.def.weapon;
    const long = wk==='dmr', pistol = wk==='pistol', smg = wk==='smg';
    const barrelLen = pistol?0.34 : long?1.5 : smg?0.78 : 1.05;
    const bodyLen   = pistol?0.34 : long?0.7  : smg?0.5  : 0.62;
    const steel = ()=> new T.MeshStandardMaterial({color:0x2a2f34, roughness:.55, metalness:.55});
    const dark  = ()=> new T.MeshStandardMaterial({color:0x14171a, roughness:.5,  metalness:.6});
    // receiver (the gun's "body" box) — model centered roughly on it
    const body = new T.Mesh(new T.BoxGeometry(bodyLen, 0.14, 0.05), steel());
    g.add(body);
    // barrel: a cylinder running forward (+X) out of the receiver front
    const bx = bodyLen/2;
    const barrel = new T.Mesh(new T.CylinderGeometry(pistol?0.022:0.026, pistol?0.022:0.026, barrelLen, 14), steel());
    barrel.rotation.z = Math.PI/2;               // lay the cylinder along X
    barrel.position.set(bx + barrelLen/2, pistol?0.0:0.03, 0);
    g.add(barrel);
    let barrelTip = bx + barrelLen;              // muzzle attaches here (grows with a barrel mod)
    if(!pistol){
      // stock: extends rearward (-X) for long guns
      const stock = new T.Mesh(new T.BoxGeometry(long?0.42:0.3, 0.12, 0.045), dark());
      stock.position.set(-bx - (long?0.21:0.15), -0.01, 0);
      g.add(stock);
    }
    // pistol grip / hand grip, angled down-back
    const grip = new T.Mesh(new T.BoxGeometry(0.07, 0.18, 0.05), dark());
    grip.position.set(-bodyLen*0.18, -0.14, 0);
    grip.rotation.z = -0.28;
    g.add(grip);
    // magazine, hanging below the receiver
    const mag = new T.Mesh(new T.BoxGeometry(0.07, pistol?0.14:0.2, 0.045), dark());
    mag.position.set(pistol?-bodyLen*0.18:0.02, pistol?-0.16:-0.18, 0);
    mag.rotation.z = pistol?-0.28:-0.08;
    g.add(mag);

    // --- equipped attachments (tinted by the part's rarity) ---
    const att = item.inst.attachments || {};
    const tint = id => { const d = DATA.items[id]; return rarityColor(d?d.rarity||1:1); };
    const attMat = id => new T.MeshStandardMaterial({color:tint(id), roughness:.4, metalness:.5});
    if(att.optic){ const scope = att.optic==='att_scope';
      // mount rail + optic body sitting on top of the receiver
      const mount = new T.Mesh(new T.BoxGeometry(scope?0.26:0.1, 0.04, 0.04), dark());
      mount.position.set(0.0, 0.12, 0); g.add(mount);
      const optic = new T.Mesh(new T.CylinderGeometry(scope?0.04:0.03, scope?0.04:0.03, scope?0.22:0.08, 14), attMat(att.optic));
      optic.rotation.z = Math.PI/2; optic.position.set(0.0, 0.17, 0); g.add(optic);
      // glowing lens at the rear of the optic
      const lens = new T.Mesh(new T.CircleGeometry(scope?0.035:0.026, 16),
        new T.MeshStandardMaterial({color:scope?0x224455:0x551111, emissive:scope?0x113344:0x440808, emissiveIntensity:.7, side:T.DoubleSide}));
      lens.rotation.y = -Math.PI/2; lens.position.set(-(scope?0.11:0.04), 0.17, 0); g.add(lens);
    }
    if(att.barrel){ // longer/shorter barrel sleeve over the muzzle end
      const lng = att.barrel==='att_barrel_long'; const len = lng?0.34:0.12;
      const br = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, len, 14), attMat(att.barrel));
      br.rotation.z = Math.PI/2; br.position.set(barrelTip + len/2, pistol?0.0:0.03, 0); g.add(br);
      barrelTip += len;
    }
    if(att.muzzle){ // suppressor / comp / brake on the barrel tip
      const sup = att.muzzle==='att_suppressor';
      const dev = new T.Mesh(new T.CylinderGeometry(sup?0.038:0.05, sup?0.038:0.05, sup?0.2:0.1, 14), attMat(att.muzzle));
      dev.rotation.z = Math.PI/2; dev.position.set(barrelTip + (sup?0.1:0.05), pistol?0.0:0.03, 0); g.add(dev);
    }
    if(att.foregrip||att.tactical){ // foregrip under the barrel (legacy tac too)
      const fg = new T.Mesh(new T.BoxGeometry(0.05, 0.12, 0.05), attMat(att.foregrip||att.tactical));
      fg.position.set(bx + barrelLen*0.32, -0.1, 0); fg.rotation.z = 0.12; g.add(fg);
    }
    if(att.stock && !pistol){ // buttstock extending rearward past the receiver
      const sk = new T.Mesh(new T.BoxGeometry(0.26, 0.1, 0.05), attMat(att.stock));
      sk.position.set(-bx - 0.22, -0.02, 0); g.add(sk);
    }
    if(att.magazine){ // extended/quick mag, replacing the stock mag block
      const ext = att.magazine==='att_mag_ext';
      const mg = new T.Mesh(new T.BoxGeometry(0.075, ext?0.3:0.18, 0.05), attMat(att.magazine));
      mg.position.set(pistol?-bodyLen*0.18:0.02, pistol?-0.2:(ext?-0.24:-0.18), 0);
      mg.rotation.z = pistol?-0.28:-0.08; g.add(mg);
    }
    if(att.laser){ // laser emitter pod + a thin emissive beam line
      const pod = new T.Mesh(new T.BoxGeometry(0.05, 0.05, 0.07), attMat(att.laser));
      pod.position.set(bx + barrelLen*0.2, -0.08, 0.045); g.add(pod);
      const beam = new T.Mesh(new T.CylinderGeometry(0.004, 0.004, barrelLen*0.9, 6),
        new T.MeshStandardMaterial({color:0xff2200, emissive:0xff2200, emissiveIntensity:1.0}));
      beam.rotation.z = Math.PI/2; beam.position.set(bx + barrelLen*0.6, -0.08, 0.045); g.add(beam);
    }
    // tip the whole gun slightly nose-up so the 3/4 auto-rotate reads well
    g.rotation.y = -0.35;
    return g;
  }

  function activeItem(){ return S.profile.equip[S.player.activeSlot]; }
  // computed stats with attachment effects + skill damage.
  // Attachment defs carry `mods` (multiplicative), `add` (additive), `zoom`
  // (sets outright), and flags (`quiet`, `laser`). New 1.0-baselined scalars —
  // handling / mobility / hipAccuracy — default in here so weapons without those
  // mods read clean, and so the gunsmith readout always has a number to show.
  function stats(item){
    item=item||activeItem(); if(!item) return null;
    const base=DATA.weapons[item.def.weapon];
    // defaults for the extended effective-stat set (safe if base omits them)
    const s={ velocity:400, handling:1, mobility:1, hipAccuracy:1, ...base, zoom:base.zoom };
    s.laser=false;
    const att=item.inst.attachments||{};
    for(const slot in att){
      const a=DATA.attachments[att[slot]]; if(!a) continue;
      if(a.mods) for(const k in a.mods) s[k]=(s[k]!=null?s[k]:1)*a.mods[k];
      if(a.add)  for(const k in a.add)  s[k]=(s[k]!=null?s[k]:0)+a.add[k];
      if(a.zoom!=null) s.zoom=a.zoom;
      if(a.laser) s.laser=true;
    }
    s.damage *= Progression.damageMult();
    // hipfire accuracy tightens the (worse) hipfire spread only; ADS untouched
    if(s.hipAccuracy>1) s.spread = s.spread / s.hipAccuracy;
    // clamp to sane floors so stacked mods can't break the gun
    s.mag=Math.max(1, Math.round(s.mag));
    s.recoil=Math.max(0.001, s.recoil); s.spread=Math.max(0.0005, s.spread);
    s.adsSpread=Math.max(0.0002, s.adsSpread); s.adsTime=Math.max(0.06, s.adsTime);
    s.reload=Math.max(0.4, s.reload); s.range=Math.max(8, s.range); s.eff=Math.max(6, s.eff||s.range*0.6);
    s.zoom=clamp(s.zoom||1, 1, 8); s.handling=clamp(s.handling,0.5,2); s.mobility=clamp(s.mobility,0.6,1.6);
    return s;
  }
  function switchTo(slot){ if(!S.profile.equip[slot]) return; S.player.activeSlot=slot; reloading=false; Audio.play('equip'); Events.emit('weapon:changed'); }
  function ammoInMag(){ const it=activeItem(); return it?(it.inst.ammo||0):0; }

  // ===========================================================================
  // AMMO TYPES + MAGAZINE FEED  (feat/lns-ammo-mags)
  // ---------------------------------------------------------------------------
  // The active weapon's instance carries `inst.ammoType` = the id of the loaded
  // round (a key of DATA.ammoTypes). Reload draws THAT type's stack from the
  // player's carried inventory (read-only Grid access); the loaded type modifies
  // every shot (damage / recoil / range + armor penetration). Switching ammo
  // types picks any caliber-matching type the player is carrying.
  //
  // inst.ammo (the integer mag count the HUD reads) stays the source of truth —
  // we never restructure it. ammoType is per-instance runtime state; if a weapon
  // has none yet it defaults to the caliber's FMJ baseline.
  // ===========================================================================

  // the ammo type currently loaded in `it` (defaults to the caliber's FMJ).
  function loadedTypeId(it){
    it = it || activeItem(); if(!it) return null;
    const cal = DATA.weapons[it.def.weapon].cal;
    let id = it.inst.ammoType;
    if(!id || !DATA.ammoTypes[id] || DATA.ammoTypes[id].cal!==cal){
      id = (DATA.ammoDefault && DATA.ammoDefault[cal]) || null;
      it.inst.ammoType = id;
    }
    return id;
  }
  function loadedType(it){ const id=loadedTypeId(it); return id?DATA.ammoTypes[id]:null; }

  // count rounds of a specific ammo item id across the player's carried grids
  // (rig + backpack). Read-only — never mutates the Grid.
  function reserveOfItem(itemId){
    let n=0; for(const g of Inventory.carried()) n += g.count(itemId); return n;
  }
  // pull up to `want` rounds of `itemId` from carried grids (read-only API of the
  // Grid: count/consume). Returns how many were actually taken. Grids are owned by
  // inventory.js; we only call its public consume() — we don't touch its internals.
  function drawFromInventory(itemId, want){
    let got=0;
    for(const g of Inventory.carried()){
      if(got>=want) break;
      const have=g.count(itemId); if(have<=0) continue;
      const take=Math.min(have, want-got);
      if(g.consume(itemId, take)) got+=take;
    }
    return got;
  }
  // all ammo types (DATA.ammoTypes ids) the gun can chamber AND the player has at
  // least one round of in carried inventory. Always includes the currently loaded
  // type (even at zero reserve) so switching can land back on it.
  function availableTypes(it){
    it = it || activeItem(); if(!it) return [];
    const cal = DATA.weapons[it.def.weapon].cal;
    const cur = loadedTypeId(it);
    const out = [];
    for(const id in DATA.ammoTypes){ const t=DATA.ammoTypes[id]; if(t.cal!==cal) continue;
      if(id===cur || reserveOfItem(t.item)>0) out.push(id); }
    return out;
  }
  // total reserve (rounds in inventory) of the currently loaded type — handy for HUD/tooltips
  function reserveOf(it){ const t=loadedType(it); return t?reserveOfItem(t.item):0; }

  // switch the loaded ammo type to `id` (a DATA.ammoTypes key). If the mag held a
  // different type with rounds still in it, those rounds are returned to inventory
  // so you never duplicate or vaporise ammo, then the mag empties — a fresh reload
  // chambers the new type. No-op if the type is already loaded or not chamberable.
  function setAmmo(id){
    const it=activeItem(); if(!it) return false;
    const t=DATA.ammoTypes[id]; if(!t) return false;
    const cal=DATA.weapons[it.def.weapon].cal; if(t.cal!==cal) return false;
    if(loadedTypeId(it)===id) return false;
    // return the old loaded rounds to inventory (best-effort; drop if no room)
    const old=loadedType(it); const inMag=it.inst.ammo||0;
    if(old && inMag>0){ const back=Inventory.newItem(old.item, inMag); if(back) Inventory.addLoot(back); }
    it.inst.ammo=0; it.inst.ammoType=id;
    Audio.play('ui'); UI.toast('Ammo: '+t.label+(reserveOfItem(t.item)>0?'':' (none — reload)'),'neu');
    Events.emit('weapon:changed'); Events.emit('inv:changed');
    return true;
  }
  // cycle to the next caliber-matching ammo type the player is carrying.
  function cycleAmmo(){
    const it=activeItem(); if(!it) return;
    const types=availableTypes(it);
    if(types.length<2){ const t=loadedType(it); UI.toast((t?t.label:'AMMO')+' only — no other rounds','neu'); return; }
    const cur=loadedTypeId(it); const i=types.indexOf(cur);
    setAmmo(types[(i+1)%types.length]);
  }

  function reload(){
    const it=activeItem(); if(!it) return; const st=stats(it);
    if(reloading || it.inst.ammo>=st.mag) return;
    const t=loadedType(it);
    // must have rounds of the loaded type in inventory to top up the mag
    if(t && reserveOfItem(t.item)<=0){
      // try to auto-swap to a type we DO have for this caliber before giving up
      const alt=availableTypes(it).find(id=>id!==loadedTypeId(it) && reserveOfItem(DATA.ammoTypes[id].item)>0);
      if(alt){ setAmmo(alt); }
      else { UI.toast('No '+(t?t.label:'')+' ammo','neg'); Audio.play('ui'); return; }
    }
    reloading=true; reloadEnd=Clock.now + st.reload*Progression.reloadMult(); UI.flashReload('RELOADING…');
  }
  function finishReload(){
    const it=activeItem(); const st=stats(it);
    const t=loadedType(it);
    const need=Math.max(0, st.mag - (it.inst.ammo||0));
    if(t && need>0){
      const got=drawFromInventory(t.item, need);
      it.inst.ammo=(it.inst.ammo||0)+got;
      if(got>0) Events.emit('inv:changed');
    } else if(!t){
      it.inst.ammo=st.mag;   // no ammo-type data (shouldn't happen) -> legacy free top-up
    }
    reloading=false; UI.flashReload(''); Audio.play('reload'); Events.emit('weapon:changed');
  }

  // armor mitigation against an enemy, modulated by the round's penetration.
  // Enemies carry kit.armor / kit.helmet item ids (or null) from Enemies.rollKit.
  // We read the SAME flat damage-reduction the gear system uses (Inventory.gearStat
  // on a throwaway item wrapper), then penetration cancels a fraction of it:
  //   effectiveDr = dr * (1 - pen). headshots hit the helmet dr, body the armor dr.
  // pen=1 (pure AP) ignores armor; pen=0 (pure HP) eats the full reduction. This is
  // exactly the dr model already mitigating PLAYER damage — applied to enemies.
  function armorMult(e, head, pen){
    if(!e || !e.kit) return 1;
    const id = head ? e.kit.helmet : e.kit.armor;
    if(!id) return 1;
    const def = DATA.items[id]; if(!def) return 1;
    let dr = (typeof def.dr==='number') ? def.dr : (def.armor ? def.armor/120 : 0);
    if(dr<=0) return 1;
    const effDr = clamp(dr*(1-clamp(pen!=null?pen:0, 0, 1)), 0, 0.95);
    return 1-effDr;
  }

  function fire(){
    if(reloading) return false; const it=activeItem(); if(!it) return false; const st=stats(it);
    if(it.inst.ammo<=0){ reload(); return false; }
    // active ammo type modifies the shot (damage / pen / range / recoil / tracer)
    const at = loadedType(it) || { dmg:1, pen:0.3, range:1, recoil:1, tracer:false, color:0xffd27a };
    const interval=60/st.rpm;
    if(Clock.now-lastShot<interval) return false;
    lastShot=Clock.now; it.inst.ammo--;
    const suppressed = !!(it.inst.attachments && Object.keys(it.inst.attachments).some(s=>{ const a=DATA.attachments[it.inst.attachments[s]]; return a&&a.quiet; }));
    muzzle.material.opacity=1; muzzle.material.rotation=Math.random()*Math.PI;
    const kick=st.recoil*(at.recoil||1)*(S.player.ads?0.55:1);
    GFX.pitch.rotation.x=clamp(GFX.pitch.rotation.x+kick,-1.5,1.5); recoilDebt+=kick;
    GFX.yaw.rotation.y += (Math.random()-0.5)*kick*0.5;
    // spread
    const spread = S.player.ads?st.adsSpread:st.spread;
    const dir=new T.Vector3(); GFX.camera.getWorldDirection(dir);
    dir.x+=(Math.random()*2-1)*spread; dir.y+=(Math.random()*2-1)*spread; dir.z+=(Math.random()*2-1)*spread; dir.normalize();
    const org=new T.Vector3(); GFX.camera.getWorldPosition(org);
    Perception.shot(org, suppressed); Audio.play(suppressed?'shotSupp':'shot');
    // round range/velocity scales the hitscan reach + falloff window
    const rngMult = at.range||1;
    const range = st.range*rngMult, eff = (st.eff||st.range*0.6)*rngMult;
    ray.set(org,dir); ray.far=range;
    const targets=[...World.solids, ...Enemies.hitMeshes()];
    const hits=ray.intersectObjects(targets,false);
    const endPt = hits.length ? hits[0].point : org.clone().addScaledVector(dir, range);
    const muzzlePt = org.clone().addScaledVector(dir, 0.6); muzzlePt.y-=0.12;
    // tracer: tinted by the round; tracer rounds glow noticeably brighter/longer
    fxTracer(muzzlePt, endPt, at.color||0xffd27a);
    if(hits.length){ const o=hits[0].object; const e=o.userData.enemy;
      if(e&&!e.dead){ const head=o.userData.part==='head'; const d=hits[0].distance;
        const fo = d<=eff?1:clamp(1-(d-eff)/((range-eff)||1)*0.62, 0.38, 1);
        const dmg = st.damage*(at.dmg||1)*(head?2.2:1)*fo*armorMult(e, head, at.pen);
        Enemies.damage(e, dmg); UI.hit(head, e.dead); FX.impact(hits[0].point, 0xcc3322); }
      else FX.impact(hits[0].point, 0xc8c0ac); }
    ray.far=Infinity;
    Events.emit('weapon:changed');
    return true;
  }
  function throwGrenade(){
    const grids=Inventory.carried(); let src=null;
    for(const g of grids){ const t=g.items.find(i=>i.def.id==='nade_frag'); if(t){ src={g,t}; break; } }
    if(!src) { UI.toast('No grenades','neg'); return; }
    src.t.qty--; if(src.t.qty<=0) src.g.remove(src.t.uid);
    Projectiles.spawnGrenade();
    Events.emit('inv:changed');
  }

  // ----- MELEE: quick close-range strike usable with any weapon equipped -----
  // Stamina-gated + cooldowned (DATA.melee). Hitscan straight ahead at melee
  // range; headshot bonus. Drives a brief viewmodel "punch" lunge via meleeAnim.
  let lastMelee=-99, meleeAnim=0, meleeWanted=false;
  // keyboard wiring (kept inside Weapons so input.js stays untouched): the melee
  // bind is read live from settings via Input.code, falling back to DATA.binds.
  // Touch UIs / other callers can also raise the intent through Weapons.melee().
  addEventListener('keydown', e=>{
    if(S.mode!==MODE.RAID) return;
    const code = (Input.code && Input.code('melee')) || (DATA.binds && DATA.binds.melee);
    if(e.code===code && !e.repeat) meleeWanted=true;
  });
  // ammo-type switch: cycles the loaded round through caliber-matching types the
  // player carries. Wired here (input.js is owned by another agent this round) —
  // honors a rebindable 'ammotype' bind if one exists, else defaults to KeyX.
  addEventListener('keydown', e=>{
    if(S.mode!==MODE.RAID) return;
    const code = (Input.code && Input.code('ammotype')) || (DATA.binds && DATA.binds.ammotype) || 'KeyX';
    if(e.code===code && !e.repeat) cycleAmmo();
  });
  function canMelee(){ return S.mode===MODE.RAID && (Clock.now-lastMelee)>=DATA.melee.cooldown && S.player.stamina>=DATA.melee.minStamina; }
  function melee(){
    const M=DATA.melee;
    if(S.mode!==MODE.RAID) return false;
    if((Clock.now-lastMelee)<M.cooldown) return false;
    if(S.player.stamina<M.minStamina){ UI.toast('Too exhausted','neg'); return false; }
    lastMelee=Clock.now; meleeAnim=1;
    S.player.stamina=Math.max(0, S.player.stamina-M.stamina);
    Events.emit('player:changed');
    const dir=new T.Vector3(); GFX.camera.getWorldDirection(dir);
    const org=new T.Vector3(); GFX.camera.getWorldPosition(org);
    Perception.shot(org, true);              // a swing is quiet but not silent
    Audio.play('equip');                     // reuse the thock-y equip blip
    ray.set(org,dir); ray.far=M.range;
    const targets=[...World.solids, ...Enemies.hitMeshes()];
    const hits=ray.intersectObjects(targets,false);
    ray.far=Infinity;
    if(hits.length){ const o=hits[0].object; const e=o.userData.enemy;
      if(e&&!e.dead){ const head=o.userData.part==='head';
        Enemies.damage(e, M.damage*(head?M.headMult:1)); UI.hit(head, e.dead); FX.impact(hits[0].point, 0xffe08a); }
      else FX.impact(hits[0].point, 0xc8c0ac); }
    return true;
  }

  function update(dt){
    refreshAttachments();
    if(muzzle && muzzle.material.opacity>0) muzzle.material.opacity=Math.max(0,muzzle.material.opacity-dt*12);
    if(reloading && Clock.now>=reloadEnd) finishReload();
    // recoil recovery: spring the kicked aim back down
    if(recoilDebt>0.0001){ const rec=recoilDebt*Math.min(1,dt*7); GFX.pitch.rotation.x=clamp(GFX.pitch.rotation.x-rec,-1.5,1.5); recoilDebt-=rec; } else recoilDebt=0;
    if(S.mode!==MODE.RAID){ prevFire=false; burstLeft=0; return; }
    const it=activeItem();
    const wantFire = Input.firing && (Input.locked||Input.isTouch) && !!it;
    const mode = it?modeOf(it):'auto';
    if(wantFire && !prevFire){ if(mode==='semi') fire(); else if(mode==='burst') burstLeft=3; }
    if(mode==='auto' && wantFire) fire();
    if(burstLeft>0){ if(fire()) burstLeft--; if(!Input.firing && !Input.isTouch) burstLeft=0; }
    prevFire=wantFire;
    // melee strike: discrete intent flag raised by the keydown/touch handler below
    if(meleeWanted){ meleeWanted=false; melee(); }
    if(meleeAnim>0) meleeAnim=Math.max(0, meleeAnim-dt*4.5);
    // ---- viewmodel: ADS pose, head bob, look-sway, wall pushback, reload dip ----
    if(gun){
      const moving = Player.isMoving&&Player.isMoving(); const ads=S.player.ads;
      const stv = it?stats(it):null; const handling = stv?stv.handling:1;
      bobT += dt*(moving?9:3);
      const dy=GFX.yaw.rotation.y-lastYaw, dp=GFX.pitch.rotation.x-lastPitch; lastYaw=GFX.yaw.rotation.y; lastPitch=GFX.pitch.rotation.x;
      swayX += (clamp(-dy*0.55,-0.045,0.045)-swayX)*Math.min(1,dt*9);
      swayY += (clamp(dp*0.55,-0.045,0.045)-swayY)*Math.min(1,dt*9);
      // wall pushback: short forward ray lowers/retracts the gun
      const fdir=new T.Vector3(); GFX.camera.getWorldDirection(fdir); const forg=new T.Vector3(); GFX.camera.getWorldPosition(forg);
      ray.set(forg,fdir); ray.far=1.15; const wh=ray.intersectObjects(World.solids,false); ray.far=Infinity;
      const wall = wh.length? clamp(1-wh[0].distance/1.15,0,1):0;
      // target pose: hip (meshes already sit lower-right) vs ADS (centered + raised)
      let tx = ads?-0.22:0.0, ty = ads?0.12:0.0, tz = ads?-0.05:0.0, trx=0;
      tx += swayX*(ads?0.25:1); ty += swayY*(ads?0.25:1);
      ty -= wall*0.13; tz += wall*0.17; trx += wall*0.5;
      if(reloading){ const st2=stats(it); const dur=(st2?st2.reload:1)*Progression.reloadMult(); const prog=clamp(1-(reloadEnd-Clock.now)/Math.max(0.01,dur),0,1); const dip=Math.sin(prog*Math.PI); ty-=dip*0.14; tz+=dip*0.04; trx+=dip*0.8; }
      // melee lunge: a quick forward jab + downward rotation, eased by meleeAnim
      if(meleeAnim>0){ const j=Math.sin(meleeAnim*Math.PI); tz-=j*0.34; tx+=j*0.06; trx-=j*0.7; }
      // handling raises the pose-settle speed (better handling = snappier ADS)
      const k=Math.min(1,dt*(ads?16:9)*handling);
      gun.position.x += (tx-gun.position.x)*k; gun.position.y += (ty-gun.position.y)*k; gun.position.z += (tz-gun.position.z)*k;
      gun.rotation.x += (trx-gun.rotation.x)*Math.min(1,dt*12);
      const hb=moving?1:0;
      GFX.camera.position.x += (Math.sin(bobT*0.5)*0.014*hb - GFX.camera.position.x)*Math.min(1,dt*8);
      GFX.camera.position.y += (Math.abs(Math.sin(bobT))*0.02*hb - GFX.camera.position.y)*Math.min(1,dt*8);
    }
    // dynamic crosshair: spread + ADS + movement
    const st = it?stats(it):null; let gap=6;
    if(st){ gap = (S.player.ads?2.5:6) + (st.spread*420) + (Player.isMoving&&Player.isMoving()?5:0) + recoilDebt*60; }
    const ch=document.getElementById('crosshair'); if(ch) ch.style.setProperty('--g', Math.min(26,gap).toFixed(1)+'px');
    // laser dot: project to the first solid the muzzle line hits (LASER mod only)
    if(laserDot){
      const on = !!(st && st.laser);
      laserDot.visible = on;
      if(on){
        const ld=new T.Vector3(); GFX.camera.getWorldDirection(ld);
        const lo=new T.Vector3(); GFX.camera.getWorldPosition(lo);
        ray.set(lo,ld); ray.far=120;
        const lh=ray.intersectObjects([...World.solids, ...Enemies.hitMeshes()],false); ray.far=Infinity;
        const pt = lh.length ? lh[0].point : lo.clone().addScaledVector(ld, 60);
        laserDot.position.copy(pt);
        const d = lo.distanceTo(pt); laserDot.scale.setScalar(clamp(0.02+d*0.0016, 0.03, 0.3));
        laserDot.material.opacity = S.player.ads?0.35:0.85;   // dimmer when scoped
      }
    }
    // ADS fov lerp
    const want = S.player.ads ? GFX.baseFov/((st&&st.zoom)||1.3) : GFX.baseFov;
    GFX.camera.fov += (want-GFX.camera.fov)*Math.min(1,dt*12); GFX.camera.updateProjectionMatrix();
    S.player.ads = Input.ads;
  }
  return { buildViewmodel, buildPreviewModel, stats, activeItem, switchTo, ammoInMag, reload, fire, throwGrenade, cycleMode, modeOf, melee, canMelee, update,
    // ammo-type / magazine-feed API (feat/lns-ammo-mags)
    loadedType, loadedTypeId, availableTypes, reserveOf, setAmmo, cycleAmmo };
})();
