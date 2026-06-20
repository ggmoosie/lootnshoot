// data.js — DATA.* pure tables. Tune the game here. No behavior.

export const DATA = {};

// ----- items: id -> def. size=[w,h] grid footprint. stack default 1. -----
DATA.items = {
  ammo_556:{name:'5.56 Ammo', type:'ammo', cal:'556', size:[1,1], stack:60, value:2, rarity:1},
  ammo_9mm:{name:'9mm Ammo',  type:'ammo', cal:'9mm', size:[1,1], stack:60, value:1, rarity:1},
  ammo_762:{name:'7.62 Ammo', type:'ammo', cal:'762', size:[1,1], stack:40, value:4, rarity:1},
  wpn_carbine:{name:'MK1 Carbine', type:'weapon', weapon:'carbine', size:[4,2], value:800, rarity:2},
  wpn_smg:{name:'Vector SMG',  type:'weapon', weapon:'smg', size:[3,2], value:550, rarity:2},
  wpn_dmr:{name:'M14 DMR',     type:'weapon', weapon:'dmr', size:[5,2], value:1600, rarity:3},
  wpn_pistol:{name:'P9 Sidearm', type:'weapon', weapon:'pistol', size:[2,2], value:200, rarity:1},
  att_reddot:{name:'Red Dot',    type:'attachment', slot:'optic', size:[1,1], value:300, rarity:2},
  att_scope:{name:'4x Scope',    type:'attachment', slot:'optic', size:[2,1], value:650, rarity:3},
  att_suppressor:{name:'Suppressor', type:'attachment', slot:'muzzle', size:[1,1], value:450, rarity:3},
  att_grip:{name:'Vert Grip',    type:'attachment', slot:'tactical', size:[1,1], value:150, rarity:2},
  arm_lvl2:{name:'Vest II',  type:'armor', armor:30, size:[2,3], value:600, rarity:2},
  arm_lvl4:{name:'Vest IV',  type:'armor', armor:60, size:[2,3], value:1800, rarity:4},
  helm_lvl2:{name:'Helmet II', type:'helmet', armor:18, size:[2,2], value:400, rarity:2},
  bag_small:{name:'Pack 6x6', type:'backpack', grid:[6,6], size:[3,3], value:300, rarity:2},
  bag_large:{name:'Pack 8x8', type:'backpack', grid:[8,8], size:[4,4], value:900, rarity:3},
  rig_basic:{name:'Chest Rig', type:'rig', grid:[4,4], size:[3,3], value:250, rarity:2},
  med_bandage:{name:'Bandage', type:'med', heal:25, cure:'bleed', size:[1,1], stack:6, value:40, rarity:1},
  med_kit:{name:'Med Kit', type:'med', heal:80, cure:'bleed', size:[1,2], value:220, rarity:2},
  stim:{name:'Combat Stim', type:'med', heal:15, buff:'speed', size:[1,1], value:300, rarity:3},
  food_ration:{name:'Ration', type:'food', heal:12, size:[1,1], stack:4, value:30, rarity:1},
  nade_frag:{name:'Frag Grenade', type:'throwable', dmg:130, radius:6, size:[1,1], stack:3, value:160, rarity:2},
  mat_scrap:{name:'Scrap', type:'material', size:[1,1], stack:30, value:18, rarity:1},
  mat_elec:{name:'Electronics', type:'material', size:[1,1], stack:15, value:60, rarity:2},
  mat_filament:{name:'Filament', type:'material', size:[1,1], stack:30, value:25, rarity:1},
  val_cash:{name:'Cash Stack', type:'valuable', size:[1,1], stack:50, value:120, rarity:2},
  val_gold:{name:'Gold Bar', type:'valuable', size:[1,2], value:1400, rarity:4},
  drone_kit:{name:'Recon Drone Kit', type:'deployable', deploy:'drone', size:[2,2], value:900, rarity:3},
  key_office:{name:'Office Key', type:'key', size:[1,1], value:400, rarity:3},
};
for(const k in DATA.items) DATA.items[k].id=k;   // each def carries its own id (serialize/icons/stacking rely on it)

// ----- weapons: base stats. Computed stats apply attachment mods on top. -----
// NOTE: `slots` now spans the full gunsmith slot set (see "GUNSMITH DEPTH"
// section below). `velocity` (m/s, flavor + barrel scaling) and `hipAccuracy`
// (1=baseline; lasers raise it, tightening hipfire spread) are new effective
// stats with safe defaults applied in Weapons.stats().
DATA.weapons = {
  carbine:{name:'MK1 Carbine', cal:'556', damage:26, rpm:540, mag:30, reload:1.8, spread:0.013, adsSpread:0.003, adsTime:0.25, recoil:0.012, range:90, eff:58, velocity:880, zoom:1, modes:['auto','burst','semi'], slots:['optic','muzzle','foregrip','stock','laser','magazine','barrel']},
  smg:{name:'Vector SMG', cal:'9mm', damage:18, rpm:780, mag:25, reload:1.5, spread:0.022, adsSpread:0.007, adsTime:0.18, recoil:0.009, range:50, eff:26, velocity:420, zoom:1, modes:['auto','semi'], slots:['optic','muzzle','foregrip','stock','laser','magazine','barrel']},
  dmr:{name:'M14 DMR', cal:'762', damage:58, rpm:200, mag:20, reload:2.2, spread:0.006, adsSpread:0.001, adsTime:0.35, recoil:0.022, range:160, eff:135, velocity:850, zoom:1, modes:['semi'], slots:['optic','muzzle','foregrip','stock','laser','magazine','barrel']},
  pistol:{name:'P9 Sidearm', cal:'9mm', damage:20, rpm:380, mag:15, reload:1.2, spread:0.022, adsSpread:0.008, adsTime:0.15, recoil:0.01, range:40, eff:20, velocity:380, zoom:1, modes:['semi'], slots:['optic','muzzle','laser','magazine','barrel']},
};

// ----- attachments: slot + stat effects. -----
// `mods`   = MULTIPLICATIVE deltas applied to the named effective stat.
// `add`    = ADDITIVE deltas (used where a multiplier is awkward, e.g. capacity
//            and the 1.0-baselined handling/hipAccuracy/mobility scalars).
// `zoom`   = sets the optic zoom outright. `quiet` = suppresses the shot.
// The full set lives in the "GUNSMITH DEPTH" section below; the four originals
// are kept here (att_grip moved optic->foregrip slot) so old saves still apply.
DATA.attachments = {
  att_reddot:{slot:'optic', mods:{adsSpread:0.7, adsTime:0.95}, zoom:1.15},
  att_scope:{slot:'optic', mods:{adsSpread:0.4, adsTime:1.2}, zoom:2.2},
  att_suppressor:{slot:'muzzle', mods:{recoil:0.7, damage:0.96, spread:0.95}, quiet:true},
  att_grip:{slot:'foregrip', mods:{recoil:0.8, spread:0.85}, add:{handling:0.1}},
};

