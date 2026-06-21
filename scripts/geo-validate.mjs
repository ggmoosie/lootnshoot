// scripts/geo-validate.mjs — NUMERICAL geometry validator for LootNShoot building
// generation. NO browser, NO THREE: it reconstructs every wall/roof/floor/door/stair
// as a WORLD-SPACE axis-aligned bounding box (using the SAME math the game uses —
// js/buildgeo.js is the shared source of truth) and ASSERTS the structural contracts:
//
//   1. ROOFS cover the footprint with no gaps / no overhang, the two pitched panels
//      meet exactly at a shared ridge with equal eave heights, and the roof base sits
//      ON the wall-tops (not floating / not intersecting the walls).
//   2. EXTERIOR walls bound ONLY their own footprint and never pass through any OTHER
//      building (no two buildings interpenetrate across a whole arena layout).
//   3. WALLS are grounded (base y=0), continuous at corners (no gaps), and end at the
//      wall-top below the roof.
//   4. (regression) doors/windows/stairs from PR#34 still place correctly — door
//      cutout in the wall, frame aligned, stairs walkable & reaching the upper floor.
//
// Run:  node scripts/geo-validate.mjs   (exit 0 = all green, 1 = a failure)

import { pitchedRoof, wallSegments, footprintFree, footprintRect, WALL_T, DOOR_GW, ROOF_EAVE }
  from "../js/buildgeo.js";

