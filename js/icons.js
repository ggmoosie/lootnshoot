// icons.js — SYS: Icons. Procedural, recognizable item icons drawn to offscreen
// canvases (no art assets, no deps). Replaces the emoji stand-ins everywhere items
// show (inventory, stash, vendor, loot, hotbar, drag-ghost). Each icon is drawn
// once per item SIGNATURE (id+rarity+size) and cached as a data-URL, so repeated
// renders are a string lookup — cheap enough for full inventory re-renders.
//
// The drawing is deliberately simple vector-on-canvas: each item category gets a
// small recognizable glyph (a pistol silhouette, a stick mag, a med cross, a gold
// bar, …), set on a dark rounded tile with a rarity-tinted frame so loot reads at
// a glance like a real extraction-shooter inventory. Weapons are sub-typed by
// class (pistol/SMG/rifle/shotgun/sniper) and attachments by slot (optic/laser/
// grip/mag/stock/muzzle/barrel) so every category has its own shape.
import { DATA } from "./data.js";

// rarity index -> frame tint (matches util.rarityColor / the CSS r-1..r-5 ramp)
const RARITY = ['#9aa0a6','#9aa0a6','#57c06b','#6fa8dc','#c06fd8','#e8a33d'];
function rarHex(r){ return RARITY[r] || RARITY[1]; }

// ---- weapon class inference (pistol / smg / rifle / shotgun / sniper) ----
// Defs key into DATA.weapons via def.weapon; classify by an explicit class tag if
// a def ever adds one, else by the weapon-key name, else by stats (mag/rpm/range).
function weaponClass(def){
  const wkey = def.weapon || '';
  const w = DATA.weapons[wkey] || {};
  const cls = (w.class || def.class || wkey || '').toLowerCase();
  if(/pistol|sidearm|revolver|handgun/.test(cls)) return 'pistol';
  if(/smg|vector|mp\d|submachine/.test(cls)) return 'smg';
  if(/shotgun|shot|pump|boomstick/.test(cls)) return 'shotgun';
  if(/sniper|dmr|marksman|bolt/.test(cls)) return 'sniper';
  if(/rifle|carbine|ar|assault|battle/.test(cls)) return 'rifle';
  // stat fallback: long range + low rpm = marksman; tiny range = smg; else rifle
  if(typeof w.range==='number'){
    if(w.range>=120 && (w.rpm||600)<=260) return 'sniper';
    if(w.range<=55 && (w.mag||30)<=30 && (w.rpm||600)>=600) return 'smg';
  }
  return 'rifle';
}

// the drawing key for an item: its TYPE, refined for the categories that have
// sub-shapes (weapons by class, attachments by slot, ammo/valuables by id flavor).
function drawKind(def){
  const t=def.type;
  if(t==='weapon') return 'wpn_'+weaponClass(def);
  if(t==='attachment'){ const eff=DATA.attachments&&DATA.attachments[def.id]; const slot=(eff&&eff.slot)||def.slot||'optic'; return 'att_'+(slot==='tactical'?'foregrip':slot); }
  if(t==='valuable'){ if(def.bank) return 'val_cash'; if(/gold/.test(def.id||'')) return 'val_gold'; if(/diamond|gem/.test(def.id||'')) return 'val_gem'; if(/watch/.test(def.id||'')) return 'val_watch'; return 'val_artifact'; }
  return t || 'misc';
}