// ----- enemy roles: behavior is parameterized, not hand-coded per enemy. -----
DATA.enemies = {
  guard:{name:'Guard', hp:75, dmg:8, accuracy:0.55, speed:2.2, fireDelay:1.0, range:55, behavior:'hold', tier:1, kit:{wpn:['wpn_carbine','wpn_smg'], armor:0.40, helmet:0.30, att:0.35}},
  patroller:{name:'Patrol', hp:60, dmg:6, accuracy:0.45, speed:2.7, fireDelay:1.2, range:48, behavior:'patrol', tier:1, kit:{wpn:['wpn_smg','wpn_pistol'], armor:0.15, helmet:0.10, att:0.20}},
  lookout:{name:'Lookout', hp:50, dmg:5, accuracy:0.5, speed:2.5, fireDelay:1.3, range:75, behavior:'hold', alertRadius:40, tier:1, kit:{wpn:['wpn_smg'], armor:0.20, helmet:0.40, att:0.35, optic:'att_reddot'}},
  rusher:{name:'Rusher', hp:58, dmg:11, accuracy:0.4, speed:4.2, fireDelay:0.65, range:60, behavior:'rush', tier:2, kit:{wpn:['wpn_smg'], armor:0.35, helmet:0.15, att:0.25}},
  heavy:{name:'Heavy', hp:150, dmg:13, accuracy:0.5, speed:1.6, fireDelay:1.1, range:55, behavior:'hold', tier:2, kit:{wpn:['wpn_carbine'], armor:0.90, helmet:0.65, att:0.55, heavyArmor:true}},
  sniper:{name:'Sniper', hp:55, dmg:42, accuracy:0.72, speed:1.7, fireDelay:2.6, range:150, behavior:'snipe', tier:3, kit:{wpn:['wpn_dmr'], armor:0.30, helmet:0.55, att:0.85, optic:'att_scope'}},
};

// ----- loot tables: weighted. qty range for stackables. -----
DATA.loot = {
  crate_common:[
    {id:'mat_scrap',w:6,min:2,max:6},{id:'mat_filament',w:5,min:2,max:6},{id:'ammo_556',w:5,min:10,max:30},
    {id:'ammo_9mm',w:5,min:10,max:30},{id:'med_bandage',w:4},{id:'food_ration',w:4,min:1,max:2},
    {id:'mat_elec',w:3,min:1,max:3},{id:'val_cash',w:3,min:1,max:3},{id:'att_grip',w:2},{id:'med_kit',w:2},
  ],
  crate_rare:[
    {id:'att_reddot',w:4},{id:'att_suppressor',w:3},{id:'att_scope',w:2},{id:'arm_lvl2',w:3},
    {id:'helm_lvl2',w:3},{id:'wpn_smg',w:2},{id:'wpn_carbine',w:2},{id:'val_gold',w:2},
    {id:'arm_lvl4',w:1},{id:'wpn_dmr',w:1},{id:'key_office',w:2},{id:'stim',w:2},{id:'drone_kit',w:1},
  ],
  enemy_drop:[
    {id:'ammo_556',w:6,min:8,max:24},{id:'ammo_9mm',w:6,min:8,max:24},{id:'val_cash',w:5,min:1,max:2},
    {id:'med_bandage',w:4},{id:'mat_scrap',w:4,min:1,max:3},{id:'nade_frag',w:2},{id:'att_grip',w:2},{id:'ammo_762',w:2,min:6,max:16},
  ],
  cont_locker:[
    {id:'val_cash',w:6,min:1,max:3},{id:'med_bandage',w:5},{id:'food_ration',w:5,min:1,max:2},{id:'mat_scrap',w:5,min:2,max:5},
    {id:'key_office',w:2},{id:'att_grip',w:3},{id:'mat_elec',w:3,min:1,max:2},{id:'stim',w:1},
  ],
  cont_weapon:[
    {id:'ammo_556',w:6,min:20,max:50},{id:'ammo_9mm',w:6,min:20,max:50},{id:'ammo_762',w:4,min:10,max:30},
    {id:'att_reddot',w:4},{id:'att_grip',w:4},{id:'att_suppressor',w:2},{id:'wpn_smg',w:2},{id:'wpn_carbine',w:2},{id:'att_scope',w:1},{id:'nade_frag',w:2},
  ],
  cont_med:[
    {id:'med_bandage',w:6,min:1,max:3},{id:'med_kit',w:5},{id:'food_ration',w:4,min:1,max:2},{id:'stim',w:3},{id:'mat_elec',w:2},
  ],
  cont_safe:[
    {id:'val_cash',w:6,min:2,max:5},{id:'val_gold',w:4},{id:'key_office',w:3},{id:'att_scope',w:2},{id:'arm_lvl4',w:1},{id:'wpn_dmr',w:1},{id:'drone_kit',w:1},
  ],
};

// ----- container archetypes: searchable world loot (lockers/crates/safes). -----
DATA.containers = {
  locker:{name:'Locker', table:'cont_locker', grid:[4,4], color:0x4a4438, search:1.2},
  weapon:{name:'Weapon Crate', table:'cont_weapon', grid:[6,4], color:0x3a4a3a, search:1.6},
  med:{name:'Medical Crate', table:'cont_med', grid:[4,3], color:0x5a3a3a, search:1.0},
  safe:{name:'Safe', table:'cont_safe', grid:[4,4], color:0x2a2a30, search:2.2},
};

// ----- recipes: in[] consumed from stash, out produced into stash. station tag. -----
DATA.recipes = [
  {id:'r_556', name:'Print 5.56 (x30)', station:'printer', out:{id:'ammo_556',qty:30}, in:[{id:'mat_filament',qty:2},{id:'mat_scrap',qty:1}]},
  {id:'r_9mm', name:'Print 9mm (x30)',  station:'printer', out:{id:'ammo_9mm',qty:30}, in:[{id:'mat_filament',qty:2}]},
  {id:'r_762', name:'Print 7.62 (x20)', station:'printer', out:{id:'ammo_762',qty:20}, in:[{id:'mat_filament',qty:3},{id:'mat_scrap',qty:1}]},
  {id:'r_med', name:'Craft Med Kit',    station:'printer', out:{id:'med_kit',qty:1},  in:[{id:'med_bandage',qty:3},{id:'mat_elec',qty:1}]},
  {id:'r_reddot', name:'Print Red Dot', station:'printer', out:{id:'att_reddot',qty:1}, in:[{id:'mat_filament',qty:4},{id:'mat_elec',qty:2}]},
  {id:'r_bag', name:'Craft 8x8 Pack',   station:'printer', out:{id:'bag_large',qty:1}, in:[{id:'mat_scrap',qty:12},{id:'mat_elec',qty:4}]},
  {id:'r_drone', name:'Build Recon Drone', station:'printer', out:{id:'drone_kit',qty:1}, in:[{id:'mat_elec',qty:6},{id:'mat_scrap',qty:8},{id:'mat_filament',qty:4}]},
];

