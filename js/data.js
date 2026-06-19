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
DATA.weapons = {
  carbine:{name:'MK1 Carbine', cal:'556', damage:26, rpm:540, mag:30, reload:1.8, spread:0.013, adsSpread:0.003, adsTime:0.25, recoil:0.012, range:90, eff:58, zoom:1, modes:['auto','burst','semi'], slots:['optic','muzzle','tactical']},
  smg:{name:'Vector SMG', cal:'9mm', damage:18, rpm:780, mag:25, reload:1.5, spread:0.022, adsSpread:0.007, adsTime:0.18, recoil:0.009, range:50, eff:26, zoom:1, modes:['auto','semi'], slots:['optic','muzzle','tactical']},
  dmr:{name:'M14 DMR', cal:'762', damage:58, rpm:200, mag:20, reload:2.2, spread:0.006, adsSpread:0.001, adsTime:0.35, recoil:0.022, range:160, eff:135, zoom:1, modes:['semi'], slots:['optic','muzzle','tactical']},
  pistol:{name:'P9 Sidearm', cal:'9mm', damage:20, rpm:380, mag:15, reload:1.2, spread:0.022, adsSpread:0.008, adsTime:0.15, recoil:0.01, range:40, eff:20, zoom:1, modes:['semi'], slots:['optic','muzzle']},
};

// ----- attachments: slot + stat multipliers (and special: zoom add). -----
DATA.attachments = {
  att_reddot:{slot:'optic', mods:{adsSpread:0.7, adsTime:0.95}},
  att_scope:{slot:'optic', mods:{adsSpread:0.4, adsTime:1.2}, zoom:2.2},
  att_suppressor:{slot:'muzzle', mods:{recoil:0.7, damage:0.96}, quiet:true},
  att_grip:{slot:'tactical', mods:{recoil:0.8, spread:0.85}},
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
  grenade:'KeyG', heal:'KeyH', drone:'KeyT', firemode:'KeyB' };
DATA.bindLabels = { forward:'Move Forward', back:'Move Back', left:'Strafe Left', right:'Strafe Right', jump:'Jump',
  crouch:'Crouch', sprint:'Sprint', reload:'Reload', interact:'Interact / Loot', pickup:'Pick Up Item',
  inventory:'Inventory', weapon1:'Primary', weapon2:'Secondary', grenade:'Grenade', heal:'Use Med', drone:'Deploy Drone', firemode:'Fire Mode' };

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
