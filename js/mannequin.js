// mannequin.js — SYS: Mannequin. Builds a standalone, CENTERED procedural
// humanoid display model (simple boxes/cylinders — placeholder art) for the
// inventory paper-doll preview. It reflects EQUIPPED gear: a helmet box on the
// head, an armor plate + rig webbing on the torso, and the equipped weapon held
// in the hands (reusing Weapons.buildPreviewModel so the held gun matches the
// gunsmith render, attachments and all).
//
// Independent of any in-world meshes. The caller (UI inventory screen) feeds the
// result to a Preview handle (createPreview) which frames/spins/disposes it — so
// this module just assembles geometry and never touches the renderer or RAF.
// Three stays the global CDN build; reach it through the shim like every module.
import { T } from "./three.js";
import { rarityColor } from "./util.js";
import { Weapons } from "./weapons.js";

// shared material factories (each mesh gets its own material instance so the
// preview's recursive dispose can free them cleanly without double-frees)
const skin  = () => new T.MeshStandardMaterial({ color: 0x6f7a86, roughness: 0.75, metalness: 0.08 });
const suit  = () => new T.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.85, metalness: 0.12 });
const rarMat = (r) => new T.MeshStandardMaterial({ color: rarityColor(r || 1), roughness: 0.55, metalness: 0.35 });

// small helper: a box mesh placed at (x,y,z)
function box(w, h, d, mat, x, y, z) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
  m.position.set(x || 0, y || 0, z || 0);
  return m;
}

// buildMannequin(equip) -> THREE.Group, centered near origin, facing +Z.
// equip is S.profile.equip (slots: helmet, armor, rig, backpack, primary,
// secondary). Any/all slots may be empty — the base body always renders so an
// unarmored, unarmed character still shows.
export function buildMannequin(equip) {
  equip = equip || {};
  const g = new T.Group();

  // ---- base humanoid body (always present) ----
  // proportions are rough/blocky on purpose; the model is built standing with
  // its feet near y=0 and head near y~1.85, then re-centered by the preview.
  const torso = box(0.5, 0.62, 0.28, suit(), 0, 1.18, 0);          // chest/abdomen
  g.add(torso);
  const hips = box(0.46, 0.22, 0.27, suit(), 0, 0.80, 0);
  g.add(hips);

  // neck + head
  const neck = box(0.13, 0.1, 0.13, skin(), 0, 1.55, 0);
  g.add(neck);
  const head = box(0.27, 0.3, 0.27, skin(), 0, 1.74, 0);
  g.add(head);

  // arms (upper + fore) — angled slightly forward so they read as "holding"
  function arm(side) {
    const sx = side * 0.36;
    const upper = new T.Mesh(new T.CylinderGeometry(0.075, 0.07, 0.42, 10), skin());
    upper.position.set(sx, 1.22, 0.04);
    upper.rotation.x = -0.35;
    g.add(upper);
    const fore = new T.Mesh(new T.CylinderGeometry(0.065, 0.055, 0.4, 10), skin());
    fore.position.set(sx * 0.78, 0.98, 0.26);
    fore.rotation.x = -1.0;
    g.add(fore);
    const hand = box(0.1, 0.12, 0.1, skin(), sx * 0.62, 0.86, 0.42);
    g.add(hand);
  }
  arm(-1);
  arm(1);

  // legs
  function leg(side) {
    const sx = side * 0.14;
    const thigh = new T.Mesh(new T.CylinderGeometry(0.1, 0.09, 0.5, 10), suit());
    thigh.position.set(sx, 0.5, 0);
    g.add(thigh);
    const shin = new T.Mesh(new T.CylinderGeometry(0.08, 0.06, 0.5, 10), suit());
    shin.position.set(sx, 0.05, 0);
    g.add(shin);
    const foot = box(0.13, 0.1, 0.28, suit(), sx, -0.18, 0.06);
    g.add(foot);
  }
  leg(-1);
  leg(1);

  // ---- EQUIPPED gear overlays ----

  // helmet: a slightly oversized shell over the head, tinted by rarity, with a
  // dark visor band across the front.
  if (equip.helmet) {
    const r = equip.helmet.def.rarity;
    const shell = box(0.31, 0.2, 0.31, rarMat(r), 0, 1.82, 0);
    g.add(shell);
    const visor = box(0.3, 0.07, 0.04, new T.MeshStandardMaterial({
      color: 0x0c1418, roughness: 0.3, metalness: 0.6, emissive: 0x0a2230, emissiveIntensity: 0.4,
    }), 0, 1.74, 0.15);
    g.add(visor);
  }

  // body armor: a thicker plate carrier wrapping the torso, rarity-tinted, with
  // a couple of plate seams so it doesn't read as a plain box.
  if (equip.armor) {
    const r = equip.armor.def.rarity;
    const plate = box(0.56, 0.5, 0.34, rarMat(r), 0, 1.22, 0.01);
    g.add(plate);
    const upperPlate = box(0.5, 0.22, 0.36, rarMat(r), 0, 1.34, 0.0);
    g.add(upperPlate);
  }

  // chest rig: webbing + pouches on the front of the torso (sits proud of the
  // armor if both are equipped). Three small pouch boxes.
  if (equip.rig) {
    const r = equip.rig.def.rarity;
    const webbing = box(0.46, 0.34, 0.06, suit(), 0, 1.12, 0.2);
    g.add(webbing);
    for (let i = 0; i < 3; i++) {
      const pouch = box(0.12, 0.14, 0.08, rarMat(r), -0.16 + i * 0.16, 1.08, 0.24);
      g.add(pouch);
    }
  }

  // backpack: a block on the upper back (-Z), rarity-tinted.
  if (equip.backpack) {
    const r = equip.backpack.def.rarity;
    const pack = box(0.42, 0.5, 0.22, rarMat(r), 0, 1.2, -0.24);
    g.add(pack);
  }

  // held weapon: reuse the gunsmith preview model so the held gun matches the
  // configured weapon (attachments included). Prefer the primary, else the
  // secondary. Pose it across the front of the chest in the hands.
  const heldWeapon = equip.primary || equip.secondary;
  if (heldWeapon) {
    const gun = Weapons.buildPreviewModel(heldWeapon);
    // buildPreviewModel returns a gun roughly centered on its receiver, lying
    // along +X, pre-rotated for the gunsmith 3/4 view. Undo that yaw, scale it
    // down to mannequin proportions, lay it across the chest, muzzle to the
    // model's left, canted toward the hands.
    gun.rotation.set(0, 0, 0);
    gun.scale.setScalar(0.62);
    gun.position.set(0.05, 0.96, 0.34);
    gun.rotation.z = 0.18;
    gun.rotation.y = 0.12;
    g.add(gun);
  }

  return g;
}