// ----- skills: id -> {name, desc, max, per-rank effect handled in Progression}. -----
DATA.skills = {
  vitality:{name:'Vitality', desc:'+15 Max Health per rank', max:5},
  athletics:{name:'Athletics', desc:'+10% Stamina & move per rank', max:5},
  marksman:{name:'Marksman', desc:'+6% Weapon damage per rank', max:5},
  engineer:{name:'Engineer', desc:'+15% Reload speed per rank', max:5},
};

// ----- vendor stock (buyable). price = value * markup. -----
DATA.vendor = ['ammo_556','ammo_9mm','ammo_762','med_bandage','med_kit','wpn_carbine','wpn_pistol',
  'rig_basic','bag_small','arm_lvl2','helm_lvl2','att_reddot','att_grip','nade_frag','mat_filament','drone_kit'];

// ----- noise: action -> hearing radius (Perception/stealth). Tune stealth here. -----
DATA.noise = { shot:46, shotSuppressed:14, boom:60, sprint:18, step:7, crouchStep:3 };

// ----- allies: deployable companions (combat drone). -----
DATA.allies = { drone:{name:'Recon Drone', hp:40, damage:10, fireDelay:0.7, range:55, life:45} };

// ----- objectives: per-raid optional tasks -> bonus bag value on completion. -----
DATA.objectives = [
  {id:'hunt',  kind:'kill',     make:i=>({label:`Eliminate ${4+i*2} hostiles`, need:4+i*2,  reward:300+i*150})},
  {id:'cache', kind:'rare',     make:i=>({label:'Crack a rare cache',          need:1,       reward:400+i*120})},
  {id:'scav',  kind:'material', make:i=>({label:'Gather 6 materials',           need:6,       reward:260+i*100})},
];

// ----- item icons (emoji stand-ins until real art; "visual icons not text"). -----
DATA.iconType = { ammo:'🔸', weapon:'🔫', attachment:'🔭', armor:'🛡️', helmet:'⛑️', backpack:'🎒', rig:'🦺', med:'🩹', food:'🥫', throwable:'💣', material:'🔩', valuable:'💰', key:'🗝️', deployable:'🤖' };
DATA.iconId = { ammo_556:'🟡', ammo_9mm:'⚪', ammo_762:'🟠', att_reddot:'🔴', att_scope:'🔭', att_suppressor:'🧪', att_grip:'🪝',
  med_kit:'🧰', med_bandage:'🩹', stim:'💉', mat_scrap:'🔩', mat_elec:'💾', mat_filament:'🧵', val_cash:'💵', val_gold:'🥇',
  key_office:'🗝️', drone_kit:'🤖', nade_frag:'💣', food_ration:'🥫', wpn_dmr:'🎯', wpn_pistol:'🔫', wpn_smg:'🔫', wpn_carbine:'🔫' };

// ----- default keybinds (rebindable in Settings; persisted in profile.settings). -----
DATA.binds = { forward:'KeyW', back:'KeyS', left:'KeyA', right:'KeyD', jump:'Space', crouch:'KeyC', sprint:'ShiftLeft',
  reload:'KeyR', interact:'KeyE', pickup:'KeyF', inventory:'Tab', weapon1:'Digit1', weapon2:'Digit2',
  grenade:'KeyG', heal:'KeyH', drone:'KeyT', firemode:'KeyB', melee:'KeyV' };
DATA.bindLabels = { forward:'Move Forward', back:'Move Back', left:'Strafe Left', right:'Strafe Right', jump:'Jump',
  crouch:'Crouch', sprint:'Sprint', reload:'Reload', interact:'Interact / Loot', pickup:'Pick Up Item',
  inventory:'Inventory', weapon1:'Primary', weapon2:'Secondary', grenade:'Grenade', heal:'Use Med', drone:'Deploy Drone', firemode:'Fire Mode', melee:'Melee Strike' };

// ----- raid stops: difficulty curve by stopIndex. -----
DATA.stops = {
  count(i){ return 5 + i*2; },
  roles(i){
    const pool=['guard','patroller','lookout'];
    if(i>=1) pool.push('rusher','heavy');
    if(i>=2) pool.push('sniper');
    return pool;
  },
  rareCrates(i){ return 1 + Math.floor(i/1.5); },
  rewardMult(i){ return 1 + i*0.35; },
};

/* ════════════════════════════════════════════════════════════════════════════
   SECTION: THROWABLES + CONSUMABLES  (added by feat/lns-throwables-healing)
   Self-contained content block — appended via Object.assign so it never collides
   with the literals above (parallel agents auto-merge). Owns: extra throwable
   item defs, the throwable tuning table (Projectiles reads it), the simplified
   healing/consumable tuning table (Player/Status read it), plus their icons +
   vendor stock. NO behavior here — pure data.
   ════════════════════════════════════════════════════════════════════════════ */

// --- new throwable items (frag already lives in DATA.items above). `dmg`/`radius`
//     are kept on every entry so the inventory tooltip (ui.js statLines) reads
//     cleanly for non-damaging types too. `throw` keys into DATA.throwables. ---
Object.assign(DATA.items, {
  nade_smoke:{name:'Smoke Grenade', type:'throwable', throw:'smoke', dmg:0,  radius:7, size:[1,1], stack:3, value:90,  rarity:1},
  nade_flash:{name:'Flashbang',     type:'throwable', throw:'flash', dmg:0,  radius:8, size:[1,1], stack:3, value:120, rarity:2},
  nade_inc:{name:'Incendiary',      type:'throwable', throw:'incendiary', dmg:18, radius:5, size:[1,1], stack:2, value:180, rarity:3},
  // new consumables (med_bandage / med_kit / stim already exist above)
  med_stimpak:{name:'Adrenal Stim', type:'med', use:'stimpak', heal:10, buff:'speed', size:[1,1], value:260, rarity:3},
  med_focus:{name:'Focus Shot',     type:'med', use:'focus',   heal:0,  buff:'stamina', size:[1,1], value:240, rarity:3},
});

