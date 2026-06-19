// enemies.js — SYS: Enemies. Role-driven AI. Squad alert via Events('alert').
// Cover-ish via range management per role. Hitscan return fire -> Player.damage.
import { T } from "./three.js";
import { DATA } from "./data.js";
import { S, MODE, Clock, Events } from "./state.js";
import { GFX } from "./gfx.js";
import { fxTracer } from "./fx.js";
import { Audio } from "./audio.js";
import { World } from "./world.js";
import { Player } from "./player.js";
import { Loot } from "./loot.js";

export const Enemies = (function(){
  const ray=new T.Raycaster();
  let mobs=[]; const tmp=new T.Vector3(); const camW=new T.Vector3(); const tmpA=new T.Vector3(); const tmpB=new T.Vector3();

  function clear(){ mobs=[]; }
  function list(){ return mobs; }
  function hitMeshes(){ const a=[]; for(const e of mobs) if(!e.dead) a.push(...e.parts); return a; }
  function aliveCount(){ return mobs.filter(e=>!e.dead).length; }

  function rollKit(r){
    const k=r.kit||{wpn:['wpn_smg']}; const wpn=k.wpn[Math.floor(Math.random()*k.wpn.length)];
    const wDef=DATA.weapons[DATA.items[wpn].weapon]; const att={};
    if(k.optic && wDef.slots.includes('optic')) att.optic=k.optic;
    if(k.att){ if(Math.random()<k.att && wDef.slots.includes('muzzle')) att.muzzle='att_suppressor';
      if(Math.random()<k.att && wDef.slots.includes('tactical')) att.tactical='att_grip';
      if(!att.optic && Math.random()<k.att*0.6 && wDef.slots.includes('optic')) att.optic='att_reddot'; }
    const armor = (Math.random()<(k.armor||0)) ? (k.heavyArmor?'arm_lvl4':'arm_lvl2') : null;
    const helmet = (Math.random()<(k.helmet||0)) ? 'helm_lvl2' : null;
    return { wpn, att, armor, helmet, cal:wDef.cal };
  }
  function spawn(roleId,x,z){
    const r=DATA.enemies[roleId];
    const g=new T.Group();
    const skin=new T.MeshStandardMaterial({color: r.behavior==='snipe'?0x553355: r.behavior==='rush'?0x7a3322:0x7a2f2c, roughness:.7});
    const torso=new T.Mesh(new T.BoxGeometry(.7,1,.4),skin); torso.position.y=1.1; torso.castShadow=true;
    const head=new T.Mesh(new T.BoxGeometry(.4,.4,.4),skin); head.position.y=1.85;
    const legs=new T.Mesh(new T.BoxGeometry(.6,.9,.35), new T.MeshStandardMaterial({color:0x2a2d31})); legs.position.y=.45;
    g.add(legs,torso,head); g.position.set(x,0,z); GFX.world.add(g);
    const kit=rollKit(r); const cmesh={gun:null,plate:null,helmet:null};
    // visible kit: helmet + chest plate so silhouette reads their gear
    if(kit.helmet){ const hm=new T.Mesh(new T.BoxGeometry(.46,.22,.46), new T.MeshStandardMaterial({color:0x394150,metalness:.4,roughness:.5})); hm.position.y=2.04; g.add(hm); cmesh.helmet=hm; }
    if(kit.armor){ const pl=new T.Mesh(new T.BoxGeometry(.78,.74,.5), new T.MeshStandardMaterial({color:kit.armor==='arm_lvl4'?0x2f3a2a:0x37414e,metalness:.3,roughness:.6})); pl.position.y=1.16; g.add(pl); cmesh.plate=pl; }
    const gun=new T.Mesh(new T.BoxGeometry(.1,.12,.62), new T.MeshStandardMaterial({color:0x16191c,metalness:.5,roughness:.5})); gun.position.set(.34,1.2,.3); g.add(gun); cmesh.gun=gun;
    const barBg=bar(0x330000), barFg=bar(0xff3b30); barBg.position.set(0,2.25,0); barFg.position.set(0,2.25,.001); g.add(barBg,barFg);
    const hp=Math.round(r.hp*(1+ (S.run?S.run.stopIndex*0.18:0)));
    const e={ group:g, parts:[torso,head,legs], role:roleId, def:r, tier:r.tier, kit, cmesh,
      hp, maxHp:hp, dmg:r.dmg*(1+(S.run?S.run.stopIndex*0.12:0)), accuracy:Math.min(0.85,r.accuracy+(S.run?S.run.stopIndex*0.03:0)),
      bar:barFg, barBg, alert:false, lastSeen:-99, nextShot:0, home:new T.Vector3(x,0,z),
      strafeDir:Math.random()<.5?-1:1, strafeT:0, dead:false };
    torso.userData={enemy:e,part:'torso'}; head.userData={enemy:e,part:'head'}; legs.userData={enemy:e,part:'legs'};
    mobs.push(e); return e;
  }
  function bar(c){ return new T.Mesh(new T.PlaneGeometry(.9,.12), new T.MeshBasicMaterial({color:c})); }

  function damage(e,dmg){
    e.hp-=dmg; e.alert=true; e.lastSeen=Clock.now; e.home.copy(e.group.position);
    e.parts.forEach(p=>p.material.emissive=new T.Color(0xff5544));
    setTimeout(()=>{ if(!e.dead) e.parts.forEach(p=>p.material.emissive=new T.Color(0)); },60);
    const fr=Math.max(0,e.hp/e.maxHp); e.bar.scale.x=fr; e.bar.position.x=-(0.9*(1-fr))/2;
    Events.emit('alert',{pos:e.group.position.clone(), radius:26});
    if(e.hp<=0) kill(e);
  }
  function kill(e){
    e.dead=true; e.group.rotation.x=Math.PI/2; e.group.position.y=.3;
    e.bar.visible=false; e.barBg.visible=false; e.parts.forEach(p=>p.material.color=new T.Color(0x33282a));
    Loot.makeCorpse(e);
    Events.emit('enemy:killed', e); Events.emit('threats:changed');
    if(aliveCount()===0) Events.emit('raid:cleared');
  }
  function los(from,to){ const a=tmpA.set(from.x,1.45,from.z), b=tmpB.set(to.x,1.5,to.z); const d=tmp.copy(b).sub(a); const dist=d.length(); d.normalize();
    ray.set(a,d); ray.far=dist-0.4; const h=ray.intersectObjects(World.solids,false); ray.far=Infinity; return h.length===0; }

  Events.on('alert', a=>{ for(const e of mobs){ if(e.dead) continue; if(e.group.position.distanceTo(a.pos)<a.radius){ e.alert=true; e.lastSeen=Clock.now; e.home.copy(a.pos);} } });

  function update(dt){
    if(S.mode!==MODE.RAID) return;
    const pp=GFX.yaw.position; GFX.camera.getWorldPosition(camW);
    for(const e of mobs){ if(e.dead) continue;
      e.bar.lookAt(camW); e.barBg.lookAt(camW);
      const ep=e.group.position; const dist=ep.distanceTo(pp);
      const see=dist<e.def.range && los(ep,pp);
      if(see){ e.alert=true; e.lastSeen=Clock.now; e.home.copy(pp);
        if(e.def.alertRadius) Events.emit('alert',{pos:pp.clone(),radius:e.def.alertRadius}); }
      if(e.alert){
        e.group.rotation.y=Math.atan2(pp.x-ep.x, pp.z-ep.z);
        // movement per behavior
        e.strafeT-=dt; if(e.strafeT<=0){ e.strafeDir*=-1; e.strafeT=1+Math.random()*1.5; }
        const toP=tmp.copy(pp).sub(ep); toP.y=0; const d=toP.length(); toP.normalize();
        const strafe=new T.Vector3(-toP.z,0,toP.x).multiplyScalar(e.strafeDir);
        const mv=new T.Vector3();
        let hold = e.def.behavior==='snipe'?80 : e.def.behavior==='hold'?16 : e.def.behavior==='rush'?4 : 14;
        if(d>hold+6) mv.add(toP); else if(d<hold-4) mv.add(toP.clone().multiplyScalar(-1));
        if(e.def.behavior!=='rush') mv.add(strafe.multiplyScalar(0.6));
        if(mv.lengthSq()>0){ mv.normalize().multiplyScalar(e.def.speed*dt); World.moveActor(ep,mv,0.5); }
        if(see && Clock.now>e.nextShot){ e.nextShot=Clock.now+e.def.fireDelay;
          const hit=Math.random()<e.accuracy;
          const from=new T.Vector3(ep.x,1.4,ep.z);
          const to = hit ? new T.Vector3(pp.x,1.5,pp.z)
                         : new T.Vector3(pp.x+(Math.random()-.5)*2.4, 1.5+(Math.random()-.5)*1.2, pp.z+(Math.random()-.5)*2.4);
          fxTracer(from,to,0xff6644);
          if(dist<46) Audio.play(dist<18?'shot':'shotSupp');
          if(hit){ const fall=Math.max(0.35,1-dist/e.def.range); Player.damage(e.dmg*fall, ep); } }
        if(Clock.now-e.lastSeen>8) e.alert=false;
      } else {
        const back=tmp.copy(e.home).sub(ep); back.y=0;
        if(back.length()>0.5){ back.normalize().multiplyScalar(1.2*dt); World.moveActor(ep,back,0.5); }
      }
    }
  }
  return { spawn, damage, update, clear, list, hitMeshes, aliveCount };
})();
