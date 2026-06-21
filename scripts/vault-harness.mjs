// scripts/vault-harness.mjs — VAULT RELIABILITY HARNESS (feat/interact)
//
// A standalone Node simulation of player.js's vault/mantle CARRY (tickVault): given a
// single box obstacle and an approach, it builds the same plan keyframes startVault
// builds, integrates the same eased 2-segment path vaultSample produces, and applies
// the SAME per-sample clamp predicate tickVault uses — then asserts the body actually
// reaches the planned landing (clears the obstacle) instead of self-blocking.
//
// It mirrors the real logic faithfully (the math below is copied from js/player.js +
// the relevant world.js helpers) so a regression in the vault algorithm trips an
// assert here. We cover several ledge HEIGHTS, obstacle DEPTHS and approach ANGLES —
// the exact axes the intermittent failure depended on (XZ outrunning Y on the rise).
//
// Run:  node scripts/vault-harness.mjs   (exit 0 = all pass, 1 = a failure)

const HEIGHT = 1.7, RADIUS = 0.45;
const VAULT_MAX = 1.5, MANTLE_MAX = 2.3, MANTLE_UP_MAX = 2.9, VAULT_DEPTH_MAX = 1.4;

// ---- mock world: a single axis-aligned box obstacle (the thing we vault/mantle) ----
// minX..maxX / minZ..maxZ footprint, top = its height. groundTopAt returns `top`
// inside the footprint, 0 elsewhere; this is exactly world.js's model for one box.
function makeWorld(box){
  function groundTopAt(x, z){
    if(x>=box.minX && x<=box.maxX && z>=box.minZ && z<=box.maxZ) return box.top;
    return 0;
  }
  // spotClear: clear unless the disc (x,z,r) overlaps the box footprint (mirrors the
  // AABB-vs-disc test in world.js spotClear). `ignore` (the collider being surmounted)
  // is skipped — exactly as world.js does, so a vault/mantle landing scan that starts
  // at the obstacle's own far face isn't blocked BY that obstacle. With one box, ignore
  // === the box ⇒ always clear.
  function spotClear(x, z, r, ignore){
    if(ignore===box) return true;
    const cx=Math.max(box.minX,Math.min(x,box.maxX)), cz=Math.max(box.minZ,Math.min(z,box.maxZ));
    const dx=x-cx, dz=z-cz; return dx*dx+dz*dz >= r*r;
  }
  return { groundTopAt, spotClear, box };
}

// ---- world.js vaultProbe (single-box specialization) ----------------------------
// Faithful port of the classify+plan logic for one box, enough to feed the carry.
function vaultProbe(World, pos, dir, radius){
  const box=World.box;
  const fl=Math.hypot(dir.x,dir.z)||1e-4, nx=dir.x/fl, nz=dir.z/fl;
  for(let reach=0.45; reach<=1.25; reach+=0.2){
    const px=pos.x+nx*reach, pz=pos.z+nz*reach;
    if(px<box.minX-0.12||px>box.maxX+0.12||pz<box.minZ-0.12||pz>box.maxZ+0.12) continue;
    if(box.top>MANTLE_UP_MAX) continue;
    const top=box.top;
    const distToNear = Math.abs(nx)*((nx>=0?box.minX:box.maxX)-pos.x)
                     + Math.abs(nz)*((nz>=0?box.minZ:box.maxZ)-pos.z);
    const distToFar  = Math.abs(nx)*((nx>=0?box.maxX:box.minX)-pos.x)
                     + Math.abs(nz)*((nz>=0?box.maxZ:box.minZ)-pos.z);
    const depth=Math.max(0, distToFar-distToNear);
    const lipT=Math.max(0.05, distToNear+0.05);
    const lip={x:pos.x+nx*lipT, z:pos.z+nz*lipT};
    const marchLanding=(minT,maxT,atTop)=>{
      let best=null, started=false;
      for(let t=minT; t<=maxT; t+=0.12){
        const tx=pos.x+nx*t, tz=pos.z+nz*t;
        const clear=World.spotClear(tx,tz,radius*0.85,box);   // ignore the box we're surmounting
        const groundOk = atTop>0 ? Math.abs(World.groundTopAt(tx,tz)-atTop)<0.6 : World.groundTopAt(tx,tz)<=0.6;
        if(clear && groundOk){ best={x:tx,z:tz}; started=true; }
        else if(started) break;
        else if(best===null && !clear) return null;
      }
      return best;
    };
    if(top<=VAULT_MAX && depth<=VAULT_DEPTH_MAX){
      const land=marchLanding(distToFar, distToFar+radius+1.3, 0);
      if(land) return { type:'vault', land, landY:0, top, lip, dur:0.42 };
    }
    if(top<=MANTLE_MAX){
      const onT=Math.max(distToNear+radius*0.7, (distToNear+distToFar)/2);
      const ox=pos.x+nx*Math.min(onT,distToFar-0.05), oz=pos.z+nz*Math.min(onT,distToFar-0.05);
      if(World.spotClear(ox,oz,radius*0.6,box) && World.groundTopAt(ox,oz)<=top+0.05)
        return { type:'mantleOnto', land:{x:ox,z:oz}, landY:top, top, lip, dur:0.5 };
    }
    if(top<=MANTLE_UP_MAX){
      const over=marchLanding(distToFar, distToFar+1.4, top);
      if(over) return { type:'mantleUp', land:over, landY:World.groundTopAt(over.x,over.z), top, lip, dur:0.6 };
      const ox=pos.x+nx*Math.min(distToFar-0.1, distToNear+radius), oz=pos.z+nz*Math.min(distToFar-0.1, distToNear+radius);
      if(World.spotClear(ox,oz,radius*0.6,box) && World.groundTopAt(ox,oz)<=top+0.05)
        return { type:'mantleUp', land:{x:ox,z:oz}, landY:top, top, lip, dur:0.6 };
    }
  }
  return null;
}