// --- throwable behaviour tuning. `kind` selects the effect Projectiles runs on
//     detonation. fuse=seconds airborne before auto-pop; thrown items also pop on
//     ground contact (except where noted). All radii/durations are gameplay knobs.
DATA.throwables = {
  // classic frag mirrors the existing nade_frag stats (kept so the new
  // multi-throwable selector can also throw frag); damage falls off to the edge.
  frag:{ item:'nade_frag', kind:'frag', label:'FRAG', color:0x2f3a22, fuse:2.4,
         dmg:130, radius:6, noise:'boom' },
  // smoke: no damage. Spawns a lingering vision-screen cloud; standing inside it
  // applies the player `smoked` overlay; enemies see worse (handled via noise=0).
  smoke:{ item:'nade_smoke', kind:'smoke', label:'SMOKE', color:0x9aa0a6, fuse:1.6,
          dmg:0, radius:7, duration:11, noise:null },
  // flash/stun: brief player blind if facing/near + suppresses enemy fire (stun)
  // for everyone inside the radius. Pops on a short fuse (cooked airburst feel).
  flash:{ item:'nade_flash', kind:'flash', label:'FLASH', color:0xfff4cc, fuse:1.5,
          dmg:0, radius:8, blind:2.4, stun:3.2, noise:'boom' },
  // incendiary: small burst + a burning ground zone that ticks DoT on anything
  // inside it (enemies via Enemies.damage, player via Status burn) for `duration`.
  incendiary:{ item:'nade_inc', kind:'incendiary', label:'INCEND', color:0xff5a1f, fuse:1.8,
          dmg:24, radius:5, duration:6, tick:9, noise:'boom' },
};
// preferred cycle order for the throwable selector (only carried types show)
DATA.throwOrder = ['frag','smoke','flash','incendiary'];

// --- simplified healing + buff consumables (NO hunger/thirst/weight — extraction
//     shooter, not a survival sim). `useTime` = seconds of the cosmetic use-anim
//     before the effect lands. `heal` = instant restore on finish (medkit/bandage);
//     `regen` = heal-over-time amount/sec for `regenDur` sec; buffs are timed
//     Status effects. Player.useMed / Status read this. ---
DATA.consumables = {
  med_bandage:{ name:'Bandage',  useTime:2.0, heal:25, cure:'bleed' },
  med_kit:    { name:'Med Kit',  useTime:4.0, heal:40, regen:8, regenDur:5, cure:'bleed' },
  stim:       { name:'Combat Stim', useTime:1.2, heal:15, buff:'speed',   buffDur:12, buffMag:1 },
  med_stimpak:{ name:'Adrenal Stim', useTime:1.0, heal:10, buff:'speed',  buffDur:9,  buffMag:1.4 },
  med_focus:  { name:'Focus Shot',   useTime:1.4, heal:0,  buff:'stamina', buffDur:14, buffMag:1 },
};

// --- icons + vendor stock for the new content (Object.assign keeps the source
//     literals above untouched -> clean parallel merges). ---
Object.assign(DATA.iconId, {
  nade_smoke:'🌫️', nade_flash:'✨', nade_inc:'🔥', med_stimpak:'💉', med_focus:'🎯',
});
DATA.vendor.push('nade_smoke','nade_flash','nade_inc','stim','med_stimpak','med_focus');

// --- make the new content obtainable in raids (push -> merge-safe vs. the loot
//     literals above). The new throwables/consumables drop alongside the frag. ---
DATA.loot.enemy_drop.push({id:'nade_smoke',w:2},{id:'nade_flash',w:1});
DATA.loot.cont_weapon.push({id:'nade_smoke',w:2},{id:'nade_flash',w:2},{id:'nade_inc',w:1});
DATA.loot.cont_med.push({id:'med_stimpak',w:2},{id:'med_focus',w:2});
DATA.loot.crate_rare.push({id:'nade_inc',w:1},{id:'med_stimpak',w:1});

// --- extra keybinds for the selectable-throwable system (Projectiles owns the
//     listeners; G / mobile NADE stay the legacy frag throw via Weapons). ---
Object.assign(DATA.binds, { throwCycle:'KeyV', throwUse:'KeyQ' });
Object.assign(DATA.bindLabels, { throwCycle:'Cycle Throwable', throwUse:'Throw Selected' });

// each NEW def carries its own id (the loop above the original block only ran over
// the original items; re-stamp so serialize/icons/stacking work for these too).
for(const k in DATA.items) if(!DATA.items[k].id) DATA.items[k].id=k;
// =====================================================================
// ===== GEAR — armor + clothing system (feat/lns-armor-clothing) ======
// =====================================================================
// Wearable defence + utility. Three body slots: helmet, armor (plate/body),
// clothing (jackets/fatigues — the soft layer under armor). Stats:
//   ac    : armor class (tier 1..5) — coarse rating shown in the doll.
//   dr    : flat damage-reduction fraction this piece contributes (0..1).
//           Player sums dr across equipped gear (capped) — flat, no per-bone
//           model. Simpler than the UE sim, on purpose.
//   dura  : durability-lite. Current hit-points of protection. Each absorbed
//           hit chips a little; as dura→0 the piece's dr fades to ~half. Cheap
//           wear, no repair economy. Omit on a piece to make it indestructible.
//   ergo  : ergonomics / movement modifier as a fraction of move speed
//           (negative = heavier/slower, positive = lighter/faster). Summed by
//           player.js into the speed calc. Keeps clothing meaningful even
//           though it adds little armor.
//   slot  : helmet | armor | clothing (the equip slot it occupies).
// Placeholder art = emoji icons; real meshes can drop in later.
DATA.gear = {
  // --- helmets (head slot) ---
  helm_cap:   {name:'Ball Cap',      type:'helmet',   slot:'helmet',   ac:0, dr:0.02, ergo:0.02,  size:[1,1], value:60,   rarity:1},
  helm_lvl3:  {name:'Combat Helm III', type:'helmet', slot:'helmet',   ac:3, dr:0.16, dura:55, maxDura:55, ergo:-0.03, size:[2,2], value:900, rarity:3},
  helm_hvy:   {name:'Heavy Helm IV', type:'helmet',   slot:'helmet',   ac:4, dr:0.24, dura:90, maxDura:90, ergo:-0.06, size:[2,2], value:1700, rarity:4},

  // --- body armor / plate carriers (armor slot) ---
  arm_soft:   {name:'Soft Armor I',  type:'armor',    slot:'armor',    ac:1, dr:0.10, dura:45,  maxDura:45,  ergo:-0.02, size:[2,3], value:300,  rarity:1},
  arm_plate3: {name:'Plate Carrier III', type:'armor', slot:'armor',   ac:3, dr:0.30, dura:120, maxDura:120, ergo:-0.06, size:[2,3], value:1200, rarity:3},
  arm_plate5: {name:'Assault Plate V', type:'armor',  slot:'armor',    ac:5, dr:0.45, dura:200, maxDura:200, ergo:-0.12, size:[2,4], value:2600, rarity:5},

  // --- clothing (soft layer; light defence + ergonomics) ---
  clo_tshirt: {name:'T-Shirt',       type:'clothing', slot:'clothing', ac:0, dr:0.0,  ergo:0.04,  size:[2,2], value:20,   rarity:1},
  clo_fatigues:{name:'Field Fatigues', type:'clothing', slot:'clothing', ac:0, dr:0.03, ergo:0.0,  size:[2,2], value:140,  rarity:2},
  clo_jacket: {name:'Tac Jacket',    type:'clothing', slot:'clothing', ac:1, dr:0.06, dura:30, maxDura:30, ergo:-0.02, size:[2,3], value:360,  rarity:3},
  clo_ghillie:{name:'Ghillie Suit',  type:'clothing', slot:'clothing', ac:0, dr:0.02, ergo:-0.05, stealth:0.25, size:[2,3], value:700, rarity:4},
};
for(const k in DATA.gear){ DATA.gear[k].id=k; DATA.items[k]=DATA.gear[k]; } // merge into the item registry