// ---- low-level canvas helpers (all draw into a 0..S box, S = px) ----
function roundRect(c,x,y,w,h,r){ c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }
function frame(c,S,tint){
  // dark tile + rarity-tinted inner frame + faint top-left sheen
  c.clearRect(0,0,S,S);
  const g=c.createLinearGradient(0,0,0,S); g.addColorStop(0,'#272d33'); g.addColorStop(1,'#171b20');
  roundRect(c,1,1,S-2,S-2,Math.max(3,S*0.14)); c.fillStyle=g; c.fill();
  c.lineWidth=Math.max(1.5,S*0.05); c.strokeStyle=tint; c.globalAlpha=0.85; c.stroke(); c.globalAlpha=1;
}
function bodyStroke(c,S,col){ c.strokeStyle=col||'#cfd6dd'; c.lineWidth=Math.max(2,S*0.075); c.lineJoin='round'; c.lineCap='round'; }
function fillSteel(c,S){ const g=c.createLinearGradient(0,0,0,S); g.addColorStop(0,'#c6cdd4'); g.addColorStop(1,'#6f7882'); return g; }

// ---- per-category glyph painters. Coordinates are fractions of S. ----
const P = {
  // GUNS — class-distinct silhouettes (barrel + receiver + grip cues)
  wpn_pistol(c,S){ const u=v=>v*S; c.fillStyle=fillSteel(c,S); c.strokeStyle='#11161b'; c.lineWidth=Math.max(1,S*0.03);
    c.beginPath(); c.moveTo(u(.18),u(.38)); c.lineTo(u(.80),u(.38)); c.lineTo(u(.80),u(.50)); c.lineTo(u(.46),u(.50)); c.lineTo(u(.42),u(.74)); c.lineTo(u(.30),u(.74)); c.lineTo(u(.30),u(.50)); c.lineTo(u(.18),u(.50)); c.closePath(); c.fill(); c.stroke();
    c.fillStyle='#2a2f35'; c.fillRect(u(.74),u(.30),u(.05),u(.08)); /* sight */ },
  wpn_smg(c,S){ const u=v=>v*S; c.fillStyle=fillSteel(c,S); c.strokeStyle='#11161b'; c.lineWidth=Math.max(1,S*0.03);
    c.beginPath(); c.moveTo(u(.14),u(.40)); c.lineTo(u(.84),u(.40)); c.lineTo(u(.84),u(.50)); c.lineTo(u(.40),u(.50)); c.lineTo(u(.36),u(.70)); c.lineTo(u(.26),u(.70)); c.lineTo(u(.26),u(.50)); c.lineTo(u(.14),u(.50)); c.closePath(); c.fill(); c.stroke();
    c.fillStyle='#3a4047'; c.fillRect(u(.46),u(.50),u(.06),u(.26)); /* stick mag */ c.strokeRect(u(.46),u(.50),u(.06),u(.26)); },
  wpn_rifle(c,S){ const u=v=>v*S; c.fillStyle=fillSteel(c,S); c.strokeStyle='#11161b'; c.lineWidth=Math.max(1,S*0.03);
    c.beginPath(); c.moveTo(u(.08),u(.42)); c.lineTo(u(.90),u(.42)); c.lineTo(u(.90),u(.50)); c.lineTo(u(.42),u(.50)); c.lineTo(u(.40),u(.66)); c.lineTo(u(.30),u(.66)); c.lineTo(u(.30),u(.50)); c.lineTo(u(.08),u(.50)); c.closePath(); c.fill(); c.stroke();
    c.fillStyle='#3a4047'; c.beginPath(); c.moveTo(u(.50),u(.50)); c.lineTo(u(.60),u(.50)); c.lineTo(u(.62),u(.74)); c.lineTo(u(.52),u(.74)); c.closePath(); c.fill(); c.stroke(); /* curved mag */
    c.fillStyle='#2a2f35'; c.fillRect(u(.34),u(.33),u(.05),u(.09)); /* front sight */ },
  wpn_shotgun(c,S){ const u=v=>v*S; c.fillStyle=fillSteel(c,S); c.strokeStyle='#11161b'; c.lineWidth=Math.max(1,S*0.03);
    c.beginPath(); c.moveTo(u(.10),u(.40)); c.lineTo(u(.88),u(.40)); c.lineTo(u(.88),u(.52)); c.lineTo(u(.10),u(.52)); c.closePath(); c.fill(); c.stroke();
    c.fillStyle='#6b4a2a'; /* wood stock */ c.beginPath(); c.moveTo(u(.10),u(.40)); c.lineTo(u(.10),u(.52)); c.lineTo(u(.02),u(.62)); c.lineTo(u(.02),u(.44)); c.closePath(); c.fill(); c.stroke();
    c.fillStyle='#3a4047'; c.fillRect(u(.40),u(.52),u(.07),u(.18)); c.strokeRect(u(.40),u(.52),u(.07),u(.18)); /* pump */ },
  wpn_sniper(c,S){ const u=v=>v*S; c.fillStyle=fillSteel(c,S); c.strokeStyle='#11161b'; c.lineWidth=Math.max(1,S*0.03);
    c.beginPath(); c.moveTo(u(.06),u(.44)); c.lineTo(u(.92),u(.44)); c.lineTo(u(.92),u(.51)); c.lineTo(u(.40),u(.51)); c.lineTo(u(.38),u(.68)); c.lineTo(u(.28),u(.68)); c.lineTo(u(.28),u(.51)); c.lineTo(u(.06),u(.51)); c.closePath(); c.fill(); c.stroke();
    c.fillStyle='#1a1f24'; roundRect(c,u(.46),u(.30),u(.30),u(.10),u(.03)); c.fill(); c.stroke(); /* long scope */ },

  // ATTACHMENTS / MODS — by slot
  att_optic(c,S){ const u=v=>v*S; c.strokeStyle='#cfd6dd'; c.lineWidth=Math.max(2,S*0.06); c.fillStyle='#1a1f24';
    roundRect(c,u(.24),u(.30),u(.52),u(.40),u(.06)); c.fill(); c.stroke();
    c.beginPath(); c.arc(u(.50),u(.50),u(.13),0,7); c.fillStyle='#0c1014'; c.fill(); c.strokeStyle='#7afcff'; c.lineWidth=Math.max(1.5,S*0.04); c.stroke();
    c.fillStyle='#ff3b30'; c.beginPath(); c.arc(u(.50),u(.50),u(.03),0,7); c.fill(); /* red dot */ },
  att_laser(c,S){ const u=v=>v*S; c.fillStyle='#2a2f35'; c.strokeStyle='#11161b'; c.lineWidth=Math.max(1,S*0.03);
    roundRect(c,u(.22),u(.40),u(.34),u(.20),u(.05)); c.fill(); c.stroke();
    c.strokeStyle='#ff3b30'; c.lineWidth=Math.max(2,S*0.06); c.beginPath(); c.moveTo(u(.56),u(.50)); c.lineTo(u(.86),u(.50)); c.stroke();
    c.fillStyle='#ff3b30'; c.beginPath(); c.arc(u(.86),u(.50),u(.04),0,7); c.fill(); },
  att_foregrip(c,S){ const u=v=>v*S; c.strokeStyle='#cfd6dd'; bodyStroke(c,S,'#cfd6dd'); c.fillStyle='#3a4047';
    c.fillRect(u(.30),u(.28),u(.40),u(.12)); c.strokeRect(u(.30),u(.28),u(.40),u(.12)); /* rail clamp */
    c.fillStyle='#2a2f35'; roundRect(c,u(.42),u(.40),u(.16),u(.34),u(.05)); c.fill(); c.stroke(); /* vertical grip */ },
  att_stock(c,S){ const u=v=>v*S; c.fillStyle='#3a4047'; c.strokeStyle='#11161b'; c.lineWidth=Math.max(1,S*0.03);
    c.beginPath(); c.moveTo(u(.20),u(.40)); c.lineTo(u(.66),u(.40)); c.lineTo(u(.66),u(.48)); c.lineTo(u(.30),u(.48)); c.lineTo(u(.30),u(.66)); c.lineTo(u(.20),u(.66)); c.closePath(); c.fill(); c.stroke();
    c.fillStyle='#2a2f35'; roundRect(c,u(.66),u(.36),u(.14),u(.34),u(.04)); c.fill(); c.stroke(); /* butt pad */ },
  att_muzzle(c,S){ const u=v=>v*S; c.fillStyle=fillSteel(c,S); c.strokeStyle='#11161b'; c.lineWidth=Math.max(1,S*0.03);
    roundRect(c,u(.28),u(.40),u(.44),u(.20),u(.05)); c.fill(); c.stroke();
    c.fillStyle='#0c1014'; for(let i=0;i<3;i++){ c.fillRect(u(.34+i*0.11),u(.43),u(.05),u(.14)); } /* vents */ },
  att_barrel(c,S){ const u=v=>v*S; c.fillStyle=fillSteel(c,S); c.strokeStyle='#11161b'; c.lineWidth=Math.max(1,S*0.03);
    c.fillRect(u(.16),u(.45),u(.66),u(.10)); c.strokeRect(u(.16),u(.45),u(.66),u(.10));
    c.fillStyle='#0c1014'; c.beginPath(); c.arc(u(.82),u(.50),u(.06),0,7); c.fill(); /* bore */ },
  att_magazine(c,S){ const u=v=>v*S; c.fillStyle='#3a4047'; c.strokeStyle='#11161b'; c.lineWidth=Math.max(1.5,S*0.045);
    c.beginPath(); c.moveTo(u(.40),u(.24)); c.lineTo(u(.60),u(.24)); c.lineTo(u(.66),u(.74)); c.lineTo(u(.46),u(.74)); c.closePath(); c.fill(); c.stroke();
    c.fillStyle='#c8a23a'; c.fillRect(u(.43),u(.22),u(.16),u(.05)); /* brass top round */ },

  // AMMO — a brass round (tint by caliber-ish color if present)
  ammo(c,S){ const u=v=>v*S; const col=def=>'#c8a23a';
    c.fillStyle='#c8a23a'; c.strokeStyle='#8a6f20'; c.lineWidth=Math.max(1,S*0.03);
    function round(x){ c.beginPath(); c.moveTo(x,u(.66)); c.lineTo(x,u(.40)); c.quadraticCurveTo(x,u(.28),x+u(.07),u(.28)); c.quadraticCurveTo(x+u(.14),u(.28),x+u(.14),u(.40)); c.lineTo(x+u(.14),u(.66)); c.closePath(); c.fill(); c.stroke();
      c.fillStyle='#b9c0c7'; c.fillRect(x,u(.58),u(.14),u(.10)); c.strokeRect(x,u(.58),u(.14),u(.10)); c.fillStyle='#c8a23a'; }
    round(u(.30)); round(u(.52)); },

  // ARMOR — a shield / plate carrier
  armor(c,S){ const u=v=>v*S; c.fillStyle='#3b5a46'; c.strokeStyle='#cfd6dd'; c.lineWidth=Math.max(2,S*0.06);
    c.beginPath(); c.moveTo(u(.50),u(.22)); c.lineTo(u(.78),u(.32)); c.lineTo(u(.78),u(.56)); c.quadraticCurveTo(u(.50),u(.82),u(.50),u(.82)); c.quadraticCurveTo(u(.22),u(.66),u(.22),u(.56)); c.lineTo(u(.22),u(.32)); c.closePath(); c.fill(); c.stroke();
    c.strokeStyle='#9fb3a6'; c.lineWidth=Math.max(1,S*0.03); c.strokeRect(u(.38),u(.38),u(.24),u(.22)); /* plate seam */ },
  helmet(c,S){ const u=v=>v*S; c.fillStyle='#4a5159'; c.strokeStyle='#cfd6dd'; c.lineWidth=Math.max(2,S*0.06);
    c.beginPath(); c.arc(u(.50),u(.52),u(.26),Math.PI,0); c.lineTo(u(.76),u(.62)); c.lineTo(u(.24),u(.62)); c.closePath(); c.fill(); c.stroke();
    c.strokeStyle='#2a2f35'; c.beginPath(); c.moveTo(u(.30),u(.50)); c.lineTo(u(.70),u(.50)); c.stroke(); /* rim */ },
  clothing(c,S){ const u=v=>v*S; c.fillStyle='#5a4a3a'; c.strokeStyle='#cfd6dd'; c.lineWidth=Math.max(2,S*0.055);
    c.beginPath(); c.moveTo(u(.36),u(.26)); c.lineTo(u(.50),u(.34)); c.lineTo(u(.64),u(.26)); c.lineTo(u(.78),u(.40)); c.lineTo(u(.68),u(.50)); c.lineTo(u(.68),u(.76)); c.lineTo(u(.32),u(.76)); c.lineTo(u(.32),u(.50)); c.lineTo(u(.22),u(.40)); c.closePath(); c.fill(); c.stroke(); /* shirt */ },
  backpack(c,S){ const u=v=>v*S; c.fillStyle='#42504a'; c.strokeStyle='#cfd6dd'; c.lineWidth=Math.max(2,S*0.055);
    roundRect(c,u(.28),u(.28),u(.44),u(.50),u(.08)); c.fill(); c.stroke();
    c.fillStyle='#2f3a35'; roundRect(c,u(.40),u(.30),u(.20),u(.22),u(.04)); c.fill(); c.stroke(); /* top pocket */ },
  rig(c,S){ const u=v=>v*S; c.fillStyle='#4a4438'; c.strokeStyle='#cfd6dd'; c.lineWidth=Math.max(2,S*0.055);
    roundRect(c,u(.30),u(.26),u(.40),u(.52),u(.05)); c.fill(); c.stroke();
    c.fillStyle='#2f2c24'; for(let i=0;i<2;i++)for(let j=0;j<2;j++){ roundRect(c,u(.35+j*0.18),u(.34+i*0.20),u(.13),u(.15),u(.02)); c.fill(); c.stroke(); } /* pouches */ },
  case(c,S){ const u=v=>v*S; c.fillStyle='#3a4047'; c.strokeStyle='#cfd6dd'; c.lineWidth=Math.max(2,S*0.055);
    roundRect(c,u(.20),u(.34),u(.60),u(.40),u(.05)); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(u(.20),u(.46)); c.lineTo(u(.80),u(.46)); c.stroke(); /* lid seam */
    c.fillStyle='#cfd6dd'; c.fillRect(u(.46),u(.30),u(.08),u(.06)); /* handle */ },

  // MEDS / CONSUMABLES — red cross kit
  med(c,S){ const u=v=>v*S; c.fillStyle='#d8453e'; c.strokeStyle='#fff'; c.lineWidth=Math.max(1.5,S*0.04);
    roundRect(c,u(.26),u(.30),u(.48),u(.42),u(.06)); c.fill();
    c.fillStyle='#fff'; c.fillRect(u(.46),u(.36),u(.08),u(.30)); c.fillRect(u(.35),u(.47),u(.30),u(.08)); /* + */ },
  food(c,S){ const u=v=>v*S; c.fillStyle='#8a6f3a'; c.strokeStyle='#cfd6dd'; c.lineWidth=Math.max(1.5,S*0.045);
    roundRect(c,u(.32),u(.28),u(.36),u(.48),u(.05)); c.fill(); c.stroke();
    c.fillStyle='#cfd6dd'; c.fillRect(u(.32),u(.42),u(.36),u(.06)); c.fillRect(u(.32),u(.54),u(.36),u(.06)); /* label bands */ },

  // THROWABLES — grenade
  throwable(c,S){ const u=v=>v*S; c.fillStyle='#3f5a2a'; c.strokeStyle='#11161b'; c.lineWidth=Math.max(1,S*0.03);
    c.beginPath(); c.arc(u(.50),u(.58),u(.20),0,7); c.fill(); c.stroke();
    c.fillStyle='#2a2f35'; c.fillRect(u(.44),u(.28),u(.12),u(.12)); c.strokeRect(u(.44),u(.28),u(.12),u(.12)); /* fuse cap */
    c.strokeStyle='#9aa0a6'; c.lineWidth=Math.max(1.5,S*0.04); c.beginPath(); c.arc(u(.60),u(.30),u(.06),0,7); c.stroke(); /* pin ring */ },

  // MATERIALS — gear / scrap
  material(c,S){ const u=v=>v*S; c.strokeStyle='#9aa0a6'; c.fillStyle='#6f7882'; c.lineWidth=Math.max(1.5,S*0.04);
    c.beginPath(); for(let i=0;i<8;i++){ const a=i/8*Math.PI*2, ro=u(.24), ri=u(.30); c.lineTo(u(.50)+Math.cos(a)*ro, u(.52)+Math.sin(a)*ro); c.lineTo(u(.50)+Math.cos(a+0.39)*ri, u(.52)+Math.sin(a+0.39)*ri); } c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.arc(u(.50),u(.52),u(.08),0,7); c.fillStyle='#0c1014'; c.fill(); /* gear hole */ },

  // VALUABLES
  val_cash(c,S){ const u=v=>v*S; c.fillStyle='#3a7a4a'; c.strokeStyle='#cfe8cf'; c.lineWidth=Math.max(1.5,S*0.04);
    roundRect(c,u(.22),u(.36),u(.56),u(.30),u(.03)); c.fill(); c.stroke();
    c.fillStyle='#cfe8cf'; c.beginPath(); c.arc(u(.50),u(.51),u(.07),0,7); c.fill(); c.fillStyle='#3a7a4a'; c.font=`bold ${Math.round(S*0.11)}px monospace`; c.textAlign='center'; c.textBaseline='middle'; c.fillText('$',u(.50),u(.515)); },
  val_gold(c,S){ const u=v=>v*S; const g=c.createLinearGradient(0,u(.4),0,u(.66)); g.addColorStop(0,'#ffe08a'); g.addColorStop(1,'#c89a2a'); c.fillStyle=g; c.strokeStyle='#8a6f20'; c.lineWidth=Math.max(1.5,S*0.04);
    c.beginPath(); c.moveTo(u(.24),u(.62)); c.lineTo(u(.30),u(.44)); c.lineTo(u(.76),u(.44)); c.lineTo(u(.82),u(.62)); c.closePath(); c.fill(); c.stroke();
    c.fillStyle='#fff4cc'; c.globalAlpha=.5; c.fillRect(u(.34),u(.46),u(.30),u(.04)); c.globalAlpha=1; },
  val_gem(c,S){ const u=v=>v*S; c.fillStyle='#6fd8d0'; c.strokeStyle='#cfeef0'; c.lineWidth=Math.max(1.5,S*0.04);
    c.beginPath(); c.moveTo(u(.50),u(.30)); c.lineTo(u(.72),u(.46)); c.lineTo(u(.50),u(.76)); c.lineTo(u(.28),u(.46)); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(u(.28),u(.46)); c.lineTo(u(.72),u(.46)); c.moveTo(u(.50),u(.30)); c.lineTo(u(.50),u(.76)); c.stroke(); },
  val_watch(c,S){ const u=v=>v*S; c.strokeStyle='#cfd6dd'; c.lineWidth=Math.max(2.5,S*0.08); c.beginPath(); c.arc(u(.50),u(.52),u(.20),0,7); c.stroke();
    c.fillStyle='#1a1f24'; c.beginPath(); c.arc(u(.50),u(.52),u(.14),0,7); c.fill(); c.strokeStyle='#e8a33d'; c.lineWidth=Math.max(1.5,S*0.04); c.beginPath(); c.moveTo(u(.50),u(.52)); c.lineTo(u(.50),u(.42)); c.moveTo(u(.50),u(.52)); c.lineTo(u(.58),u(.54)); c.stroke(); },
  val_artifact(c,S){ const u=v=>v*S; c.fillStyle='#8a6fd8'; c.strokeStyle='#d8cfff'; c.lineWidth=Math.max(1.5,S*0.045);
    c.beginPath(); c.moveTo(u(.50),u(.26)); c.lineTo(u(.70),u(.44)); c.lineTo(u(.62),u(.74)); c.lineTo(u(.38),u(.74)); c.lineTo(u(.30),u(.44)); c.closePath(); c.fill(); c.stroke();
    c.fillStyle='#fff'; c.globalAlpha=.6; c.beginPath(); c.arc(u(.50),u(.50),u(.05),0,7); c.fill(); c.globalAlpha=1; },

  // KEYS / QUEST
  key(c,S){ const u=v=>v*S; c.strokeStyle='#e8c34d'; c.fillStyle='#e8c34d'; c.lineWidth=Math.max(2,S*0.06);
    c.beginPath(); c.arc(u(.36),u(.42),u(.12),0,7); c.stroke();
    c.beginPath(); c.moveTo(u(.44),u(.50)); c.lineTo(u(.74),u(.68)); c.stroke();
    c.beginPath(); c.moveTo(u(.66),u(.58)); c.lineTo(u(.72),u(.54)); c.stroke(); },
  deployable(c,S){ const u=v=>v*S; c.fillStyle='#4a5159'; c.strokeStyle='#7afcff'; c.lineWidth=Math.max(1.5,S*0.045);
    roundRect(c,u(.32),u(.38),u(.36),u(.26),u(.05)); c.fill(); c.stroke();
    c.beginPath(); c.arc(u(.40),u(.50),u(.04),0,7); c.fillStyle='#7afcff'; c.fill(); c.beginPath(); c.arc(u(.60),u(.50),u(.04),0,7); c.fill();
    c.strokeStyle='#7afcff'; c.beginPath(); c.moveTo(u(.50),u(.38)); c.lineTo(u(.50),u(.28)); c.stroke(); c.beginPath(); c.arc(u(.50),u(.26),u(.03),0,7); c.fillStyle='#7afcff'; c.fill(); },

  misc(c,S){ const u=v=>v*S; c.fillStyle='#6f7882'; c.strokeStyle='#cfd6dd'; c.lineWidth=Math.max(1.5,S*0.045);
    roundRect(c,u(.30),u(.30),u(.40),u(.40),u(.06)); c.fill(); c.stroke(); },
};