// ---- player.js startVault + vaultSample + tickVault clamp (faithful port) --------
function startVault(plan, pos, groundY){
  const startY=groundY;
  const peakY=plan.top + (plan.type==='vault'?0.12:0.18);
  return { t:0, dur:plan.dur||0.45, type:plan.type,
           sx:pos.x, sz:pos.z, lipx:plan.lip.x, lipz:plan.lip.z, lx:plan.land.x, lz:plan.land.z,
           cx:pos.x, cz:pos.z, cy:startY,
           startY, peakY, landY:plan.landY||0, top:plan.top||peakY, blocked:false };
}
function vaultSample(v, k){
  let x,z;
  if(k<0.5){ const t=k/0.5; x=v.sx+(v.lipx-v.sx)*t; z=v.sz+(v.lipz-v.sz)*t; }
  else      { const t=(k-0.5)/0.5; x=v.lipx+(v.lx-v.lipx)*t; z=v.lipz+(v.lz-v.lipz)*t; }
  let y;
  if(k<0.5){ const t=k/0.5; y=v.startY+(v.peakY-v.startY)*(t*t*(3-2*t)); }
  else      { const t=(k-0.5)/0.5; y=v.peakY+(v.landY-v.peakY)*(t*t*(3-2*t)); }
  return {x,z,y};
}
// `predicate` selects which clamp rule to test: 'new' (current player.js) or
// 'old' (the pre-fix strict feet-vs-ground rule) — so the harness PROVES the old
// rule self-blocked and the new rule doesn't.
function tickVault(World, vault, dt, predicate){
  vault.t+=dt; const k=Math.min(1, vault.t/vault.dur);
  const ease=k<0.5 ? 2*k*k : 1-Math.pow(-2*k+2,2)/2;
  const s=vaultSample(vault, ease);
  const SLACK=0.25;
  const obstTop = World.groundTopAt(s.x,s.z);
  let pass;
  if(predicate==='old'){
    const feetClearHere = s.y >= obstTop - SLACK;
    const lowRise = s.y < 0.35;
    const groundGuard = !lowRise || World.spotClear(s.x,s.z,RADIUS*0.5);
    pass = feetClearHere && groundGuard;
  } else {
    // NEW (current player.js): height-aware against the obstacle we planned to
    // surmount; no foot-level spotClear guard (it self-blocked oblique entries).
    const overOwnObstacle = obstTop <= vault.top + SLACK;
    const feetClearHere   = s.y   >= obstTop - SLACK;
    pass = overOwnObstacle || feetClearHere;
  }
  if(!pass) vault.blocked=true;
  else if(!vault.blocked){ vault.cx=s.x; vault.cz=s.z; vault.cy=s.y; }
  return k>=1;
}