// gear icons (per-type fallback for the new 'clothing' type + per-id stand-ins)
DATA.iconType.clothing = '👕';
Object.assign(DATA.iconId, {
  helm_cap:'🧢', helm_lvl3:'⛑️', helm_hvy:'🪖',
  arm_soft:'🦺', arm_plate3:'🛡️', arm_plate5:'🛡️',
  clo_tshirt:'👕', clo_fatigues:'🥋', clo_jacket:'🧥', clo_ghillie:'🍃',
});

// gear mitigation tuning — read by player.js. Kept here so balance lives in data.
DATA.gearMit = {
  drCap: 0.80,        // hard cap on total flat damage reduction from all gear
  helmetWeight: 1.0,  // helmet dr counts fully now (was 0.4x of armor in the old model)
  duraLossPerDmg: 0.5,// durability points lost per point of damage a piece absorbs
  wornDrFactor: 0.5,  // dr multiplier when a piece is fully worn (dura=0): 1→wornDrFactor
};

// stock the vendor with entry-level gear so the system is reachable without loot
if(Array.isArray(DATA.vendor)) DATA.vendor.push('clo_fatigues','clo_jacket','helm_lvl3','arm_soft','arm_plate3');

// seed gear into world loot tables so armor/clothing drops in raids too
if(DATA.loot){
  if(DATA.loot.crate_common) DATA.loot.crate_common.push({id:'clo_tshirt',w:2},{id:'clo_fatigues',w:2});
  if(DATA.loot.crate_rare)   DATA.loot.crate_rare.push({id:'helm_lvl3',w:2},{id:'arm_plate3',w:2},{id:'clo_jacket',w:2},{id:'arm_plate5',w:1},{id:'helm_hvy',w:1},{id:'clo_ghillie',w:1});
  if(DATA.loot.cont_locker)  DATA.loot.cont_locker.push({id:'clo_fatigues',w:2},{id:'clo_jacket',w:1});
}
// =====================================================================
// ===========================================================================
// GUNSMITH DEPTH — full attachment slot set + melee  (NEW SECTION)
// ---------------------------------------------------------------------------
// Self-contained block: extra attachment ITEM defs + their stat-effect defs +
// the melee config. Kept in its own labeled section so parallel edits to the
// tables above auto-merge. The four originals (red dot / scope / suppressor /
// grip) stay in DATA.items / DATA.attachments above; everything here is new.
//
// Slot taxonomy (a weapon's `slots` array gates which a gun accepts):
//   optic     scope / red-dot / holo — zoom + ADS speed + precision
//   muzzle    suppressor / comp / brake — recoil + sound + spread
//   foregrip  vert / angled grip — recoil + handling
//   stock     buttstock — recoil + ADS speed + mobility
//   laser     hipfire accuracy (+ a visible dot in-world)
//   magazine  capacity + reload
//   barrel    range + velocity (+ a touch of recoil/handling tradeoff)
//
// Effective-stat scalars introduced here (1.0 = baseline, defaulted in
// Weapons.stats): handling (viewmodel/ADS feel), mobility (move while aimed),
// hipAccuracy (hipfire spread tightening). `add` = additive, `mods` = mult.
// ===========================================================================

// ---- new attachment ITEM defs (footprint / value / rarity / slot) ----
DATA.gunsmithItems = {
  // OPTIC
  att_holo:{name:'Holo Sight', type:'attachment', slot:'optic', size:[2,1], value:480, rarity:2},
  // MUZZLE
  att_comp:{name:'Compensator', type:'attachment', slot:'muzzle', size:[1,1], value:260, rarity:2},
  att_brake:{name:'Muzzle Brake', type:'attachment', slot:'muzzle', size:[1,1], value:300, rarity:2},
  // FOREGRIP
  att_anglegrip:{name:'Angled Grip', type:'attachment', slot:'foregrip', size:[1,1], value:180, rarity:2},
  // STOCK / BUTTSTOCK
  att_stock_tac:{name:'Tactical Stock', type:'attachment', slot:'stock', size:[2,1], value:340, rarity:2},
  att_stock_light:{name:'Skeleton Stock', type:'attachment', slot:'stock', size:[2,1], value:380, rarity:3},
  // LASER
  att_laser:{name:'Laser Sight', type:'attachment', slot:'laser', size:[1,1], value:280, rarity:2},
  // MAGAZINE
  att_mag_ext:{name:'Extended Mag', type:'attachment', slot:'magazine', size:[1,2], value:320, rarity:2},
  att_mag_quick:{name:'Quickdraw Mag', type:'attachment', slot:'magazine', size:[1,2], value:300, rarity:2},
  // BARREL
  att_barrel_long:{name:'Long Barrel', type:'attachment', slot:'barrel', size:[2,1], value:420, rarity:3},
  att_barrel_short:{name:'Short Barrel', type:'attachment', slot:'barrel', size:[1,1], value:240, rarity:2},
};
for(const k in DATA.gunsmithItems){ DATA.gunsmithItems[k].id=k; DATA.items[k]=DATA.gunsmithItems[k]; }

