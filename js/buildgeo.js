// buildgeo.js — PURE building geometry math (NO THREE, NO DOM). Single source of
// truth shared by world.js (which turns these numbers into meshes/colliders) and
// scripts/geo-validate.mjs (which asserts on them). Keeping the math here means the
// validator can never drift from what the game actually builds.
//
// All functions are side-effect-free: they take dimensions and return plain
// descriptors (positions, sizes, world-space AABBs). world.js consumes them; the
// validator AABB-checks them. If you change roof/wall geometry, change it HERE.

export const WALL_T = 0.4;          // structural wall thickness
export const DOOR_GW = 2.6;         // doorway gap width
export const ROOF_EAVE = 0.35;      // pitched-roof overhang past the wall (drip edge)

// ---- WALL SEGMENTS AROUND A DOORWAY GAP -----------------------------------
// Mirror of world.js wallWithGap(): a straight wall (along 'x' or 'z') with a gap
// punched in it, returned as 0..2 solid segments. Each segment is an addBox-style
// descriptor {x,z,w,d} (full-height; caller supplies h). `fx` is the wall's centre
// on its run axis, `fixed` the perpendicular coordinate, `len` its length, `gap`
// the gap centre offset from the wall centre, `gw` the gap width.
export function wallSegments(axis, fx, len, fixed, gap, gw){
  gw = gw || DOOR_GW; const t = WALL_T;
  const g = Math.max(-len/2 + gw/2, Math.min(len/2 - gw/2, gap)); // keep gap inside the wall
  const segA = (g - gw/2) - (-len/2), cA = (-len/2 + (g - gw/2)) / 2;
  const segB = (len/2) - (g + gw/2),  cB = ((g + gw/2) + len/2) / 2;
  const out = [];
  if(axis === 'x'){
    if(segA > 0.05) out.push({ x: fx + cA, z: fixed, w: segA, d: t });
    if(segB > 0.05) out.push({ x: fx + cB, z: fixed, w: segB, d: t });
  } else {
    if(segA > 0.05) out.push({ x: fixed, z: fx + cA, w: t, d: segA });
    if(segB > 0.05) out.push({ x: fixed, z: fx + cB, w: t, d: segB });
  }
  return out;
}

