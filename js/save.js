// save.js — SYS: Save. Persistence for the whole profile. Serializes the profile
// (grids serialize recursively); new-game seeds a starter loadout.
//
// TWO transports, same bytes:
//   • localStorage — always on; works when the file is opened normally (only
//     sandboxed embeds block it). The source of truth when logged out / offline.
//   • Firestore (cloud) — layered on TOP when the player is signed in, so progress
//     (stash, gear, credits, level, settings) FOLLOWS THE ACCOUNT across devices.
//     ENTIRELY degrade-able: every Firestore call is wrapped in try/catch and the
//     game falls back to localStorage on any failure — offline AND logged-out both
//     play byte-for-byte unchanged.
//
// NEWEST-WINS: this mirrors Riftspawn's cloud-save pattern EXACTLY (same project,
// same {save, ts} doc shape, same "compare timestamps, newer copy wins"). Riftspawn
// keys per-character under users/{uid}/characters/{id}; LootNShoot has a single
// profile, so it uses one doc users/{uid}/games/lootnshoot with {save, ts, v}. Each
// save stamps a millisecond `ts`; on login we pull the cloud doc and adopt it only
// if its ts is newer than local (a fresh device pulls your progress), otherwise we
// push local up (you played offline). The save FORMAT is unchanged — `ts` rides in
// an OUTER envelope, never inside the profile fields.
import { DATA } from "./data.js";
import { S, EQUIP_SLOTS, Events } from "./state.js";
import { Grid, newItem, serItem, desItem } from "./inventory.js";
import { Account } from "./account.js";

