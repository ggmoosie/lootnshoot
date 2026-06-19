// weapons.js — SYS: Weapons. Active weapon, attachment-applied stats, reload from
// inventory, ADS, hitscan fire + viewmodel. Reads Input; writes hit damage to
// Enemies via raycast.
import { T } from "./three.js";
import { DATA } from "./data.js";
import { S, MODE, Clock, Events } from "./state.js";
import { GFX } from "./gfx.js";
import { clamp } from "./util.js";
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
  let gun=null, muzzle=null, attachGroup=null, lastAttachSig='';
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
    if(att.muzzle){ const sup=new T.Mesh(new T.CylinderGeometry(.04,.04,.2,10), dark); sup.rotation.x=Math.PI/2; sup.position.set(.22,-.17,-1.0); attachGroup.add(sup); }
    if(att.tactical){ const fg=new T.Mesh(new T.BoxGeometry(.05,.1,.06), dark); fg.position.set(.22,-.27,-.72); attachGroup.add(fg); }
  }

  function activeItem(){ return S.profile.equip[S.player.activeSlot]; }
  // computed stats with attachment multipliers + skill damage
  function stats(item){
    item=item||activeItem(); if(!item) return null;
    const base=DATA.weapons[item.def.weapon];
    const s={...base, zoom:base.zoom};
    const att=item.inst.attachments||{};
    for(const slot in att){
      const a=DATA.attachments[att[slot]]; if(!a) continue;
      if(a.mods) for(const k in a.mods) s[k]=(s[k]!=null?s[k]:1)*a.mods[k];
      if(a.zoom) s.zoom=a.zoom;
    }
    s.damage *= Progression.damageMult();
    return s;
  }
  function switchTo(slot){ if(!S.profile.equip[slot]) return; S.player.activeSlot=slot; reloading=false; Audio.play('equip'); Events.emit('weapon:changed'); }
  function ammoInMag(){ const it=activeItem(); return it?(it.inst.ammo||0):0; }

  function reload(){
    const it=activeItem(); if(!it) return; const st=stats(it);
    if(reloading || it.inst.ammo>=st.mag) return;
    // ammo is unlimited in this build — you just have to reload the mag
    reloading=true; reloadEnd=Clock.now + st.reload*Progression.reloadMult(); UI.flashReload('RELOADING…');
  }
  function finishReload(){
    const it=activeItem(); const st=stats(it);
    it.inst.ammo=st.mag; reloading=false; UI.flashReload(''); Audio.play('reload'); Events.emit('weapon:changed');
  }

  function fire(){
    if(reloading) return false; const it=activeItem(); if(!it) return false; const st=stats(it);
    if(it.inst.ammo<=0){ reload(); return false; }
    const interval=60/st.rpm;
    if(Clock.now-lastShot<interval) return false;
    lastShot=Clock.now; it.inst.ammo--;
    const suppressed = !!(it.inst.attachments && Object.keys(it.inst.attachments).some(s=>{ const a=DATA.attachments[it.inst.attachments[s]]; return a&&a.quiet; }));
    muzzle.material.opacity=1; muzzle.material.rotation=Math.random()*Math.PI;
    const kick=st.recoil*(S.player.ads?0.55:1);
    GFX.pitch.rotation.x=clamp(GFX.pitch.rotation.x+kick,-1.5,1.5); recoilDebt+=kick;
    GFX.yaw.rotation.y += (Math.random()-0.5)*kick*0.5;
    // spread
    const spread = S.player.ads?st.adsSpread:st.spread;
    const dir=new T.Vector3(); GFX.camera.getWorldDirection(dir);
    dir.x+=(Math.random()*2-1)*spread; dir.y+=(Math.random()*2-1)*spread; dir.z+=(Math.random()*2-1)*spread; dir.normalize();
    const org=new T.Vector3(); GFX.camera.getWorldPosition(org);
    Perception.shot(org, suppressed); Audio.play(suppressed?'shotSupp':'shot');
    ray.set(org,dir); ray.far=st.range;
    const targets=[...World.solids, ...Enemies.hitMeshes()];
    const hits=ray.intersectObjects(targets,false);
    const endPt = hits.length ? hits[0].point : org.clone().addScaledVector(dir, st.range);
    const muzzlePt = org.clone().addScaledVector(dir, 0.6); muzzlePt.y-=0.12;
    spawnTracer(muzzlePt, endPt);
    if(hits.length){ const o=hits[0].object; const e=o.userData.enemy;
      if(e&&!e.dead){ const head=o.userData.part==='head'; const d=hits[0].distance; const eff=st.eff||st.range*0.6;
        const fo = d<=eff?1:clamp(1-(d-eff)/((st.range-eff)||1)*0.62, 0.38, 1);
        Enemies.damage(e, st.damage*(head?2.2:1)*fo); UI.hit(head, e.dead); FX.impact(hits[0].point, 0xcc3322); }
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
    // ---- viewmodel: ADS pose, head bob, look-sway, wall pushback, reload dip ----
    if(gun){
      const moving = Player.isMoving&&Player.isMoving(); const ads=S.player.ads;
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
      const k=Math.min(1,dt*(ads?16:9));
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
    // ADS fov lerp
    const want = S.player.ads ? GFX.baseFov/((stats()&&stats().zoom)||1.3) : GFX.baseFov;
    GFX.camera.fov += (want-GFX.camera.fov)*Math.min(1,dt*12); GFX.camera.updateProjectionMatrix();
    S.player.ads = Input.ads;
  }
  return { buildViewmodel, stats, activeItem, switchTo, ammoInMag, reload, fire, throwGrenade, cycleMode, modeOf, update };
})();