// ---- PITCHED ROOF GEOMETRY -------------------------------------------------
// The single source of truth for the pitched roof. Given a building footprint
// (cx,cz,w,d), the wall-top height it sits on (baseY) and a peak, returns a fully
// described roof: two slope panels (each a flat slab rotated about an axis), a
// ridge cap, and two gable triangles — plus, for every piece, its WORLD-SPACE
// axis-aligned bounding box so the validator can assert coverage / ridge meeting /
// eave height without re-deriving any trig.
//
// CORRECTNESS (the bug PR#34 missed): a flat slab whose depth runs along +span and
// is rotated about the perpendicular axis must tilt so its OUTER end (the eave)
// drops to baseY and its INNER end (the ridge) rises to baseY+ridge. That requires
// the +side panel to rotate by +tilt about its axis and the -side by -tilt (the old
// code used the opposite sign, which lifted the eaves and dropped the centre — an
// inverted "butterfly" roof whose panels floated away from the ridge cap).
export function pitchedRoof(cx, cz, w, d, baseY, opt = {}){
  const along = w >= d ? 'x' : 'z';            // ridge runs along the LONG axis
  const span  = along === 'x' ? d : w;         // dimension the slopes cover
  const len   = along === 'x' ? w : d;         // dimension the ridge runs
  const ridge = Math.min(2.4, Math.max(2.0, span * 0.32)); // peak height above the eave
  const eave  = opt.eave != null ? opt.eave : ROOF_EAVE;    // overhang past the wall
  const half  = span / 2;
  const slopeLen = Math.hypot(half + eave, ridge);         // eave→ridge run incl. overhang
  const tilt  = Math.atan2(ridge, half + eave);            // panel pitch
  const thick = 0.14;

  const panels = [];
  for(const side of [-1, 1]){
    // Panel centre is the midpoint of the sloped face: half-way out (along span) and
    // half-way up. Rotating a flat slab (depth = slopeLen along the span axis) about
    // the perpendicular axis by `rot` lands its two ends on the eave and the ridge.
    //
    //   horizontal half-projection = (slopeLen/2)·cos(tilt) = (half+eave)/2
    //   vertical   half-projection = (slopeLen/2)·sin(tilt) = ridge/2
    //
    // We want, on the +side: OUTER end (span = +(half+eave)) LOW at baseY, INNER end
    // (span = 0, the ridge) HIGH at baseY+ridge. With the slab depth pointing +span,
    // a rotation that sends local +depth DOWN does this. For rotation about X
    // (along==='x', depth on +Z): rotation.x = +tilt sends local +Z down. For
    // rotation about Z (along==='z', depth on +X): rotation.z = -tilt sends local +X
    // down. The -side is the mirror, so it gets the opposite sign.
    const offMid = side * (half + eave) / 2;     // panel centre offset along the span axis
    const cyMid  = baseY + ridge / 2;            // panel centre height
    const rot    = along === 'x' ? side * tilt : -side * tilt;
    // EVERYTHING below is DERIVED by actually applying `rot` to the flat slab's local
    // geometry, so the descriptor reflects exactly what world.js renders. If `rot` had
    // the wrong sign (the PR#34 butterfly bug) the eave/ridge ends + AABB move with it
    // and the validator catches it — the descriptor is never hand-asserted to be right.
    //
    // local slab: depth (slopeLen) runs along the SPAN-local axis, thin height along Y,
    // placed so local +depth points toward +span (the side's outer/eave direction is
    // +depth for side=+1 and −depth for side=−1). Rotating the depth-axis end through
    // `rot` and translating by the panel centre gives each end's world span & height.
    const ax = { x: cx, z: cz, len, span: half + eave, side, offMid, cyMid, rot, thick };
    const c = Math.cos(rot), si = Math.sin(rot);
    // end at signed local depth `s`, applying the SAME THREE rotation world.js uses:
    //   along==='x' → slab.rotation.x=rot : Rx(θ) on local (0,0,s) → z'=s·cosθ, y'=−s·sinθ
    //   along==='z' → slab.rotation.z=rot : Rz(θ) on local (s,0,0) → x'=s·cosθ, y'=+s·sinθ
    // depthWorld (the span displacement) is s·cosθ either way; the Y sign flips by axis.
    const ySign = along === 'x' ? -1 : 1;
    const endAt = s => ({ span: s*c + offMid, y: ySign*s*si + cyMid });
    // local +slopeLen/2 is the OUTER (eave) end for side=+1; for side=−1 the outer end
    // is local −slopeLen/2. Use `side` so `outer` is always the eave, `inner` the ridge.
    const outer = endAt(side*slopeLen/2);   // eave (outer edge of footprint)
    const inner = endAt(-side*slopeLen/2);  // ridge (building centre)
    const minSpan = Math.min(inner.span, outer.span), maxSpan = Math.max(inner.span, outer.span);
    const minY = Math.min(inner.y, outer.y) - thick*Math.abs(c)*0.5;
    const maxY = Math.max(inner.y, outer.y) + thick*Math.abs(c)*0.5;
    if(along === 'x'){
      ax.aabb     = { minX: cx-len/2, maxX: cx+len/2, minZ: cz+minSpan, maxZ: cz+maxSpan, minY, maxY };
      ax.ridgeEnd = { x: cx, z: cz+inner.span, y: inner.y };
      ax.eaveEnd  = { x: cx, z: cz+outer.span, y: outer.y };
    } else {
      ax.aabb     = { minX: cx+minSpan, maxX: cx+maxSpan, minZ: cz-len/2, maxZ: cz+len/2, minY, maxY };
      ax.ridgeEnd = { x: cx+inner.span, z: cz, y: inner.y };
      ax.eaveEnd  = { x: cx+outer.span, z: cz, y: outer.y };
    }
    panels.push(ax);
  }

  const cap = {
    x: cx, z: cz, y: baseY + ridge,
    w: along === 'x' ? len + 0.1 : 0.3,
    d: along === 'x' ? 0.3 : len + 0.1,
    h: 0.16,
  };

  const gables = [];
  for(const end of [-1, 1]){
    if(along === 'x') gables.push({ cx: cx + end*len/2, cz, base: span, peak: ridge, baseY, faceAxis: 'x' });
    else              gables.push({ cx, cz: cz + end*len/2, base: span, peak: ridge, baseY, faceAxis: 'z' });
  }

  return { along, span, len, ridge, eave, half, slopeLen, tilt, baseY, cx, cz, w, d,
           panels, cap, gables,
           footprint: { minX: cx - w/2, maxX: cx + w/2, minZ: cz - d/2, maxZ: cz + d/2 } };
}

// ---- LAYOUT OVERLAP TEST ----------------------------------------------------
// Mirror of world.js footprintFree(): true when an axis-aligned (cx,cz,w,d) plot,
// padded by `pad`, does NOT overlap any rect already in `placed`. Used by EVERY
// layout generator before it commits a building, so no two buildings interpenetrate
// (the through-wall bug). `placed` is an array of {minX,maxX,minZ,maxZ}.
export function footprintFree(placed, cx, cz, w, d, pad){
  pad = pad == null ? 2 : pad;
  const aMinX = cx - w/2 - pad, aMaxX = cx + w/2 + pad;
  const aMinZ = cz - d/2 - pad, aMaxZ = cz + d/2 + pad;
  for(const f of placed){
    if(aMinX < f.maxX && aMaxX > f.minX && aMinZ < f.maxZ && aMaxZ > f.minZ) return false;
  }
  return true;
}
export function footprintRect(cx, cz, w, d){
  return { minX: cx - w/2, maxX: cx + w/2, minZ: cz - d/2, maxZ: cz + d/2 };
}