// ---- new attachment EFFECT defs (mods=multiplicative, add=additive) ----
DATA.gunsmithAttachments = {
  // OPTIC — holo: fast, mild zoom, tightens ADS spread
  att_holo:{slot:'optic', mods:{adsSpread:0.6, adsTime:1.0}, zoom:1.4},
  // MUZZLE — comp kills vertical recoil; brake trades sound for spread control
  att_comp:{slot:'muzzle', mods:{recoil:0.62, spread:0.92}},
  att_brake:{slot:'muzzle', mods:{recoil:0.55, adsSpread:1.06}},
  // FOREGRIP — angled: faster handling/ADS, less recoil control than vert
  att_anglegrip:{slot:'foregrip', mods:{recoil:0.9, adsTime:0.9}, add:{handling:0.15}},
  // STOCK — tac: recoil + ADS, slight mobility cost; light: mobility + ADS, less recoil help
  att_stock_tac:{slot:'stock', mods:{recoil:0.82, adsTime:0.85}, add:{mobility:-0.05, handling:0.08}},
  att_stock_light:{slot:'stock', mods:{recoil:0.94, adsTime:0.9}, add:{mobility:0.12, handling:0.12}},
  // LASER — big hipfire-accuracy boost (+ visible dot), tiny ADS-time cost
  att_laser:{slot:'laser', mods:{spread:0.8}, add:{hipAccuracy:0.45}, laser:true},
  // MAGAZINE — ext: +capacity, slower reload; quick: faster reload, no capacity
  att_mag_ext:{slot:'magazine', add:{mag:15}, mods:{reload:1.18}},
  att_mag_quick:{slot:'magazine', mods:{reload:0.78}},
  // BARREL — long: +range/velocity, slower ADS; short: faster handling, less range
  att_barrel_long:{slot:'barrel', mods:{range:1.25, velocity:1.2, eff:1.2, adsTime:1.12}, add:{handling:-0.06}},
  att_barrel_short:{slot:'barrel', mods:{range:0.85, velocity:0.85, eff:0.85, adsTime:0.92}, add:{handling:0.1, mobility:0.05}},
};
for(const k in DATA.gunsmithAttachments){ DATA.gunsmithAttachments[k].id=k; DATA.attachments[k]=DATA.gunsmithAttachments[k]; }

// ---- MELEE: quick strike usable with ANY weapon equipped (bind 'melee', def V) ----
// Short-range punch/bash. Costs stamina, has a cooldown, headshot multiplier.
// Consumed by Weapons.melee(); no logic here, just the numbers to tune.
DATA.melee = {
  damage:55,        // base hit damage
  headMult:2.0,     // headshot multiplier
  range:2.6,        // reach in metres (raycast far)
  cooldown:0.65,    // seconds between strikes
  stamina:18,       // stamina drained per swing
  minStamina:8,     // need at least this much stamina to swing
  noise:'sprint',   // Perception/DATA.noise key for the swing whoosh
};

// register the new attachment items into the gunsmith-relevant loot/vendor pools
// (appended, not rewritten, so the tables above merge cleanly)
DATA.loot.crate_rare.push({id:'att_holo',w:3},{id:'att_comp',w:3},{id:'att_laser',w:2},{id:'att_mag_ext',w:2},{id:'att_stock_tac',w:2},{id:'att_barrel_long',w:1});
DATA.loot.cont_weapon.push({id:'att_anglegrip',w:4},{id:'att_comp',w:3},{id:'att_laser',w:3},{id:'att_mag_ext',w:3},{id:'att_stock_light',w:2},{id:'att_barrel_short',w:2});
DATA.vendor.push('att_holo','att_comp','att_anglegrip','att_stock_tac','att_laser','att_mag_ext','att_barrel_short');

// icons for the new parts (emoji stand-ins, matches DATA.iconId style)
Object.assign(DATA.iconId, {
  att_holo:'🟢', att_comp:'🧱', att_brake:'🔥', att_anglegrip:'📐', att_stock_tac:'🪵',
  att_stock_light:'🦴', att_laser:'🔆', att_mag_ext:'🔋', att_mag_quick:'⚡', att_barrel_long:'📏', att_barrel_short:'➖',
});

/* ════════════════════════════════════════════════════════════════════════════
   SECTION: AMMO TYPES + MAGAZINE FEED  (added by feat/lns-ammo-mags)
   Self-contained content block — appended via Object.assign / push so it never
   collides with the literals above (parallel agents auto-merge). Owns: the ammo
   TYPE table (FMJ / AP / HP / Tracer per caliber) with stat effects, the matching
   per-type ammo ITEM defs (so each variant is its own lootable/buyable stack),
   plus their icons + vendor stock + loot seeding. NO behavior here — pure data.
   weapons.js reads DATA.ammoTypes to modify the shot and to feed/switch the mag.

   --- ammo TYPE stat-effect model (all multipliers are 1.0 = baseline) ---
     dmg     : MULTIPLIER on the weapon's per-shot damage.
     pen     : penetration 0..1 — fraction of a target's flat armor damage-
               reduction (dr) this round IGNORES. 0 = armor fully applies (the
               old behavior); 1 = armor does nothing. Ties straight into the
               gear `dr` mitigation already in inventory.js/player.js — weapons.js
               folds it into the enemy-hit math as effectiveDr = dr*(1-pen).
     range   : MULTIPLIER on effective + max range (muzzle velocity flavor).
     recoil  : MULTIPLIER on recoil (hotter rounds kick more).
     tracer  : bool — draws a bright tracer line (cosmetic; weapons.js tints it).
     color   : tracer / round tint (also reused for the inventory swatch vibe).
     label   : short tag for HUD / tooltips (FMJ, AP, HP, TR).
   Each entry also carries `cal` so weapons.js can match it to the gun, and `item`
   = the inventory item id that this type is drawn from on reload.
   ════════════════════════════════════════════════════════════════════════════ */

// Per-type ammo ITEM defs — one stack per (caliber × type). The plain rounds that
// already exist (ammo_556 / ammo_9mm / ammo_762) stay as the FMJ baseline and are
// mapped in DATA.ammoTypes below, so legacy loot/recipes/vendor keep working.
Object.assign(DATA.items, {
  // 5.56 family
  ammo_556_ap:{name:'5.56 AP',     type:'ammo', cal:'556', ammoType:'556_ap', size:[1,1], stack:60, value:4, rarity:2},
  ammo_556_hp:{name:'5.56 HP',     type:'ammo', cal:'556', ammoType:'556_hp', size:[1,1], stack:60, value:3, rarity:2},
  ammo_556_tr:{name:'5.56 Tracer', type:'ammo', cal:'556', ammoType:'556_tr', size:[1,1], stack:60, value:3, rarity:2},
  // 9mm family
  ammo_9mm_ap:{name:'9mm AP',      type:'ammo', cal:'9mm', ammoType:'9mm_ap', size:[1,1], stack:60, value:3, rarity:2},
  ammo_9mm_hp:{name:'9mm HP',      type:'ammo', cal:'9mm', ammoType:'9mm_hp', size:[1,1], stack:60, value:2, rarity:2},
  // 7.62 family
  ammo_762_ap:{name:'7.62 AP',     type:'ammo', cal:'762', ammoType:'762_ap', size:[1,1], stack:40, value:7, rarity:3},
  ammo_762_hp:{name:'7.62 HP',     type:'ammo', cal:'762', ammoType:'762_hp', size:[1,1], stack:40, value:6, rarity:3},
});