export const Save = (function(){
  const KEY='lootnshoot.save.v1';
  const CLOUD_COLLECTION='games', CLOUD_DOC='lootnshoot'; // users/{uid}/games/lootnshoot
  const SAVE_V=1;

  function newProfile(){
    const p={
      credits:1200, level:1, xp:0, skillPoints:0,
      skills:{vitality:0, athletics:0, marksman:0, engineer:0},
      equip:{primary:null, secondary:null, helmet:null, armor:null, clothing:null, rig:null, backpack:null},
      stash:new Grid(10,16),
      settings:{ sens:1, invertY:false, fov:78, infiniteAmmo:false, headbob:true, camShake:true, binds:Object.assign({},DATA.binds) },
    };
    // starter loadout
    const carbine=newItem('wpn_carbine'); carbine.inst.ammo=30;
    const pistol=newItem('wpn_pistol'); pistol.inst.ammo=15;
    p.equip.primary=carbine; p.equip.secondary=pistol;
    p.equip.rig=newItem('rig_basic'); p.equip.backpack=newItem('bag_small');
    // rig carries combat consumables so you deploy ready to fight (reload pulls from carried grids)
    [newItem('ammo_556',90), newItem('ammo_9mm',45), newItem('med_bandage',2), newItem('nade_frag',2)].forEach(i=>p.equip.rig.inst.container.add(i));
    // stash seed (spares + crafting)
    [newItem('ammo_556',60), newItem('ammo_9mm',60), newItem('med_kit',1), newItem('med_bandage',2),
     newItem('mat_filament',8), newItem('mat_scrap',6), newItem('nade_frag',1)].forEach(i=>p.stash.add(i));
    return p;
  }

  // ---- format (UNCHANGED): serProfile/desProfile produce the same profile shape ----
  function serProfile(p){
    return JSON.stringify({
      credits:p.credits, level:p.level, xp:p.xp, skillPoints:p.skillPoints, skills:p.skills, settings:p.settings,
      stash:p.stash.toJSON(),
      equip:Object.fromEntries(EQUIP_SLOTS.map(s=>[s, p.equip[s]?serItem(p.equip[s]):null])),
    });
  }
  function desProfile(str){
    const o=JSON.parse(str);
    const p={credits:o.credits, level:o.level, xp:o.xp, skillPoints:o.skillPoints, skills:o.skills,
      settings:Object.assign({ sens:1, invertY:false, fov:78, infiniteAmmo:false, headbob:true, camShake:true, binds:Object.assign({},DATA.binds) }, o.settings||{}),
      stash:Grid.fromJSON(o.stash), equip:{}};
    p.settings.binds=Object.assign({},DATA.binds,p.settings.binds||{});
    for(const s of EQUIP_SLOTS) p.equip[s]= o.equip[s]?desItem(o.equip[s]):null;
    return p;
  }

  // ---- envelope: {save:<profileJSON string>, ts, v}. localStorage and Firestore
  // both store the envelope so a millisecond timestamp travels with the bytes and
  // newest-wins works identically on both sides (exactly like Riftspawn parses ts).
  // BACK-COMPAT: an OLD localStorage value is the raw profile JSON (no envelope) —
  // unwrap() detects that (no .save field) and treats it as ts=0 so the cloud copy
  // wins the first sync, then it gets re-saved in the new envelope form. ----
  function wrap(profileStr, ts){ return JSON.stringify({ v:SAVE_V, ts:ts||Date.now(), save:profileStr }); }
  function unwrap(rawStr){
    try{
      const o=JSON.parse(rawStr);
      if(o && typeof o.save==='string') return { save:o.save, ts:o.ts||0 }; // new envelope
      // legacy: the stored string IS the profile JSON (it has profile fields) → ts unknown
      if(o && (o.equip!==undefined || o.stash!==undefined || o.credits!==undefined)) return { save:rawStr, ts:0 };
    }catch(_){}
    return null;
  }
  // a save is "non-empty / real" if it deserializes to a profile with any progress
  // signal — used as a guard so we NEVER overwrite a real save with an empty/default
  // one (e.g. a transient blank serialization).
  function looksReal(profileStr){
    if(!profileStr || typeof profileStr!=='string') return false;
    try{ const o=JSON.parse(profileStr); return !!o && (o.equip!==undefined || o.stash!==undefined || o.credits!==undefined); }
    catch(_){ return false; }
  }

  // ---- localStorage transport ----
  function lsReadRaw(){ try{ return localStorage.getItem(KEY); }catch(_){ return null; } }
  function lsWrap(){ const raw=lsReadRaw(); return raw?unwrap(raw):null; }   // {save, ts} | null
  function lsWriteWrap(profileStr, ts){ try{ localStorage.setItem(KEY, wrap(profileStr, ts)); }catch(_){} }

  // ---- Firestore transport (mirrors Riftspawn cloudWriteChar / cloudPull) ----
  // _baseTs = the cloud ts we last reconciled with, so a push won't clobber a NEWER
  // cloud copy written by another device. All calls try/catch → silent fallback.
  let _baseTs=0;            // newest ts we know the cloud has reconciled to
  let _pulling=false, _pushing=false;
  function cloudDoc(){ const db=Account.db(), id=Account.uid(); if(!db||!id) return null;
    return db.collection('users').doc(id).collection(CLOUD_COLLECTION).doc(CLOUD_DOC); }

  async function cloudRead(){
    const ref=cloudDoc(); if(!ref) return null;
    try{ const d=await ref.get();
      if(d.exists){ const data=d.data()||{}; if(typeof data.save==='string' && data.save) return { save:data.save, ts:data.ts||0 }; }
      return null;
    }catch(e){ accSaveErr('cloud read',e); return null; }
  }
  async function cloudWrite(profileStr, ts){
    const ref=cloudDoc(); if(!ref) return false;
    if(!looksReal(profileStr)) return false; // SAFETY: never push an empty/default save to the cloud
    try{ await ref.set({ v:SAVE_V, save:profileStr, ts:ts||Date.now() }); _baseTs=Math.max(_baseTs, ts||0); return true; }
    catch(e){ accSaveErr('cloud write',e); return false; }
  }
  function accSaveErr(label,e){ try{ console.warn('[save] '+label+' failed (falling back to localStorage):',(e&&e.message)||e); }catch(_){} }

  // ---- public save: write localStorage ALWAYS; mirror to cloud when signed in ----
  // `ts` is one stamp shared by both transports so their timestamps stay comparable.
  function save(){
    if(!S.profile) return;
    let str; try{ str=serProfile(S.profile); }catch(_){ return; }
    if(!looksReal(str)) return; // SAFETY: refuse to persist an empty/default serialization over a real save
    const ts=Date.now();
    lsWriteWrap(str, ts);
    // fire-and-forget cloud mirror; failure is swallowed (we already wrote local)
    if(Account.cloudReady()) cloudWrite(str, ts);
  }

  // ---- public load: localStorage only (synchronous; used by the start card +
  // "Continue"). The cloud copy is reconciled into localStorage by syncOnAuth()
  // BEFORE this runs at the start screen, so a fresh device's "Continue" already
  // has the pulled-down progress. ----
  function load(){
    const w=lsWrap(); if(!w) return null;
    try{ return desProfile(w.save); }catch(_){ return null; }
  }
  function wipe(){ try{ localStorage.removeItem(KEY); }catch(_){} _baseTs=0; }

  // ---- newest-wins reconcile, run on auth-ready (account:changed with a user) ----
  // Compares the cloud doc against the local envelope:
  //   • cloud newer  → adopt it: mirror down to localStorage (a fresh device pulls
  //                    your progress) and, if we're still at the start screen, the
  //                    re-rendered start card / "Continue" picks it up.
  //   • local newer  → push local up (you played offline since the last sync).
  //   • no cloud yet → first-time: push local up if it's real (seeds the account);
  //                    nothing local → nothing to do (new-game will save later).
  // SAFETY: a real cloud save is never overwritten by an empty local one, and vice
  // versa; any Firestore error leaves localStorage untouched and the game playable.
  let _syncing=false;
  async function syncOnAuth(){
    if(!Account.cloudReady()){ return; }           // logged out / Firestore down → local-only
    if(_syncing) return; _syncing=true;
    let adopted=false;
    try{
      const cloud=await cloudRead();               // {save, ts} | null
      const local=lsWrap();                        // {save, ts} | null
      const cloudReal=cloud && looksReal(cloud.save);
      const localReal=local && looksReal(local.save);
      if(cloudReal && (!localReal || cloud.ts>=(local?local.ts:0))){
        // cloud wins (newer, or local missing/empty) → mirror down
        lsWriteWrap(cloud.save, cloud.ts); _baseTs=cloud.ts; adopted=true;
      } else if(localReal && (!cloudReal || (local.ts||0)>cloud.ts)){
        // local wins (newer offline play, or no real cloud doc yet) → push up
        await cloudWrite(local.save, local.ts||Date.now());
        _baseTs=Math.max(_baseTs, cloud?cloud.ts:0, local.ts||0);
      } else if(cloudReal){
        _baseTs=cloud.ts; // in sync already; remember the base
      }
    }catch(e){ accSaveErr('syncOnAuth',e); }
    _syncing=false;
    // tell the UI a cloud save was pulled so it can refresh the start card (and, if
    // already in-game, surface it). Only meaningful when we actually adopted cloud.
    if(adopted){ try{ Events.emit('save:cloud-pulled'); }catch(_){} }
    return adopted;
  }

  return { newProfile, save, load, wipe, syncOnAuth };
})();