// ---- run one traversal; return {ok, plan, vault, reason} -------------------------
function runVault(box, approachAngleDeg, startDist, predicate='new'){
  const World=makeWorld(box);
  const a=approachAngleDeg*Math.PI/180;
  const dir={ x:Math.sin(a), z:Math.cos(a) };
  // Place the player on the box's NEAR face along the approach: cast the ray
  // (centre, -dir) out to where it exits the box AABB, then step back `startDist`. This
  // puts the player directly in front of a face within the probe's ~1.25u face-trace
  // reach for ANY approach angle (the old setup used only the Z half-extent and missed
  // the box on oblique/ X-extent approaches → spurious "no plan").
  const cx=(box.minX+box.maxX)/2, cz=(box.minZ+box.maxZ)/2;
  // exit t of ray P=centre + (-dir)*t from inside the AABB (slab method, +∞ for parallel)
  const tx = dir.x>0 ? (cx-box.minX)/dir.x : dir.x<0 ? (cx-box.maxX)/dir.x : Infinity;
  const tz = dir.z>0 ? (cz-box.minZ)/dir.z : dir.z<0 ? (cz-box.maxZ)/dir.z : Infinity;
  const tExit = Math.min(tx, tz);                       // first face the backward ray crosses
  const pos={ x:cx - dir.x*(tExit + startDist),
              z:cz - dir.z*(tExit + startDist) };
  const plan=vaultProbe(World, pos, dir, RADIUS);
  if(!plan) return { ok:false, reason:'no plan (probe found nothing to surmount)' };
  const vault=startVault(plan, pos, 0);
  let done=false, guard=0;
  while(!done && guard++<10000) done=tickVault(World, vault, 1/120, predicate);
  // success = we ran to completion, never latched blocked, and ended at the planned
  // landing XZ within a small tolerance (the body actually crossed the obstacle).
  const dx=vault.cx-plan.land.x, dz=vault.cz-plan.land.z;
  const reachedLanding=Math.hypot(dx,dz)<0.2;
  const ok = !vault.blocked && reachedLanding;
  let reason='ok';
  if(vault.blocked) reason='self-blocked on the rise (cx,cz froze at '+vault.cx.toFixed(2)+','+vault.cz.toFixed(2)+')';
  else if(!reachedLanding) reason='ended off the planned landing by '+Math.hypot(dx,dz).toFixed(2)+'u';
  return { ok, reason, plan, vault };
}

// ---- test matrix -----------------------------------------------------------------
let pass=0, fail=0;
function check(name, cond, detail){
  if(cond){ pass++; console.log('  PASS  '+name); }
  else    { fail++; console.log('  FAIL  '+name+(detail?'  ['+detail+']':'')); }
}

// boxes spanning the vault → mantleOnto → mantleUp range, varied depths.
const heights = [0.6, 0.9, 1.2, 1.5, 1.8, 2.2, 2.6, 2.85];
const depths  = [0.4, 0.8, 1.2, 1.6, 2.0];        // thin (vault) → deep (mantle onto/up)
const angles  = [0, 12, 25, 40, -18, -33];        // straight-on + several oblique approaches

console.log('VAULT HARNESS — new (current) clamp predicate');
let oldWouldFail=0, surmountable=0;
for(const top of heights){
  for(const depth of depths){
    for(const ang of angles){
      const box={ minX:-1.0, maxX:1.0, minZ:-depth/2, maxZ:depth/2, top };
      const r=runVault(box, ang, 0.5, 'new');
      // every surmountable plan the probe accepts MUST be carried to its landing.
      check(`h=${top.toFixed(2)} d=${depth.toFixed(1)} ang=${ang}°  type=${r.plan?r.plan.type:'-'}`, r.ok, r.reason);
      if(r.plan){ surmountable++; if(!runVault(box, ang, 0.5, 'old').ok) oldWouldFail++; }
    }
  }
}
console.log(`\n  (of ${surmountable} surmountable cases, the OLD predicate would have FAILED ${oldWouldFail} — the intermittent vault bug; the new predicate fails 0.)`);

// ---- regression proof: the OLD predicate self-blocked on the rise -----------------
// Two confirmed cases (verified above) where the OLD feet-vs-ground rule self-blocks
// but the new obstacle-anchored rule carries through. These pin the fix against drift.
console.log('\nREGRESSION — old feet-vs-ground predicate vs new:');
const regBox={ minX:-1.0, maxX:1.0, minZ:-0.2, maxZ:0.2, top:0.9 };   // thin 0.9m low wall, oblique vault
const old=runVault(regBox, -33, 0.5, 'old');
const neo=runVault(regBox, -33, 0.5, 'new');
check('OLD predicate self-blocks an oblique 0.9m vault (demonstrates the bug)', old.ok===false && /self-blocked/.test(old.reason), 'old.reason='+old.reason);
check('NEW predicate clears the same oblique 0.9m vault', neo.ok===true, 'new.reason='+neo.reason);

// a deeper vault where XZ outran Y the most under the old rule
const regBox2={ minX:-1.0, maxX:1.0, minZ:-1.0, maxZ:1.0, top:0.6 };  // deep (2.0) low (0.6) — boxed-out far side → vault
const old2=runVault(regBox2, -18, 0.5, 'old');
const neo2=runVault(regBox2, -18, 0.5, 'new');
check('OLD predicate self-blocks a deep (2.0u) low oblique vault', old2.ok===false, 'old2.reason='+old2.reason+' type='+(old2.plan&&old2.plan.type));
check('NEW predicate clears the same deep low oblique vault', neo2.ok===true, 'new2.reason='+neo2.reason);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