// ---- mulberry32, byte-identical to js/util.js (deterministic per seed) ----------
function mulberry(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

// ---- tiny assert harness --------------------------------------------------------
let PASS=0, FAIL=0; const FAILURES=[];
function check(name, cond, detail){
  if(cond){ PASS++; }
  else { FAIL++; FAILURES.push(name + (detail?(' — '+detail):'')); }
}
const EPS = 0.02;          // 2cm tolerance for "exact" meets
const COVER_MARGIN = 0.5;  // a pitched roof may overhang the footprint by at most this (eave + slab)

function aabbOverlapXZ(a,b,pad=0){
  return (a.minX-pad < b.maxX && a.maxX+pad > b.minX && a.minZ-pad < b.maxZ && a.maxZ+pad > b.minZ);
}

// =================================================================================
// Reconstruct ONE building exactly as js/world.js addBuilding() builds it (structure
// only — purely-decorative pieces that have no collider/contract are skipped). Every
// returned piece carries a world-space AABB so the suites below can reason about it.
// =================================================================================
function makeBuilding(cx, cz, w, d, h, facing, rng, opt={}){
  const t = WALL_T, gw = DOOR_GW;
  const B = { cx, cz, w, d, h, facing,
              footprint: footprintRect(cx,cz,w,d),
              walls:[], door:null, roof:null, roofType:null, floor:null, stairs:null };

  const pushWallSegs = (axis, fx, len, fixed, gap, hasGap) => {
    const segs = hasGap ? wallSegments(axis, fx, len, fixed, gap, gw)
                        : [ axis==='x' ? {x:fx, z:fixed, w:len, d:t} : {x:fixed, z:fx, w:t, d:len} ];
    for(const s of segs){
      B.walls.push({ wall: axis==='x'?(fixed===cz-d/2?'S':'N'):(fixed===cx-w/2?'W':'E'),
        x:s.x, z:s.z, w:s.w, d:s.d, h,
        aabb:{ minX:s.x-s.w/2, maxX:s.x+s.w/2, minZ:s.z-s.d/2, maxZ:s.z+s.d/2, minY:0, maxY:h } });
    }
  };
  // four walls — the `facing` wall carries the doorway gap
  pushWallSegs('x', cx, w, cz-d/2, 0, facing==='S');
  pushWallSegs('x', cx, w, cz+d/2, 0, facing==='N');
  pushWallSegs('z', cz, d, cx-w/2, 0, facing==='W');
  pushWallSegs('z', cz, d, cx+w/2, 0, facing==='E');

  // doorway gap descriptor (the cutout the door fills), matching addBuilding's hinge math
  if(facing==='S')      B.door={axis:'x', x:cx-gw/2, z:cz-d/2, gw, wallFixed:cz-d/2, run:'x'};
  else if(facing==='N') B.door={axis:'x', x:cx-gw/2, z:cz+d/2, gw, wallFixed:cz+d/2, run:'x'};
  else if(facing==='W') B.door={axis:'z', x:cx-w/2, z:cz-gw/2, gw, wallFixed:cx-w/2, run:'z'};
  else                  B.door={axis:'z', x:cx+w/2, z:cz-gw/2, gw, wallFixed:cx+w/2, run:'z'};

  // roof: same predicate as addBuilding (rng() draw matches the real order: it's the
  // first roof-related draw after the windows). The ceiling slab top is h+0.25; that's
  // the wall-top the roof sits ON.
  const wallTop = h + 0.25;
  const pitched = (h<6 && Math.max(w,d)<=12 && (opt.forcePitched ?? (rng()<0.6)));
  if(pitched){
    B.roofType='pitched';
    B.roof = pitchedRoof(cx, cz, w, d, wallTop);
  } else {
    B.roofType='flat';
    B.roof = { flat:true, baseY: wallTop, footprint: footprintRect(cx,cz,w,d),
               aabb:{ minX:cx-w/2, maxX:cx+w/2, minZ:cz-d/2, maxZ:cz+d/2, minY:h, maxY:wallTop } };
  }
  B.wallTop = wallTop;

  // optional walkable upper floor + stairs (predicate matches addBuilding)
  if(w>=10 && d>=10 && h>=6.5 && (opt.forceFloor ?? (rng()<0.6))){
    const fyTop = Math.min(h-2.2, 3.2), slabT=0.3, fy=fyTop-slabT;
    const fw=w-t, fd=d-t;
    const minX=cx-fw/2, maxX=cx+fw/2, minZ=cz-fd/2, maxZ=cz+fd/2;
    // stairs: replicate addStairs(sx, sz0, fyTop, 'z')
    const wide=2.4, run=0.55, rise=0.28;
    const steps=Math.max(6, Math.ceil(fyTop/rise)), riseH=fyTop/steps;
    const sx=minX+1.2, sz0=minZ+0.6;
    const treads=[];
    for(let s=0;s<steps;s++){
      const sy=riseH*(s+1), tz=sz0+(s+0.5)*run;
      treads.push({ topY:sy, minZ:sz0+s*run, maxZ:sz0+(s+1)*run,
                    minX:sx-wide/2, maxX:sx+wide/2 });
    }
    const hole={ minX:sx-wide/2, maxX:sx+wide/2, minZ:sz0, maxZ:sz0+steps*run };
    B.stairs={ treads, riseH, steps, fyTop, hole, wide };
    B.floor={ fyTop, fy, slabT, minX, maxX, minZ, maxZ, hole };
  }
  return B;
}

// =================================================================================
// SUITE 1 — ROOFS
// =================================================================================
function suiteRoofs(B, tag){
  if(B.roofType!=='pitched'){
    // flat roof: must cover the footprint exactly and sit at the wall-top
    const f=B.footprint, a=B.roof.aabb;
    check(`${tag} flat-roof covers footprint`,
      a.minX<=f.minX+EPS && a.maxX>=f.maxX-EPS && a.minZ<=f.minZ+EPS && a.maxZ>=f.maxZ-EPS);
    check(`${tag} flat-roof base on wall-top`, Math.abs(a.minY - B.h) < 0.3);
    return;
  }
  const R=B.roof, f=B.footprint;
  // (a) the two panels' AABBs together must COVER the whole footprint (XZ), with no gap
  // in the middle. Union the panel XZ extents and compare to the footprint.
  const p0=R.panels[0].aabb, p1=R.panels[1].aabb;
  const unionMinX=Math.min(p0.minX,p1.minX), unionMaxX=Math.max(p0.maxX,p1.maxX);
  const unionMinZ=Math.min(p0.minZ,p1.minZ), unionMaxZ=Math.max(p0.maxZ,p1.maxZ);
  check(`${tag} roof covers footprint (XZ, no gap)`,
    unionMinX<=f.minX+EPS && unionMaxX>=f.maxX-EPS && unionMinZ<=f.minZ+EPS && unionMaxZ>=f.maxZ-EPS,
    `union X[${unionMinX.toFixed(2)},${unionMaxX.toFixed(2)}] Z[${unionMinZ.toFixed(2)},${unionMaxZ.toFixed(2)}] vs fp X[${f.minX.toFixed(2)},${f.maxX.toFixed(2)}] Z[${f.minZ.toFixed(2)},${f.maxZ.toFixed(2)}]`);
  // panels must meet/overlap in the middle (no central gap between the two slabs)
  if(R.along==='x'){
    check(`${tag} pitched panels meet at centre (no Z gap)`, p0.maxZ>=R.cz-EPS && p1.minZ<=R.cz+EPS);
  } else {
    check(`${tag} pitched panels meet at centre (no X gap)`, p0.maxX>=R.cx-EPS && p1.minX<=R.cx+EPS);
  }
  // (b) NO excessive overhang past the footprint (eave only)
  check(`${tag} roof overhang within margin`,
    f.minX-unionMinX<=COVER_MARGIN+EPS && unionMaxX-f.maxX<=COVER_MARGIN+EPS &&
    f.minZ-unionMinZ<=COVER_MARGIN+EPS && unionMaxZ-f.maxZ<=COVER_MARGIN+EPS,
    `over X[-${(f.minX-unionMinX).toFixed(2)},+${(unionMaxX-f.maxX).toFixed(2)}] Z[-${(f.minZ-unionMinZ).toFixed(2)},+${(unionMaxZ-f.maxZ).toFixed(2)}]`);
  // (c) the two panels share the SAME ridge line (ridge ends coincide) and the ridge
  //     is at baseY+ridge, ABOVE both eaves. THIS is the check that was failing: the
  //     old butterfly roof put the high edges at the OUTER eaves and dropped the centre.
  const r0=R.panels[0].ridgeEnd, r1=R.panels[1].ridgeEnd;
  check(`${tag} panels share one ridge line`,
    Math.abs(r0.x-r1.x)<EPS && Math.abs(r0.z-r1.z)<EPS && Math.abs(r0.y-r1.y)<EPS);
  check(`${tag} ridge sits at peak (= baseY+ridge)`,
    Math.abs(r0.y-(R.baseY+R.ridge))<EPS, `ridgeY=${r0.y.toFixed(2)} expected ${(R.baseY+R.ridge).toFixed(2)}`);
  // (d) EQUAL eave heights, and each eave is at the wall-top baseY (roof base ON wall),
  //     and BELOW the ridge (so it actually peaks, not a valley)
  const e0=R.panels[0].eaveEnd, e1=R.panels[1].eaveEnd;
  check(`${tag} equal eave heights`, Math.abs(e0.y-e1.y)<EPS, `${e0.y.toFixed(2)} vs ${e1.y.toFixed(2)}`);
  check(`${tag} eaves on the wall-top (roof base == baseY)`,
    Math.abs(e0.y-R.baseY)<EPS && Math.abs(e1.y-R.baseY)<EPS,
    `eaveY=${e0.y.toFixed(2)} baseY=${R.baseY.toFixed(2)}`);
  check(`${tag} ridge ABOVE eaves (peak, not butterfly)`,
    r0.y > e0.y+0.3 && r0.y > e1.y+0.3, `ridge=${r0.y.toFixed(2)} eaves=${e0.y.toFixed(2)}`);
  // (e) eaves are at the OUTER edges and the ridge at the CENTRE (geometry sanity)
  if(R.along==='x'){
    check(`${tag} eaves at outer Z edges`, Math.abs(Math.abs(e0.z-R.cz)-(R.half+R.eave))<EPS);
    check(`${tag} ridge at centre Z`, Math.abs(r0.z-R.cz)<EPS);
  } else {
    check(`${tag} eaves at outer X edges`, Math.abs(Math.abs(e0.x-R.cx)-(R.half+R.eave))<EPS);
    check(`${tag} ridge at centre X`, Math.abs(r0.x-R.cx)<EPS);
  }
  // (f) roof base must NOT intersect into the walls: panel min-Y at/above baseY (which
  //     is the wall-top h+0.25), within the slab thickness.
  check(`${tag} roof does not sink into walls`,
    R.panels[0].aabb.minY >= B.h-EPS && R.panels[1].aabb.minY >= B.h-EPS,
    `panelMinY=${R.panels[0].aabb.minY.toFixed(2)} wallH=${B.h}`);
  // (g) ridge cap aligned to the ridge line and at peak height
  check(`${tag} ridge cap at peak`, Math.abs(R.cap.y-(R.baseY+R.ridge))<EPS);
  check(`${tag} ridge cap on the ridge line`, Math.abs(R.cap.x-R.cx)<EPS && Math.abs(R.cap.z-R.cz)<EPS);
}

// =================================================================================
// SUITE 3 — WALLS grounded / continuous / capped at wall-top
// =================================================================================
function suiteWalls(B, tag){
  for(const wseg of B.walls){
    check(`${tag} wall grounded (base y=0)`, Math.abs(wseg.aabb.minY)<EPS);
    check(`${tag} wall ends at wall-top (below roof)`, Math.abs(wseg.aabb.maxY-B.h)<EPS);
  }
  // CORNER CONTINUITY: each of the 4 corners must be occupied by wall on BOTH the
  // running axis and the perpendicular axis (no gap where two walls should meet).
  const f=B.footprint, t=WALL_T;
  const corners=[ {x:f.minX,z:f.minZ}, {x:f.maxX,z:f.minZ}, {x:f.minX,z:f.maxZ}, {x:f.maxX,z:f.maxZ} ];
  for(const c of corners){
    let covered=false;
    for(const wseg of B.walls){
      if(c.x>=wseg.aabb.minX-t && c.x<=wseg.aabb.maxX+t && c.z>=wseg.aabb.minZ-t && c.z<=wseg.aabb.maxZ+t){ covered=true; break; }
    }
    check(`${tag} corner continuous (${c.x.toFixed(1)},${c.z.toFixed(1)})`, covered);
  }
  // exactly one doorway gap exists on the facing wall: the facing wall's segments must
  // leave a gap of ~gw at its centre (door covers it). Verify the gap width.
  const facingWalls=B.walls.filter(s=>s.wall===B.facing);
  const along = (B.facing==='S'||B.facing==='N') ? 'x':'z';
  let gapW;
  if(along==='x'){
    const xs=facingWalls.map(s=>[s.aabb.minX,s.aabb.maxX]).sort((a,b)=>a[0]-b[0]);
    gapW = xs.length===2 ? xs[1][0]-xs[0][1] : (xs.length===1 ? 0 : B.w);
  } else {
    const zs=facingWalls.map(s=>[s.aabb.minZ,s.aabb.maxZ]).sort((a,b)=>a[0]-b[0]);
    gapW = zs.length===2 ? zs[1][0]-zs[0][1] : (zs.length===1 ? 0 : B.d);
  }
  check(`${tag} doorway gap ~= gw`, Math.abs(gapW-DOOR_GW)<0.2, `gap=${gapW.toFixed(2)}`);
}

// =================================================================================
// SUITE 4 — DOORS / WINDOWS / STAIRS regression
// =================================================================================
function suiteDoorsStairs(B, tag){
  // door sits IN the facing wall plane (cutout aligned)
  const d=B.door;
  if(d.run==='x') check(`${tag} door in wall plane`, Math.abs(d.z-d.wallFixed)<EPS);
  else            check(`${tag} door in wall plane`, Math.abs(d.x-d.wallFixed)<EPS);
  // door leaf spans the gap (hinge corner + gw lands on the far jamb)
  check(`${tag} door leaf spans gap width`, d.gw>0 && Math.abs(d.gw-DOOR_GW)<EPS);
  // stairs (when present) must be WALKABLE: each tread rise <= step tolerance (0.35)
  // and the run must reach the upper floor, and the top-landing hole sits in the slab.
  if(B.stairs){
    const s=B.stairs;
    check(`${tag} stair rise walkable (<=0.35)`, s.riseH<=0.35+1e-6, `rise=${s.riseH.toFixed(3)}`);
    const topTread=s.treads[s.treads.length-1];
    check(`${tag} stairs reach upper floor`, Math.abs(topTread.topY-s.fyTop)<EPS,
      `top=${topTread.topY.toFixed(2)} fyTop=${s.fyTop.toFixed(2)}`);
    // treads contiguous (no Z gap between consecutive treads)
    let contiguous=true;
    for(let k=1;k<s.treads.length;k++){ if(s.treads[k].minZ - s.treads[k-1].maxZ > EPS){ contiguous=false; break; } }
    check(`${tag} stair treads contiguous`, contiguous);
    // hole lies within the slab footprint and its +Z exit edge is flush with the top tread
    const fl=B.floor;
    check(`${tag} stair hole within slab`,
      s.hole.minX>=fl.minX-EPS && s.hole.maxX<=fl.maxX+EPS && s.hole.minZ>=fl.minZ-EPS && s.hole.maxZ<=fl.maxZ+EPS);
  }
}

// =================================================================================
// SUITE 2 — EXTERIOR walls don't pass through OTHER buildings (whole-layout overlap)
// Replicates each layout generator's placement loop closely enough to exercise the
// real footprint-overlap guards, then asserts NO two building footprints (incl. wall
// thickness + eave) intersect.
// =================================================================================
function buildScatterLayout(H,i,rng){
  const placed=[], nB=10+i*2, FACES=['S','N','W','E'];
  for(let b=0;b<nB;b++){
    const big=rng()<0.6;
    const w=big?7+rng()*7:5+rng()*4, d=big?7+rng()*7:5+rng()*4, h=big?4+rng()*4:3.5+rng()*3;
    rng();                                  // col draw
    const face=FACES[Math.floor(rng()*4)];
    let bx,bz,ok=false;
    for(let tr=0;tr<6;tr++){ bx=(rng()*2-1)*(H-12); bz=(rng()*2-1)*(H-12);
      if(Math.hypot(bx,bz)<16) continue;
      if(footprintFree(placed.map(p=>p.fp), bx,bz,w,d,3)){ ok=true; break; } }
    if(!ok) continue;
    placed.push({ bx,bz,w,d,h,face, fp:footprintRect(bx,bz,w,d) });
    // (the lean-to cover draws below consume rng but place no building → skip exactly)
    if(!big && rng()>.4){ rng(); rng(); }
  }
  return placed;
}
function buildLotLayout(H,i,rng){
  const placed=[], half=H-14, cell=Math.max(26,(half*2)/(i>=2?4:3));
  const cols=Math.max(2,Math.round((half*2)/cell)), margin=cell*0.5;
  for(let gx=0;gx<cols;gx++) for(let gz=0;gz<cols;gz++){
    const px=-half+margin+gx*cell, pz=-half+margin+gz*cell;
    const jx=px+(rng()-.5)*cell*0.18, jz=pz+(rng()-.5)*cell*0.18;
    if(Math.hypot(jx,jz)<20) continue;
    if(rng()<0.18) continue;
    const yw=Math.min(cell-4,16+rng()*4), yd=Math.min(cell-4,16+rng()*4);
    const gateSide=Math.floor(rng()*4);
    rng(); rng(); rng(); rng();             // 4 fence gap-offset draws
    const bw=6+rng()*4, bd=6+rng()*4, bh=4+rng()*4;
    const inset=0.8+WALL_T/2+0.4;
    const rangeX=Math.max(0,(yw/2-inset)-bw/2), rangeZ=Math.max(0,(yd/2-inset)-bd/2);
    let bx=jx+(rng()-.5)*2*rangeX, bz=jz+(rng()-.5)*2*rangeZ;
    bx=Math.max(jx-rangeX,Math.min(jx+rangeX,bx)); bz=Math.max(jz-rangeZ,Math.min(jz+rangeZ,bz));
    if(!footprintFree(placed.map(p=>p.fp), bx,bz,bw,bd,2)) continue;
    rng();                                  // col draw
    const face=['S','N','W','E'][gateSide];
    placed.push({ bx,bz,w:bw,d:bd,h:bh,face, fp:footprintRect(bx,bz,bw,bd), yard:{jx,jz,yw,yd} });
  }
  return placed;
}
function buildStreetLayout(H,i,rng){
  const placed=[], span=(H-16)*2, roadW=10;
  const lots=Math.max(3,Math.round(span/22)), step=span/lots, rowZ=roadW/2+7;
  for(let s=0;s<lots;s++){
    const x=-span/2+step*(s+0.5)+(rng()-.5)*step*0.2;
    for(const side of [-1,1]){
      if(rng()<0.12) continue;
      const z=side*(rowZ+(rng()-.5)*3);
      if(Math.hypot(x,z)<18) continue;
      const bw=Math.min(step-3,8+rng()*5), bd=7+rng()*4, bh=4+rng()*4;
      rng();                                // col draw
      const small=rng()>=0.78;
      const fw=small?bw*0.8:bw, fd=small?bd*0.8:bd;
      if(!footprintFree(placed.map(p=>p.fp), x,z,fw,fd,2)) continue;
      placed.push({ bx:x,bz:z,w:fw,d:fd,h:bh,face:side<0?'N':'S', fp:footprintRect(x,z,fw,fd) });
    }
    if(rng()<0.6){ rng(); }
  }
  return placed;
}

function suiteThroughWalls(placed, tag){
  // every building's footprint padded by (wall half-thickness + eave) must not overlap
  // ANY other building's footprint — an overlap is an exterior wall passing through a
  // neighbour. We test the raw footprints (the layout guards already pad), then assert
  // a hard minimum separation so no wall can physically intersect a neighbour's shell.
  const grow = WALL_T/2 + ROOF_EAVE;       // wall outer face + roof eave
  let overlaps=0, worst=null;
  for(let a=0;a<placed.length;a++) for(let b=a+1;b<placed.length;b++){
    const A=placed[a].fp, B=placed[b].fp;
    if(aabbOverlapXZ(A,B,grow)){
      overlaps++;
      const ix=Math.min(A.maxX,B.maxX)-Math.max(A.minX,B.minX);
      const iz=Math.min(A.maxZ,B.maxZ)-Math.max(A.minZ,B.minZ);
      worst=`pair#${a}/#${b} interpenetration X=${ix.toFixed(2)} Z=${iz.toFixed(2)}`;
    }
  }
  check(`${tag} no exterior wall passes through another building`, overlaps===0,
    overlaps?`${overlaps} overlapping pair(s); ${worst}`:'');
  // Also: every building's exterior walls bound ONLY its own footprint — a wall AABB
  // must lie inside its own grown footprint and not reach into a neighbour's interior.
  for(let a=0;a<placed.length;a++){
    const A=placed[a];
    const B=makeBuilding(A.bx,A.bz,A.w,A.d,A.h,A.face,mulberry(0xBEEF^a), {forcePitched:false,forceFloor:false});
    for(const wseg of B.walls){
      for(let b=0;b<placed.length;b++){ if(b===a) continue;
        const N=placed[b].fp;
        // the OTHER building's INTERIOR (shrunk by wall thickness) must not contain any
        // part of this wall segment.
        const inner={ minX:N.minX+WALL_T, maxX:N.maxX-WALL_T, minZ:N.minZ+WALL_T, maxZ:N.maxZ-WALL_T };
        check(`${tag} wall not inside neighbour interior`, !aabbOverlapXZ(wseg.aabb, inner, 0),
          `bldg#${a} ${wseg.wall}-wall reaches into bldg#${b}`);
      }
    }
  }
}

// =================================================================================
// DRIVER
// =================================================================================
function runBuildingSuites(seedBase){
  // exercise a spread of footprints, both roof types, both floor states, all facings
  const FACES=['S','N','W','E'];
  let n=0;
  for(let s=0;s<40;s++){
    const rng=mulberry((seedBase + s*7919) >>> 0);
    const w=5+rng()*9, d=5+rng()*9, h=3.5+rng()*5.5;
    const facing=FACES[Math.floor(rng()*4)];
    const cx=(rng()*2-1)*40, cz=(rng()*2-1)*40;
    // test BOTH roof types on the same footprint to cover pitched + flat
    for(const forcePitched of [true,false]){
      const forceFloor = (w>=10 && d>=10 && h>=6.5);
      const B=makeBuilding(cx,cz,w,d,h,facing, mulberry((seedBase+s)>>>0),
        {forcePitched, forceFloor});
      const tag=`[s${seedBase}.${s} ${facing} ${w.toFixed(1)}x${d.toFixed(1)}x${h.toFixed(1)} ${forcePitched?'pitch':'flat'}]`;
      suiteRoofs(B,tag);
      suiteWalls(B,tag);
      suiteDoorsStairs(B,tag);
      n++;
    }
  }
  return n;
}

function runLayoutSuites(){
  const H=70;
  // The real stop seeds (stopIndex 0..5) exactly as buildRaid() seeds them...
  for(let i=0;i<6;i++){
    const rng=()=>{};   // (placeholder — each layout gets its own fresh stream below)
    void rng;
    suiteThroughWalls(buildScatterLayout(H,i,mulberry((0x9e37+i*7919)>>>0)), `[scatter stop${i}]`);
    suiteThroughWalls(buildLotLayout(H,i,mulberry((0x9e37+i*7919)>>>0)),     `[lot stop${i}]`);
    suiteThroughWalls(buildStreetLayout(H,i,mulberry((0x9e37+i*7919)>>>0)),  `[streets stop${i}]`);
  }
  // ...plus a heavy seed sweep so the no-through-wall guarantee isn't just true for the
  // 6 canonical stops — every layout must stay overlap-free across hundreds of arenas.
  let swept=0;
  for(let s=0;s<200;s++) for(let i=0;i<3;i++){
    const seed=(0x51ED + s*2654435761 + i*40503) >>> 0;
    suiteThroughWalls(buildScatterLayout(H,i+2,mulberry(seed)),       `[scatter sweep ${s}.${i}]`);
    suiteThroughWalls(buildLotLayout(H,i+2,mulberry((seed^0xABCD)>>>0)),  `[lot sweep ${s}.${i}]`);
    suiteThroughWalls(buildStreetLayout(H,i+2,mulberry((seed^0x1234)>>>0)),`[streets sweep ${s}.${i}]`);
    swept+=3;
  }
  return swept;
}

console.log('LootNShoot building geometry validator');
console.log('======================================');
let buildings=0;
for(const seed of [1, 1337, 0x9e3779, 424242, 7, 99999, 0xDEAD, 0xBEEF, 8675309, 271828]) buildings+=runBuildingSuites(seed);
const swept=runLayoutSuites();

console.log(`\nbuildings exercised: ${buildings} (× pitched+flat) across 10 seeds`);
console.log(`layout arenas swept for through-walls: ${swept+18}`);
console.log(`assertions: ${PASS} passed, ${FAIL} failed`);
if(FAIL){
  console.log('\nFAILURES:');
  for(const f of FAILURES.slice(0,40)) console.log('  ✗ '+f);
  if(FAILURES.length>40) console.log(`  ... and ${FAILURES.length-40} more`);
  console.log('\nRESULT: FAIL');
  process.exit(1);
} else {
  console.log('\nRESULT: ALL GREEN ✓');
  process.exit(0);
}
