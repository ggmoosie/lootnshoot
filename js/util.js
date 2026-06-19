// util.js — small pure helpers shared across systems (math, key labels, RNG) plus
// the two icon/rarity lookups that read the DATA tables.
import { DATA } from "./data.js";

// clamp a value into [a,b]
export function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

// pretty-print a KeyboardEvent.code for the HUD/settings (KeyW -> W, etc.)
export function keyName(code){ if(!code) return '—'; return code.replace(/^Key/,'').replace(/^Digit/,'').replace('ShiftLeft','LShift').replace('ShiftRight','RShift').replace('ControlLeft','LCtrl').replace('Space','Space').replace('ArrowUp','↑').replace('ArrowDown','↓').replace('ArrowLeft','←').replace('ArrowRight','→'); }

// mulberry32 seeded PRNG factory — deterministic raid geometry per stop
export function mulberry(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

// rarity index -> swatch color (used by loot meshes / pickups)
export function rarityColor(r){ return [0x9aa0a6,0x9aa0a6,0x57c06b,0x6fa8dc,0xc06fd8,0xe8a33d][r]||0x9aa0a6; }

// best emoji icon for an item def (per-id override, else per-type, else dot)
export function iconFor(def){ return DATA.iconId[def.id] || DATA.iconType[def.type] || '▪'; }