// The ammo TYPE table. id -> stat effects. `item` ties a type to its stack; the
// baseline FMJ types point back at the original plain ammo items.
DATA.ammoTypes = {
  // ---- 5.56 ----
  '556_fmj':{ cal:'556', item:'ammo_556',    label:'FMJ', dmg:1.00, pen:0.30, range:1.00, recoil:1.00, tracer:false, color:0xffd27a },
  '556_ap': { cal:'556', item:'ammo_556_ap', label:'AP',  dmg:0.92, pen:0.85, range:1.10, recoil:1.08, tracer:false, color:0xbfe0ff },
  '556_hp': { cal:'556', item:'ammo_556_hp', label:'HP',  dmg:1.35, pen:0.05, range:0.85, recoil:0.95, tracer:false, color:0xff8a6a },
  '556_tr': { cal:'556', item:'ammo_556_tr', label:'TR',  dmg:0.98, pen:0.30, range:1.05, recoil:1.00, tracer:true,  color:0x7afcff },
  // ---- 9mm ----
  '9mm_fmj':{ cal:'9mm', item:'ammo_9mm',    label:'FMJ', dmg:1.00, pen:0.20, range:1.00, recoil:1.00, tracer:false, color:0xffd27a },
  '9mm_ap': { cal:'9mm', item:'ammo_9mm_ap', label:'AP',  dmg:0.90, pen:0.75, range:1.08, recoil:1.06, tracer:false, color:0xbfe0ff },
  '9mm_hp': { cal:'9mm', item:'ammo_9mm_hp', label:'HP',  dmg:1.40, pen:0.04, range:0.80, recoil:0.94, tracer:false, color:0xff8a6a },
  // ---- 7.62 ----
  '762_fmj':{ cal:'762', item:'ammo_762',    label:'FMJ', dmg:1.00, pen:0.40, range:1.00, recoil:1.00, tracer:false, color:0xffd27a },
  '762_ap': { cal:'762', item:'ammo_762_ap', label:'AP',  dmg:0.95, pen:0.92, range:1.12, recoil:1.10, tracer:false, color:0xbfe0ff },
  '762_hp': { cal:'762', item:'ammo_762_hp', label:'HP',  dmg:1.32, pen:0.08, range:0.85, recoil:0.96, tracer:false, color:0xff8a6a },
};
for(const k in DATA.ammoTypes) DATA.ammoTypes[k].id=k;

// default loaded type per caliber (the FMJ baseline) — weapons.js falls back here
DATA.ammoDefault = { '556':'556_fmj', '9mm':'9mm_fmj', '762':'762_fmj' };
// stamp ammoType onto the original plain rounds so they read as FMJ everywhere
for(const k in DATA.ammoDefault){ const t=DATA.ammoTypes[DATA.ammoDefault[k]]; const it=DATA.items[t.item]; if(it&&!it.ammoType) it.ammoType=t.id; }

// new ammo items carry their own id (the early items-stamp loop already ran)
for(const k in DATA.items) if(!DATA.items[k].id) DATA.items[k].id=k;

// icons for the new ammo variants (emoji stand-ins, matches DATA.iconId style)
Object.assign(DATA.iconId, {
  ammo_556_ap:'🔵', ammo_556_hp:'🟥', ammo_556_tr:'💠',
  ammo_9mm_ap:'🔹', ammo_9mm_hp:'🟧',
  ammo_762_ap:'🔷', ammo_762_hp:'🟫',
});

// vendor stock for the specialty rounds (appended, never rewritten)
DATA.vendor.push('ammo_556_ap','ammo_556_hp','ammo_556_tr','ammo_9mm_ap','ammo_9mm_hp','ammo_762_ap','ammo_762_hp');

// seed specialty ammo into the raid loot pools (push -> merge-safe vs the tables above)
DATA.loot.enemy_drop.push({id:'ammo_556_ap',w:2,min:6,max:16},{id:'ammo_9mm_hp',w:2,min:6,max:16});
DATA.loot.cont_weapon.push(
  {id:'ammo_556_ap',w:3,min:15,max:40},{id:'ammo_556_hp',w:3,min:15,max:40},{id:'ammo_556_tr',w:2,min:15,max:40},
  {id:'ammo_9mm_ap',w:3,min:15,max:40},{id:'ammo_9mm_hp',w:3,min:15,max:40},
  {id:'ammo_762_ap',w:2,min:10,max:24},{id:'ammo_762_hp',w:2,min:10,max:24});
DATA.loot.crate_rare.push({id:'ammo_762_ap',w:2,min:10,max:24},{id:'ammo_556_ap',w:2,min:15,max:40});

// printable specialty ammo (additive recipes; the FMJ printers stay above)
if(Array.isArray(DATA.recipes)) DATA.recipes.push(
  {id:'r_556_ap', name:'Print 5.56 AP (x30)', station:'printer', out:{id:'ammo_556_ap',qty:30}, in:[{id:'mat_filament',qty:2},{id:'mat_scrap',qty:2},{id:'mat_elec',qty:1}]},
  {id:'r_762_ap', name:'Print 7.62 AP (x20)', station:'printer', out:{id:'ammo_762_ap',qty:20}, in:[{id:'mat_filament',qty:3},{id:'mat_scrap',qty:2},{id:'mat_elec',qty:1}]},
  {id:'r_9mm_hp', name:'Print 9mm HP (x30)',  station:'printer', out:{id:'ammo_9mm_hp',qty:30}, in:[{id:'mat_filament',qty:2},{id:'mat_scrap',qty:1}]});

/* ════════════════════════════════════════════════════════════════════════════
   SECTION: RAID OBJECTIVES + WORLD VARIETY  (added by feat/lns-objectives-world)
   Self-contained content block — appended via assignment so it never collides
   with the literals above (parallel agents auto-merge). Owns: the PRIMARY raid-
   objective table (clear / rescue / defuse — one is selected per stop and GATES
   extraction), the soft-timer pressure knobs, and the procedural LAYOUT table
   (scatter / lot / streets — picks how a stop's geometry is arranged). NO
   behavior here — objectives.js + world.js read these. Kept deliberately simpler
   than a full mission scripting system: a couple of flavors, generated per stop.
   ════════════════════════════════════════════════════════════════════════════ */