const PX = 64;                 // render resolution (crisp at any tile size)
const cache = Object.create(null);
function sig(def){ return (def.id||def.type||'misc')+'|'+(def.rarity||1); }

// dataURL for an item's icon (cached per signature). Falls back to a misc box if a
// painter or canvas is unavailable.
function iconURL(def){
  const k=sig(def); if(cache[k]) return cache[k];
  let url='';
  try{
    const cv=document.createElement('canvas'); cv.width=PX; cv.height=PX;
    const c=cv.getContext('2d'); c.imageSmoothingEnabled=true;
    frame(c,PX,rarHex(def.rarity||1));
    const kind=drawKind(def);
    const painter = P[kind] || P[def.type] || P.misc;
    painter(c,PX);
    url=cv.toDataURL('image/png');
  }catch(e){ url=''; }
  cache[k]=url; return url;
}

// HTML <img> for an item icon (drop-in replacement for the emoji string). `cls` is
// an optional extra class. The img is draggable=false so it never starts the
// browser's native image-drag and fight the pointer-based inventory drag.
export function iconHTML(def, cls){
  const u=iconURL(def);
  if(!u) return `<span class="ic-fallback">▪</span>`;
  return `<img class="itemicon${cls?' '+cls:''}" src="${u}" alt="" draggable="false">`;
}
// raw url (for the drag-ghost / places that build their own element)
export function iconURLOf(def){ return iconURL(def); }
