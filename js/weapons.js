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
  let gun=null, muzzle=null, attachGroup=null, lastAttachSig='', laserDot=null, ironSight=null;
  // local-space point (in the gun group) of the ACTIVE sight the player aims through:
  // the installed optic's reticle housing, or the built-in iron sight. ADS aligns
  // THIS point to screen centre so you look through the optic, not the off-bore body.
  let sightLocal=new T.Vector3(.22,-.08,-.55);
  let prevFire=false, burstLeft=0, recoilDebt=0, bobT=0, bobX=0, bobY=0, swayX=0, swayY=0, lastYaw=0, lastPitch=0;
  // ---- holster / draw state (feat/lns-weapons) ----
  // Weapons SPAWN HOLSTERED. `holstered` gates fire/ADS and drops the viewmodel
  // to a lowered carry pose. `drawAnim`/`holsterAnim`/`swapAnim` are 0..1 timers
  // that drive the equip / unequip / swap viewmodel animation PLACEHOLDERS in
  // update() (visual stubs/hooks — real animation art can replace the math later).
  let holstered=true, drawAnim=0, holsterAnim=0, swapAnim=0, reticleEl=null;
  // ---- LASER toggle + continuous beam (feat/weapon-camera-feel) ----------------
  // laserOn = player intent (toggled by the bound key). The beam only RENDERS when
  // the gun also has a laser attachment installed (st.laser). `laserBeam` is a thin
  // emissive cylinder reused frame-to-frame (oriented/scaled, never re-created) that
  // runs muzzle→hit-point; `laserDot` (built below) caps the hit end.
  let laserOn=true, laserBeam=null;
  // ---- SCOPE overlay (feat/weapon-camera-feel) ---------------------------------
  // A screen-space black-vignette circle shown only while ADS through a MAGNIFYING
  // (crosshair-reticle) optic — the round "scope view" the zoomed image sits inside.
  // Built once on demand, like the reticle. Distinct from red-dot/holo (no overlay).
  let scopeEl=null;

  // shared soft-glow sprite texture: a radial-gradient dot baked once into a canvas
  // and reused for every emissive glow (red-dot/holo center, laser hit dot). Gives a
  // translucent halo'd glow instead of a hard-edged solid mesh. Cached module-wide.
  let _glowTex=null;
  function glowTexture(){
    if(_glowTex) return _glowTex;
    const c=document.createElement('canvas'); c.width=c.height=64; const x=c.getContext('2d');
    const g=x.createRadialGradient(32,32,0,32,32,32);
    g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.35,'rgba(255,255,255,0.55)');
    g.addColorStop(0.7,'rgba(255,255,255,0.12)'); g.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=g; x.beginPath(); x.arc(32,32,32,0,Math.PI*2); x.fill();
    _glowTex=new T.CanvasTexture(c); return _glowTex;
  }

  function modeOf(it){ const modes=DATA.weapons[it.def.weapon].modes||['auto']; if(!it.inst.mode||!modes.includes(it.inst.mode)) it.inst.mode=modes[0]; return it.inst.mode; }
  function cycleMode(){ const it=activeItem(); if(!it) return; const modes=DATA.weapons[it.def.weapon].modes||['auto']; if(modes.length<2){ UI.toast(modes[0].toUpperCase()+' only','neu'); return; }
    const i=modes.indexOf(modeOf(it)); it.inst.mode=modes[(i+1)%modes.length]; Audio.play('ui'); UI.toast('Fire mode: '+it.inst.mode.toUpperCase(),'neu'); Events.emit('weapon:changed'); }
  function spawnTracer(a,b){ fxTracer(a,b,0xffd27a); }

  // shared viewmodel materials (one each, reused by every per-class body — no
  // per-build allocation). Steel = receiver/slide, dark = barrel/grip/furniture.
  const VM_STEEL=new T.MeshStandardMaterial({color:0x1c1f22,roughness:.6,metalness:.4});
  const VM_DARK =new T.MeshStandardMaterial({color:0x14171a,roughness:.5,metalness:.55});
  // the per-class BODY meshes live in their own group so refreshAttachments can swap
  // the silhouette when the held weapon class changes (the camera-attached `gun`
  // group, iron sights, muzzle, attachGroup + laserDot are built ONCE and kept).
  let bodyGroup=null, lastBodyClass='';
  // ---- PER-CLASS VIEWMODELS (feat/weapon-camera-feel) --------------------------
  // Procedurally builds a DISTINCT first-person silhouette per weapon class so a
  // pistol, SMG, rifle, shotgun and sniper don't all share one box. Same screen
  // anchor (.22 right, lowered, bore at z≈-.55) so ADS/iron-sight alignment +
  // sightLocal math are untouched — only the body shape varies. Box-built to match
  // the existing low-poly look; geometry is fresh per swap but bounded + disposed.
  function classFor(wk){
    // collapse the weapon zoo into 5 visual archetypes
    if(wk==='pistol'||wk==='machpistol') return 'pistol';
    if(wk==='smg'||wk==='mp5') return 'smg';
    if(wk==='shotgun') return 'shotgun';
    if(wk==='dmr'||wk==='bolt') return 'sniper';
    return 'rifle';  // carbine / ak / bullpup / lmg + any unknown
  }
  function mesh(geo, mat, x,y,z, rx,ry,rz){ const m=new T.Mesh(geo, mat||VM_DARK); m.position.set(x,y,z); if(rx)m.rotation.x=rx; if(ry)m.rotation.y=ry; if(rz)m.rotation.z=rz; return m; }
  function buildBody(cls){
    const grp=new T.Group(); const X=.22;
    const add=(...m)=>grp.add(...m);
    if(cls==='pistol'){
      // compact slide + short barrel + steep grip; sits a touch higher/closer
      add(mesh(new T.BoxGeometry(.07,.085,.26), VM_STEEL, X,-.165,-.5));
      add(mesh(new T.BoxGeometry(.045,.05,.16), VM_DARK,  X,-.155,-.66));   // short barrel shroud
      add(mesh(new T.BoxGeometry(.06,.15,.07),  VM_DARK,  X,-.27,-.46, -.32)); // angled grip
    } else if(cls==='smg'){
      // small boxy receiver, stubby barrel, vertical-ish grip + a hint of a stock
      add(mesh(new T.BoxGeometry(.075,.11,.34), VM_STEEL, X,-.175,-.5));
      add(mesh(new T.BoxGeometry(.04,.05,.24),  VM_DARK,  X,-.165,-.78));
      add(mesh(new T.BoxGeometry(.065,.155,.075),VM_DARK, X,-.275,-.43, -.18));
      add(mesh(new T.BoxGeometry(.05,.06,.14),  VM_DARK,  X,-.165,-.34));   // collapsed stub stock
    } else if(cls==='shotgun'){
      // chunky receiver, fat barrel + a pump under the barrel, full stock
      add(mesh(new T.BoxGeometry(.085,.1,.46),  VM_STEEL, X,-.175,-.55));
      add(mesh(new T.CylinderGeometry(.03,.03,.5,10), VM_DARK, X,-.15,-.86, Math.PI/2));      // wide barrel
      add(mesh(new T.BoxGeometry(.045,.05,.16), VM_DARK,  X,-.225,-.78));   // pump fore-end
      add(mesh(new T.BoxGeometry(.06,.16,.08),  VM_DARK,  X,-.28,-.44, -.22));
      add(mesh(new T.BoxGeometry(.055,.085,.24),VM_DARK,  X,-.185,-.26));   // full stock
    } else if(cls==='sniper'){
      // long thin receiver, very long barrel, prominent cheek-riser stock
      add(mesh(new T.BoxGeometry(.07,.11,.6),   VM_STEEL, X,-.17,-.6));
      add(mesh(new T.CylinderGeometry(.018,.018,.6,10), VM_DARK, X,-.155,-1.06, Math.PI/2)); // long barrel
      add(mesh(new T.BoxGeometry(.06,.165,.075),VM_DARK,  X,-.28,-.46, -.12));
      add(mesh(new T.BoxGeometry(.06,.12,.3),   VM_DARK,  X,-.2,-.2));       // long stock w/ riser
      add(mesh(new T.BoxGeometry(.05,.04,.14),  VM_DARK,  X,-.115,-.22));    // cheek riser
    } else { // rifle
      // mid receiver + handguard + barrel + carry-handle-ish top + standard grip/stock
      add(mesh(new T.BoxGeometry(.085,.12,.5),  VM_STEEL, X,-.18,-.55));
      add(mesh(new T.BoxGeometry(.05,.06,.34),  VM_DARK,  X,-.17,-.85));     // handguard/barrel bar
      add(mesh(new T.BoxGeometry(.07,.16,.08),  VM_DARK,  X,-.28,-.42, -.1));// grip
      add(mesh(new T.BoxGeometry(.055,.09,.2),  VM_DARK,  X,-.185,-.24));    // stock
    }
    return grp;
  }
  function refreshBody(it){
    const cls = it ? classFor(it.def.weapon) : '';
    if(cls===lastBodyClass) return; lastBodyClass=cls;
    if(bodyGroup){ // dispose the old silhouette's geometry (materials are shared)
      gun.remove(bodyGroup);
      bodyGroup.traverse(o=>{ if(o.geometry){ try{o.geometry.dispose();}catch(e){} } });
      bodyGroup=null;
    }
    if(!cls) return;
    bodyGroup=buildBody(cls); gun.add(bodyGroup);
  }

  function buildViewmodel(){
    const g=new T.Group();
    // body silhouette is built per-class on first refresh (refreshBody); the group
    // is created empty here and populated once a weapon is active.
    gun=g;
    // ---- built-in IRON SIGHTS (front post + rear notch on top of the receiver) ----
    // A small group sitting just above the bore. Shown by default; HIDDEN whenever an
    // optic is installed (refreshAttachments toggles it). ADS aligns the FRONT POST
    // tip to screen centre so bare-gun aiming looks down the irons, not the off-bore
    // body. Kept thin/dark so it reads as sights, not bulk.
    ironSight=new T.Group();
    const ironMat=new T.MeshStandardMaterial({color:0x0c0e10,roughness:.5,metalness:.6});
    const frontPost=new T.Mesh(new T.BoxGeometry(.006,.05,.01), ironMat); frontPost.position.set(.22,-.085,-.92);
    const frontRing=new T.Mesh(new T.BoxGeometry(.05,.012,.01), ironMat); frontRing.position.set(.22,-.115,-.92);
    const rearL=new T.Mesh(new T.BoxGeometry(.012,.03,.01), ironMat); rearL.position.set(.205,-.095,-.5);
    const rearR=new T.Mesh(new T.BoxGeometry(.012,.03,.01), ironMat); rearR.position.set(.235,-.095,-.5);
    const rearBase=new T.Mesh(new T.BoxGeometry(.06,.012,.012), ironMat); rearBase.position.set(.22,-.108,-.5);
    ironSight.add(frontPost,frontRing,rearL,rearR,rearBase); g.add(ironSight);
    attachGroup=new T.Group(); g.add(attachGroup);
    const fm=new T.SpriteMaterial({color:0xffcc55,transparent:true,opacity:0,depthTest:false});
    muzzle=new T.Sprite(fm); muzzle.scale.set(.4,.4,.4); muzzle.position.set(.22,-.17,-1.05); g.add(muzzle);
    GFX.camera.add(g); gun=g;
    // start in the HOLSTERED carry pose (lowered + tilted) so the weapon reads as
    // put-away on spawn / in the safehouse before the first draw. update() drives
    // the pose once in a raid; this seeds the resting holstered look beforehand.
    g.position.set(0,-0.5,0.22); g.rotation.x=1.1;
    // laser dot: a soft GLOWING sprite that lives in the WORLD (added to the scene,
    // not the camera) so it lands on whatever the muzzle points at. Hidden until a
    // LASER attachment is installed AND the laser is toggled on; placed each frame.
    const lm=new T.SpriteMaterial({map:glowTexture(),color:0xff3b30,transparent:true,opacity:0,blending:T.AdditiveBlending,depthTest:false,depthWrite:false});
    laserDot=new T.Sprite(lm); laserDot.scale.set(.08,.08,.08); laserDot.visible=false;
    (GFX.scene||GFX.camera.parent||GFX.camera).add(laserDot);
    // CONSTANT laser BEAM: a unit-length emissive cylinder (1 unit tall along its
    // local +Y) reused every frame — update() points/scales it from muzzle→hit so
    // there's no per-frame geometry churn. Lives in the world like the dot.
    laserBeam=new T.Mesh(new T.CylinderGeometry(.006,.006,1,6),
      new T.MeshBasicMaterial({color:0xff3b30,transparent:true,opacity:.5,blending:T.AdditiveBlending,depthWrite:false}));
    laserBeam.visible=false;
    (GFX.scene||GFX.camera.parent||GFX.camera).add(laserBeam);
  }
  // rebuild visible attachment meshes from the active weapon's installed mods
  function refreshAttachments(){
    if(!attachGroup || !S.profile) return; const it=activeItem();
    const sig = it ? S.player.activeSlot+'|'+Object.entries(it.inst.attachments||{}).map(a=>a.join(':')).sort().join(',') : '';
    if(sig===lastAttachSig) return; lastAttachSig=sig;
    refreshBody(it);   // swap the per-class body silhouette if the weapon class changed
    while(attachGroup.children.length) attachGroup.remove(attachGroup.children[0]);
    if(!it){ if(ironSight) ironSight.visible=true; sightLocal.set(.22,-.095,-.5); return; }
    const att=it.inst.attachments||{}; const dark=new T.MeshStandardMaterial({color:0x101316,roughness:.5,metalness:.6});
    // IRON SIGHTS are the bare-gun sight picture — hide them the moment an optic is
    // installed (you aim through the optic instead), show them again when it's off.
    if(ironSight) ironSight.visible = !att.optic;
    // default the ADS aim point to the iron sight's rear notch; an optic overrides it.
    sightLocal.set(.22,-.095,-.5);
    if(att.optic){ const opEff=DATA.attachments[att.optic]; const scope=(opEff&&opEff.reticle)?opEff.reticle==='crosshair':att.optic==='att_scope';
      const mount=new T.Mesh(new T.BoxGeometry(.05,.05,scope?.26:.1), dark); mount.position.set(.22,-.10,scope?-.62:-.6); attachGroup.add(mount);
      if(scope){
        const lens=new T.Mesh(new T.CylinderGeometry(.045,.045,.04,12), new T.MeshStandardMaterial({color:0x224455,emissive:0x113344,emissiveIntensity:.6})); lens.rotation.x=Math.PI/2; lens.position.set(.22,-.08,-.5); attachGroup.add(lens);
        sightLocal.set(.22,-.08,-.5);   // aim through the scope lens centre
      } else {
        // RED-DOT / HOLO: a SLEEK low-profile optic — a thin open ring frame on a
        // slim base, with a soft GLOWING TRANSLUCENT center dot (an additive glow
        // sprite, not a solid opaque sphere). Reads as a real holosight, not a brick.
        const eff=DATA.attachments[att.optic]; const dot=parseInt((eff&&eff.reticleColor||'#ff3b30').slice(1),16)||0xff3b30;
        const holo = (eff&&eff.name||att.optic||'').toString().toLowerCase().includes('holo') || att.optic==='att_holo';
        // thinner torus tube (.008 → .004) + more segments = a sleeker, rounder ring
        const ring=new T.Mesh(new T.TorusGeometry(holo?.034:.028,.004,10,24), dark); ring.position.set(.22,-.075,-.55); attachGroup.add(ring);
        // a slim mounting base under the ring so it doesn't float (low-profile, not blocky)
        const base=new T.Mesh(new T.BoxGeometry(.022,.02,.05), dark); base.position.set(.22,-.10,-.55); attachGroup.add(base);
        // glowing translucent center dot: additive sprite with the reticle tint + a
        // subtle wider halo behind it. Soft-edged + see-through, never depth-tested.
        const dotMat=new T.SpriteMaterial({map:glowTexture(),color:dot,transparent:true,opacity:.95,blending:T.AdditiveBlending,depthTest:false,depthWrite:false});
        const dotSp=new T.Sprite(dotMat); dotSp.scale.set(.012,.012,.012); dotSp.position.set(.22,-.075,-.552); attachGroup.add(dotSp);
        const haloMat=new T.SpriteMaterial({map:glowTexture(),color:dot,transparent:true,opacity:.28,blending:T.AdditiveBlending,depthTest:false,depthWrite:false});
        const halo=new T.Sprite(haloMat); halo.scale.set(.03,.03,.03); halo.position.set(.22,-.075,-.553); attachGroup.add(halo);
        sightLocal.set(.22,-.075,-.55);  // aim through the red-dot/holo reticle centre
      }
    }
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
    if(att.optic){ const opEff = DATA.attachments[att.optic]; const scope = (opEff&&opEff.reticle)?opEff.reticle==='crosshair':att.optic==='att_scope';
      // mount rail + optic body sitting on top of the receiver
      const mount = new T.Mesh(new T.BoxGeometry(scope?0.26:0.1, 0.04, 0.04), dark());
      mount.position.set(0.0, 0.12, 0); g.add(mount);
      if(scope){
        const optic = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 0.22, 14), attMat(att.optic));
        optic.rotation.z = Math.PI/2; optic.position.set(0.0, 0.17, 0); g.add(optic);
        // glowing lens at the rear of the scope
        const lens = new T.Mesh(new T.CircleGeometry(0.035, 16),
          new T.MeshStandardMaterial({color:0x224455, emissive:0x113344, emissiveIntensity:.7, side:T.DoubleSide}));
        lens.rotation.y = -Math.PI/2; lens.position.set(-0.11, 0.17, 0); g.add(lens);
      } else {
        // RED-DOT / HOLO in the gunsmith preview: a SLIM ring frame + a soft glowing
        // translucent center dot (additive sprite) — matches the sleeker in-game optic.
        const eff=DATA.attachments[att.optic]; const dot=parseInt((eff&&eff.reticleColor||'#ff3b30').slice(1),16)||0xff3b30;
        const optic = new T.Mesh(new T.CylinderGeometry(0.024, 0.024, 0.06, 16), attMat(att.optic));
        optic.rotation.z = Math.PI/2; optic.position.set(0.0, 0.17, 0); g.add(optic);
        const ring = new T.Mesh(new T.TorusGeometry(0.024, 0.004, 10, 22), dark());
        ring.rotation.y = -Math.PI/2; ring.position.set(-0.04, 0.17, 0); g.add(ring);
        const glow = new T.Sprite(new T.SpriteMaterial({map:glowTexture(), color:dot,
          transparent:true, opacity:.95, blending:T.AdditiveBlending, depthTest:false, depthWrite:false}));
        glow.scale.set(0.02,0.02,0.02); glow.position.set(-0.045, 0.17, 0); g.add(glow);
      }
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
  // INFINITE AMMO (settings toggle): when on, firing never drains the mag and reloads
  // are free + instant — no inventory rounds are consumed. Read live each shot.
  function infiniteAmmo(){ return !!(S.profile && S.profile.settings && S.profile.settings.infiniteAmmo); }
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
  // ---- WEAPON SWAP: holster the current gun, switch slot, draw the new one.
  // The swap animation is a PLACEHOLDER: a dip-down/raise-up viewmodel arc driven
  // by swapAnim in update(). Swapping to the slot you already hold just re-draws.
  function switchTo(slot){
    if(!S.profile.equip[slot]) return; const same=S.player.activeSlot===slot;
    S.player.activeSlot=slot; reloading=false; Audio.play('equip');
    // swap = unequip-then-equip; if already drawn, route through the swap arc so
    // the new gun visibly comes up. If holstered, just draw it.
    swapAnim = same?0:1; holstered=false; drawAnim=1; holsterAnim=0;
    Events.emit('weapon:changed');
  }
  // ---- HOLSTER / DRAW (equip / unequip) ---------------------------------------
  // draw()    = bring the active weapon up to the ready pose (equip animation).
  // holster() = lower it to the carry pose (unequip animation). Both kick a
  // placeholder viewmodel animation; the holstered flag gates fire + ADS so a
  // holstered gun can't shoot. toggleHolster() flips between the two.
  function draw(){ if(!holstered && drawAnim<=0) return; holstered=false; drawAnim=1; holsterAnim=0; Audio.play('equip'); Events.emit('weapon:changed'); }
  function holster(){ if(holstered) return; holstered=true; holsterAnim=1; drawAnim=0; reloading=false; Audio.play('equip'); Events.emit('weapon:changed'); }
  function toggleHolster(){ holstered?draw():holster(); }
  function isHolstered(){ return holstered; }
  function ammoInMag(){ const it=activeItem(); return it?(it.inst.ammo||0):0; }

  // the active optic's ADS sight picture: a reticle descriptor. With NO optic the
  // gun uses its built-in IRON sights (so bare ADS is usable); an installed optic
  // supplies its own reticle (red-dot ring+dot / holo / scope crosshair).
  function sightOf(it){
    it=it||activeItem(); if(!it) return DATA.ironSight;
    const opticId=(it.inst.attachments||{}).optic;
    const eff=opticId?DATA.attachments[opticId]:null;
    if(eff&&eff.reticle) return { reticle:eff.reticle, color:eff.reticleColor||'#cfe8ff', aimDot:true, optic:opticId };
    return DATA.ironSight;   // no optic -> iron sights
  }
  // is the active optic a MAGNIFYING scope? Scopes carry reticle:'crosshair' (4x /
  // LPVO / thermal / bolt scope). Red-dot + holo (reticle:'reddot') are NOT scopes —
  // they keep their tiny existing zoom and get no magnified scope overlay. This is
  // the single source of truth for "should we zoom + draw the round scope view".
  function isScope(it){ it=it||activeItem(); if(!it) return false;
    const opticId=(it.inst.attachments||{}).optic; const eff=opticId?DATA.attachments[opticId]:null;
    return !!(eff && eff.reticle==='crosshair'); }

  // ---- LASER toggle API (feat/weapon-camera-feel) -----------------------------
  // The bound key flips laserOn. The beam still only RENDERS when a laser
  // attachment is installed (st.laser) — toggling with no laser just confirms the
  // state. Toast tells the player what happened so the key never feels dead.
  function hasLaser(){ const st=stats(); return !!(st&&st.laser); }
  function setLaser(on){ laserOn=!!on; }
  function toggleLaser(){
    laserOn=!laserOn; Audio.play('ui');
    if(hasLaser()) UI.toast('Laser '+(laserOn?'ON':'OFF'),'neu');
    else UI.toast('No laser attachment','neu');
  }
  function isLaserOn(){ return laserOn; }

  // ---- SCOPE VIEW overlay (feat/weapon-camera-feel) ---------------------------
  // A round scoped-view vignette: a big black ring that masks the screen corners to
  // a circle while ADS through a magnifying optic, so the (FOV-narrowed) view reads
  // as "what's inside the scope". A thin cross hair + center pip ride on top via the
  // existing reticle. Built once; only opacity toggles per frame (cheap).
  function ensureScope(){
    if(scopeEl) return scopeEl;
    const hud=document.getElementById('hud')||document.body;
    const el=document.createElement('div'); el.id='scopeOverlay';
    // radial mask: transparent center circle, hard black outside it; a faint inner
    // ring line + corner darkening sell the optic. Sized in vmin so it scales.
    el.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:10;opacity:0;'
      +'transition:opacity .12s linear;will-change:opacity;'
      +'background:radial-gradient(circle at 50% 50%,'
      +'transparent 0 28vmin, rgba(0,0,0,.55) 28.4vmin 30vmin, #000 30.4vmin 200vmin);';
    // a thin scope-ring highlight just inside the black edge
    const ring=document.createElement('i');
    ring.style.cssText='position:absolute;left:50%;top:50%;width:56vmin;height:56vmin;'
      +'transform:translate(-50%,-50%);border-radius:50%;border:1px solid rgba(180,210,230,.18);'
      +'box-shadow:0 0 24px rgba(0,0,0,.6) inset;';
    el.appendChild(ring); hud.appendChild(el); scopeEl=el; return el;
  }

  // ---- ADS RETICLE OVERLAY (iron sights + red-dot + scope crosshair) ----------
  // A screen-space DOM reticle drawn over the HUD when aiming. The CENTER DOT sits
  // exactly at screen center — the same point the ADS hitscan converges on — so it
  // doubles as the functional aim point. Built once, restyled per sight type.
  function ensureReticle(){
    if(reticleEl) return reticleEl;
    const hud=document.getElementById('hud')||document.body;
    const el=document.createElement('div'); el.id='adsReticle';
    el.style.cssText='position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);'
      +'width:0;height:0;pointer-events:none;z-index:11;opacity:0;transition:opacity .08s linear;'
      +'will-change:opacity;';
    hud.appendChild(el); reticleEl=el; return el;
  }
  // paint the reticle for a given sight descriptor. iron = front-post-in-rear-notch;
  // reddot = a glowing RING with a bright center DOT (NOT an opaque circle); holo
  // reuses reddot with a wider ring; scope = a fine crosshair. All center-anchored.
  function paintReticle(sight){
    const el=ensureReticle(); const sig=sight.reticle+'|'+sight.color;
    if(el.dataset.sig===sig) return; el.dataset.sig=sig;
    const c=sight.color||'#cfe8ff'; el.innerHTML='';
    const add=css=>{ const d=document.createElement('i'); d.style.cssText='position:absolute;left:50%;top:50%;'+css; el.appendChild(d); };
    if(sight.reticle==='reddot'){
      // RING (transparent middle) + glowing center DOT — a functional reticle, not
      // an opaque blob. Ring is a hollow circle; dot is the precise aim point.
      add(`width:26px;height:26px;margin:-13px 0 0 -13px;border:2px solid ${c};border-radius:50%;`
        +`box-shadow:0 0 6px ${c}aa, inset 0 0 4px ${c}66;background:transparent;`);
      add(`width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;background:${c};`
        +`box-shadow:0 0 8px 2px ${c}, 0 0 14px ${c}aa;`);
    } else if(sight.reticle==='crosshair'){
      // scope crosshair: four thin arms + tiny center dot (the aim point)
      const arm=`background:${c};box-shadow:0 0 3px ${c};`;
      add(`width:1.5px;height:16px;margin:-22px 0 0 -.75px;${arm}`);
      add(`width:1.5px;height:16px;margin:6px 0 0 -.75px;${arm}`);
      add(`width:16px;height:1.5px;margin:-.75px 0 0 -22px;${arm}`);
      add(`width:16px;height:1.5px;margin:-.75px 0 0 6px;${arm}`);
      add(`width:3px;height:3px;margin:-1.5px 0 0 -1.5px;border-radius:50%;background:${c};box-shadow:0 0 5px ${c};`);
    } else {
      // IRON sights: a rear notch (two posts) framing a front post at center.
      const metal=`background:${c};box-shadow:0 0 2px rgba(0,0,0,.7);opacity:.92;`;
      // rear notch — left + right posts with a gap at center
      add(`width:5px;height:11px;margin:-1px 0 0 -16px;${metal}`);
      add(`width:5px;height:11px;margin:-1px 0 0 11px;${metal}`);
      // front post (the aim tip) — a thin blade rising into the notch gap
      add(`width:3px;height:13px;margin:-3px 0 0 -1.5px;${metal}`);
      // bright tip dot at the precise aim point (top of the front post = center)
      add(`width:3px;height:3px;margin:-3.5px 0 0 -1.5px;border-radius:50%;background:#fff;box-shadow:0 0 4px #fff;`);
    }
  }

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
    // infinite ammo: instant, free top-up — no reserve drain, no reload timer
    if(infiniteAmmo()){ it.inst.ammo=st.mag; Audio.play('reload'); Events.emit('weapon:changed'); return; }
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
    // infinite ammo toggled on mid-reload: free fill, consume no reserve
    if(infiniteAmmo()){ it.inst.ammo=st.mag; reloading=false; UI.flashReload(''); Audio.play('reload'); Events.emit('weapon:changed'); return; }
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
    if(reloading || holstered) return false; const it=activeItem(); if(!it) return false; const st=stats(it);
    const inf=infiniteAmmo();
    if(!inf && it.inst.ammo<=0){ reload(); return false; }
    // active ammo type modifies the shot (damage / pen / range / recoil / tracer)
    const at = loadedType(it) || { dmg:1, pen:0.3, range:1, recoil:1, tracer:false, color:0xffd27a };
    const interval=60/st.rpm;
    if(Clock.now-lastShot<interval) return false;
    lastShot=Clock.now; if(inf){ it.inst.ammo=Math.max(it.inst.ammo, st.mag); } else it.inst.ammo--;
    const suppressed = !!(it.inst.attachments && Object.keys(it.inst.attachments).some(s=>{ const a=DATA.attachments[it.inst.attachments[s]]; return a&&a.quiet; }));
    muzzle.material.opacity=1; muzzle.material.rotation=Math.random()*Math.PI;
    const kick=st.recoil*(at.recoil||1)*(S.player.ads?0.55:1);
    GFX.pitch.rotation.x=clamp(GFX.pitch.rotation.x+kick,-1.5,1.5); recoilDebt+=kick;
    GFX.yaw.rotation.y += (Math.random()-0.5)*kick*0.5;
    // subtle muzzle camera-shake scaled to the gun's recoil (damped while scoped).
    GFX.shake(clamp(kick*4.2, 0.04, 0.4)*(S.player.ads?0.5:1));
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
  // holster/draw toggle: honors an optional rebindable 'holster' bind, else KeyH-
  // adjacent default KeyJ (HEAL already owns KeyH). Lets the player put the gun away.
  addEventListener('keydown', e=>{
    if(S.mode!==MODE.RAID) return;
    const code = (Input.code && Input.code('holster')) || (DATA.binds && DATA.binds.holster) || 'KeyJ';
    if(e.code===code && !e.repeat) toggleHolster();
  });
  // weapons SPAWN HOLSTERED, then auto-DRAW on entering a raid (so the draw/equip
  // animation plays at deploy). Returning to RAID from a PAUSE/MENU round-trip
  // PRESERVES the current holster state (don't re-draw on every unpause); only a
  // FRESH raid entry (from HUB / transit / result) re-spawns holstered + draws.
  let _prevMode=S.mode;
  Events.on('mode', m=>{
    const from=_prevMode; _prevMode=m;
    if(m===MODE.RAID){
      if(from===MODE.PAUSE || from===MODE.MENU) return; // resume/close menu: keep state
      holstered=true; drawAnim=0; holsterAnim=0; swapAnim=0; draw();   // fresh deploy
    } else if(m===MODE.HUB || m===MODE.RESULT || m===MODE.BOOT){
      // out of the field: re-holster so the next deploy starts put-away
      holstered=true; drawAnim=0; holsterAnim=0; swapAnim=0; if(reticleEl) reticleEl.style.opacity='0';
    } else if(reticleEl){ reticleEl.style.opacity='0'; }  // PAUSE/MENU: just hide reticle
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
    // SAFEZONE / out-of-field: NO held gun. The viewmodel only shows in a raid so the
    // safehouse view is clear (no weapon blocking the screen while you gear up/trade).
    if(gun) gun.visible = (S.mode===MODE.RAID);
    if(S.mode!==MODE.RAID){ if(laserDot) laserDot.visible=false; if(laserBeam) laserBeam.visible=false; }
    if(muzzle && muzzle.material.opacity>0) muzzle.material.opacity=Math.max(0,muzzle.material.opacity-dt*12);
    if(reloading && Clock.now>=reloadEnd) finishReload();
    // recoil recovery: spring the kicked aim back down
    if(recoilDebt>0.0001){ const rec=recoilDebt*Math.min(1,dt*7); GFX.pitch.rotation.x=clamp(GFX.pitch.rotation.x-rec,-1.5,1.5); recoilDebt-=rec; } else recoilDebt=0;
    if(S.mode!==MODE.RAID){ prevFire=false; burstLeft=0; GFX.setBob(0,0); if(reticleEl) reticleEl.style.opacity='0'; if(scopeEl) scopeEl.style.opacity='0'; return; }
    // decay the equip / unequip / swap animation PLACEHOLDER timers
    if(drawAnim>0)    drawAnim    = Math.max(0, drawAnim    - dt*3.2);
    if(holsterAnim>0) holsterAnim = Math.max(0, holsterAnim - dt*3.6);
    if(swapAnim>0)    swapAnim    = Math.max(0, swapAnim    - dt*2.6);
    const it=activeItem();
    // a HOLSTERED gun can't fire (fire() also guards this) — only let intents
    // through while drawn so burst/auto don't queue against a put-away weapon.
    const wantFire = !holstered && Input.firing && (Input.locked||Input.isTouch) && !!it;
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
      const moving = Player.isMoving&&Player.isMoving();
      // ADS only counts when the gun is actually DRAWN (holstered = no aiming)
      const ads = S.player.ads && !holstered;
      const stv = it?stats(it):null; const handling = stv?stv.handling:1;
      bobT += dt*(moving?9:3);
      const dy=GFX.yaw.rotation.y-lastYaw, dp=GFX.pitch.rotation.x-lastPitch; lastYaw=GFX.yaw.rotation.y; lastPitch=GFX.pitch.rotation.x;
      swayX += (clamp(-dy*0.55,-0.045,0.045)-swayX)*Math.min(1,dt*9);
      swayY += (clamp(dp*0.55,-0.045,0.045)-swayY)*Math.min(1,dt*9);
      // wall pushback: short forward ray lowers/retracts the gun
      const fdir=new T.Vector3(); GFX.camera.getWorldDirection(fdir); const forg=new T.Vector3(); GFX.camera.getWorldPosition(forg);
      ray.set(forg,fdir); ray.far=1.15; const wh=ray.intersectObjects(World.solids,false); ray.far=Infinity;
      const wall = wh.length? clamp(1-wh[0].distance/1.15,0,1):0;
      // target pose: hip (meshes already sit lower-right) vs ADS. For ADS we shift
      // the whole gun so the ACTIVE SIGHT (sightLocal = optic reticle, or iron front
      // post) lands at screen centre — you look THROUGH the optic, not past the
      // off-bore body. Aligning to sightLocal (instead of a hardcoded offset) makes
      // a scoped gun, a red-dot, and bare irons each centre on their own sight.
      let tx = ads?-sightLocal.x : 0.0,
          ty = ads?-sightLocal.y : 0.0,
          tz = ads?-0.05 : 0.0, trx=0;
      tx += swayX*(ads?0.25:1); ty += swayY*(ads?0.25:1);
      ty -= wall*0.13; tz += wall*0.17; trx += wall*0.5;
      if(reloading){ const st2=stats(it); const dur=(st2?st2.reload:1)*Progression.reloadMult(); const prog=clamp(1-(reloadEnd-Clock.now)/Math.max(0.01,dur),0,1); const dip=Math.sin(prog*Math.PI); ty-=dip*0.14; tz+=dip*0.04; trx+=dip*0.8; }
      // melee lunge: a quick forward jab + downward rotation, eased by meleeAnim
      if(meleeAnim>0){ const j=Math.sin(meleeAnim*Math.PI); tz-=j*0.34; tx+=j*0.06; trx-=j*0.7; }
      // ---- HOLSTER / DRAW / SWAP viewmodel animation PLACEHOLDERS ----
      // Stub poses (no skinned art yet): the gun drops down + tilts away when
      // holstered or mid-swap, and rises into place as the draw animation plays.
      // holstered-rest pose (fully put away)
      if(holstered){ ty-=0.5; tz+=0.22; trx+=1.1; }
      // draw arc (equip): a brief raise-from-low as drawAnim eases 1->0
      if(drawAnim>0){ const d=drawAnim; ty-=d*0.42; tz+=d*0.12; trx+=d*0.9; }
      // holster arc (unequip): lower-away as holsterAnim eases 1->0
      if(holsterAnim>0){ const h=holsterAnim; ty-=h*0.42; tz+=h*0.12; trx+=h*0.9; }
      // swap arc: a quick dip the new weapon comes up through (sin hump)
      if(swapAnim>0){ const s=Math.sin(swapAnim*Math.PI); ty-=s*0.5; trx+=s*0.8; }
      // handling raises the pose-settle speed (better handling = snappier ADS)
      const k=Math.min(1,dt*(ads?16:9)*handling);
      gun.position.x += (tx-gun.position.x)*k; gun.position.y += (ty-gun.position.y)*k; gun.position.z += (tz-gun.position.z)*k;
      gun.rotation.x += (trx-gun.rotation.x)*Math.min(1,dt*12);
      // ---- HEADBOB (feat/weapon-camera-feel) ----
      // Subtle walk/run sway, routed through GFX.setBob so it composites at render
      // (toggleable + prefers-reduced-motion aware) instead of mutating the camera
      // rig directly. Amount eases up while moving, settles to 0 at rest; the run
      // sprint pushes it a touch harder. camera.position itself stays at baseline 0
      // so ADS sightLocal alignment is never thrown off by a leftover offset.
      const sprinting = !!(Input.down && Input.down('sprint') && !Input.crouch);
      const hb = moving?(sprinting?1.15:1):0;
      bobX += (Math.sin(bobT*0.5)*0.012*hb - bobX)*Math.min(1,dt*8);
      bobY += (Math.abs(Math.sin(bobT))*0.018*hb - bobY)*Math.min(1,dt*8);
      // ADS damps the bob hard so aiming stays steady
      const bm = ads?0.25:1;
      GFX.setBob(bobX*bm, bobY*bm);
      GFX.camera.position.set(0,0,0);   // keep the rig baseline clean (bob is composited)
    }
    // effective ADS: aiming AND drawn. Used for crosshair/reticle/fov below.
    const aiming = S.player.ads && !holstered;
    // dynamic crosshair: spread + ADS + movement. Hidden while aiming (the ADS
    // reticle takes over) and while holstered (no active sight picture).
    const st = it?stats(it):null; let gap=6;
    if(st){ gap = (aiming?2.5:6) + (st.spread*420) + (Player.isMoving&&Player.isMoving()?5:0) + recoilDebt*60; }
    const ch=document.getElementById('crosshair');
    if(ch){ ch.style.setProperty('--g', Math.min(26,gap).toFixed(1)+'px'); ch.style.opacity=(aiming||holstered)?'0':''; }
    // ADS reticle: iron sights by default, or the installed optic's reticle. The
    // center dot sits at screen center = the aim point the hitscan converges on.
    if(aiming && it){ const sight=sightOf(it); paintReticle(sight); const el=ensureReticle(); el.style.opacity='1'; }
    else if(reticleEl){ reticleEl.style.opacity='0'; }
    // ---- LASER: constant glowing beam + hit dot (LASER mod installed AND toggled
    // on). The beam runs muzzle→first-hit and stays lit every frame (not just on
    // fire). Beam + dot are reused meshes — only transform/opacity change here.
    if(laserDot){
      const on = !!(st && st.laser) && laserOn && S.mode===MODE.RAID && !holstered;
      laserDot.visible = on; if(laserBeam) laserBeam.visible = on;
      if(on){
        const ld=new T.Vector3(); GFX.camera.getWorldDirection(ld);
        const lo=new T.Vector3(); GFX.camera.getWorldPosition(lo);
        ray.set(lo,ld); ray.far=120;
        const lh=ray.intersectObjects([...World.solids, ...Enemies.hitMeshes()],false); ray.far=Infinity;
        const pt = lh.length ? lh[0].point : lo.clone().addScaledVector(ld, 60);
        // tint the beam to the laser device color (IR laser reads cyaner) if present
        laserDot.position.copy(pt);
        const d = lo.distanceTo(pt); laserDot.scale.setScalar(clamp(0.02+d*0.0016, 0.03, 0.3));
        laserDot.material.opacity = S.player.ads?0.5:0.95;   // a touch dimmer when scoped
        // beam: originate at the muzzle (offset down the bore from the eye) so it
        // reads as coming from the gun, not the face. Orient + scale the unit
        // cylinder to span origin→hit without rebuilding geometry.
        if(laserBeam){
          const org=lo.clone().addScaledVector(ld,0.35); org.y-=0.06;
          const seg=pt.clone().sub(org); const len=seg.length();
          const mid=org.clone().addScaledVector(seg,0.5);
          laserBeam.position.copy(mid);
          laserBeam.scale.set(1, Math.max(0.001,len), 1);
          // align the cylinder's +Y to the beam direction
          laserBeam.quaternion.setFromUnitVectors(new T.Vector3(0,1,0), seg.normalize());
          laserBeam.material.opacity = S.player.ads?0.28:0.5;
        }
      }
    }
    // ---- ZOOM SCOPE: a magnifying optic narrows the camera FOV (zooms the view)
    // while ADS, and shows a round scope-view overlay. Red-dot/holo keep their tiny
    // 1.1–1.4× zoom (no overlay). Scopes use their full st.zoom (2.2–3.6×). The
    // baseFov/zoom division IS the magnification; restored to baseFov on release.
    const scoped = aiming && isScope(it);
    const want = aiming ? GFX.baseFov/((st&&st.zoom)||1.3) : GFX.baseFov;
    GFX.camera.fov += (want-GFX.camera.fov)*Math.min(1,dt*12); GFX.camera.updateProjectionMatrix();
    // scope-view overlay: show the round vignette only while scoped-in
    if(scoped){ ensureScope().style.opacity='1'; }
    else if(scopeEl){ scopeEl.style.opacity='0'; }
    // a holstered gun can't aim: drop the ADS intent so nothing downstream zooms.
    S.player.ads = Input.ads && !holstered;
  }
  return { buildViewmodel, buildPreviewModel, stats, activeItem, switchTo, ammoInMag, reload, fire, throwGrenade, cycleMode, modeOf, melee, canMelee, update,
    // ammo-type / magazine-feed API (feat/lns-ammo-mags)
    loadedType, loadedTypeId, availableTypes, reserveOf, setAmmo, cycleAmmo,
    // holster/draw + sight API (fix/lns-weapons)
    draw, holster, toggleHolster, isHolstered, sightOf,
    // laser toggle API (feat/weapon-camera-feel)
    toggleLaser, setLaser, isLaserOn };
})();