// --- PRIMARY raid objectives. EXACTLY ONE is chosen per stop (objectives.js) and
//     it GATES extraction (you can't bank the run until `done`). `make(i)` builds
//     the per-stop instance (label scales with stopIndex i). `kind` selects how
//     objectives.js drives completion + what world.js must spawn:
//       clear  : kill every hostile (the classic loop — no extra props spawned).
//       rescue : a hostage NPC spawns; REACH it (interact to free), then ESCORT/
//                EXTRACT — it follows you and must be alive at the extract pad.
//       defuse : a planted device spawns; interact-HOLD for `hold` seconds to
//                disarm it. (Holds across re-approaches; resets if you walk off.)
//     `gate:true` marks it extraction-gating (all primaries are). ---
DATA.raidObjectives = [
  { id:'clear',  kind:'clear',  weight:i=>2,             gate:true,
    make:i=>({ label:'Eliminate all hostiles', reward:200+i*120, hold:0 }) },
  { id:'rescue', kind:'rescue', weight:i=>1.4,           gate:true,
    make:i=>({ label:'Rescue the hostage & extract them', reward:450+i*180, hold:1.4 }) },
  { id:'defuse', kind:'defuse', weight:i=>1.4,           gate:true,
    make:i=>({ label:'Defuse the planted device', reward:420+i*170, hold:4.0 + Math.min(2.5, i*0.6) }) },
];

// --- soft TIMER pressure. A countdown that does NOT hard-fail the raid (this is
//     an extraction shooter, not a bomb-defusal puzzle) — instead, when it runs
//     out the area goes "HOT": a small bonus penalty + a HUD warning + reinforce
//     flavor. Generous so casual runs are fine; tight enough to push pace. The
//     bomb/rescue urgency reads off this. seconds scale up with stop size. ---
DATA.raidTimer = {
  base: 210,        // seconds on stop 0
  perStop: 35,      // +seconds per deeper stop (bigger map → more time)
  warnAt: 45,       // HUD turns urgent under this many seconds left
  hotPenalty: 0.85, // bag-value multiplier applied once it goes HOT (15% shaved)
};

// --- procedural LAYOUT archetypes. world.js picks one per stop (weighted, seeded)
//     so stops don't all read as the same random scatter. Each is a coarse recipe
//     the generator interprets; tuning knobs only, the geometry lives in world.js.
//       scatter : the original — buildings/cover sprinkled across the arena.
//       lot     : a few discrete PLOTS, each = a building + fenced yard + gate.
//       streets : buildings lined up along a central road (two rows), block feel.
//     `weight(i)` lets the mix shift by depth if desired (kept flat for now). ---
DATA.raidLayouts = [
  { id:'scatter', weight:i=>1.0 },
  { id:'lot',     weight:i=>1.0 },
  { id:'streets', weight:i=>1.0 },
];
/* ============================================================================
   SECTION: ENEMY AI — GRENADES + SUPPRESSION  (added by feat/lns-ai-grenades)
   Self-contained tuning block — appended via Object.assign / push so it never
   collides with the literals above (parallel agents auto-merge). PURE DATA, no
   behavior. Owns: per-role grenade loadout (who carries frags + how many), the
   enemy throw decision/arc/telegraph knobs (projectiles.js + enemies.js read
   these), the suppression model (near-miss pin + accuracy bleed), and the
   post-kill regroup/search timing. Tuned to feel like Tarkov-Hunt extraction —
   readable telegraphs, deliberately simpler than the UE sim.
   ════════════════════════════════════════════════════════════════════════════ */

// --- per-ROLE grenade loadout. Merged onto DATA.enemies[role].nades. `count`=how
//     many frags the role spawns carrying; `chance`=odds this individual actually
//     rolled any this spawn (so not every guard chucks nades). Roles absent here
//     carry none. Heavies/rushers lean grenade-happy to flush campers; snipers
//     never bother. Keeps the role taxonomy above intact (additive). ---
DATA.enemyNades = {
  guard:    { count:1, chance:0.45 },
  patroller:{ count:1, chance:0.20 },
  lookout:  { count:1, chance:0.30 },
  rusher:   { count:2, chance:0.55 },
  heavy:    { count:2, chance:0.70 },
  // sniper: none (long-range role; would never close to throwing distance)
};
for(const r in DATA.enemyNades){ if(DATA.enemies[r]) DATA.enemies[r].nades=DATA.enemyNades[r]; }

// --- enemy GRENADE throw behaviour. All times in seconds, distances in metres.
//     enemies.js decides WHEN (los-denied / grouped-on-a-camper), projectiles.js
//     does the arc + telegraph + detonation (reuses the frag effect). ---
DATA.enemyGrenade = {
  // throwing envelope: too close = self-frag risk, too far = won't reach.
  minRange: 8,            // don't throw if the target is basically point-blank
  maxRange: 34,           // out of arm range past this
  // decision gates
  losDeniedFor: 1.4,      // sec the target must be UNSEEN-but-known before flushing with a frag
  groupedMin: 2,          // this many+ engaged enemies on one held/cover target -> someone may cook one
  cooldown: 9,            // per-enemy seconds between throws (squad feels deliberate, not spammy)
  squadCooldown: 4.5,     // squad-wide floor so 4 mobs don't all throw the same instant
  aimError: 2.2,          // metres of scatter added to the aimpoint (frags miss-by-a-bit, fair)
  leadFactor: 0.35,       // fraction of the player's velocity to lead the throw by
  // telegraph: a clear windup so the player can react (callout + cook delay + marker)
  cookTime: 1.15,         // sec from "decided to throw" to release (the windup/telegraph)
  arcSpeed: 17,           // horizontal toss speed fed to the ballistic solve
  markerColor: 0xff5a1f,  // landing-zone telegraph ring tint (matches frag pop hue)
};

// --- SUPPRESSION model. Incoming near-miss fire (player tracers that whip past
//     without hitting) + nearby blasts build a 0..1 suppression meter per enemy.
//     While suppressed an enemy shoots worse and is pinned (forced low in cover,
//     no peeking). Decays when fire lets up. enemies.js owns the meter. ---
DATA.suppression = {
  missRadius: 2.6,        // a player tracer passing within this of an enemy = a near-miss
  perMiss: 0.34,          // suppression added per near-miss round
  perBlast: 0.6,          // suppression added when a frag goes off near them
  decay: 0.55,            // suppression bled off per second once fire stops
  max: 1.0,               // ceiling
  pinAt: 0.5,             // at/above this the enemy is PINNED (hugs cover, can't peek)
  accuracyFloor: 0.35,    // accuracy is scaled down to at most this fraction at full suppression
  fireDelayMult: 1.8,     // fire cadence stretched by up to this at full suppression
};

// --- POST-KILL squad reaction: when a squadmate drops, survivors don't just stand
//     there — they regroup toward the kill and SEARCH the player's last-known spot
//     for a while before giving up. enemies.js reads these. ---
DATA.squadReact = {
  searchTime: 7.5,        // sec survivors hunt the last-known position after a teammate dies
  searchRadius: 9,        // they fan out within this of the last-known point
  regroupRadius: 26,      // a death rallies living mobs within this range
  alertOnKill: 30,        // radius of the alert pulse a teammate's death sends out
};
// =====================================================================
