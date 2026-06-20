// account.js — SYS: Account. Shared cross-game login (Firebase Auth) layered ON
// TOP of the local-only game. ENTIRELY OPTIONAL: if the Firebase compat SDK
// isn't present (offline / blocked / headless tests) ACC.ok stays false and every
// path early-returns, so the game runs byte-for-byte unchanged and the bug-report
// widget falls back to its old name field.
//
// SHARED SESSION: every LootNShoot/Riftspawn/etc. page is the same origin
// (ggmoosie.github.io) and uses the SAME Firebase project (riftspawn) with the
// DEFAULT local/IndexedDB persistence — so signing into ANY game signs you into
// ALL of them automatically (the persisted session is restored on the next load
// and onAuthStateChanged fires with the user).
//
// Mirrors Riftspawn's auth flow (same project, same compat SDK version) so the
// account + username handling is consistent. The one deliberate difference:
// LootNShoot logs in with a REAL email + password (Riftspawn uses a synthetic
// username@domain email). The username still comes from Firestore
// `users/{uid}.username` (fallback = the email's local part) exactly like
// Riftspawn, so the cross-game username is identical.

import { Events } from "./state.js";

const FBCFG = {
  apiKey: "AIzaSyDrQoHh2inTbdwV021hM-LPRm2hP7ACgyE",
  authDomain: "riftspawn.firebaseapp.com",
  projectId: "riftspawn",
  appId: "1:670435327804:web:826a9fe90d6f1c970f2839"
};

// Internal singleton. `user` is the Firebase user object; `username` is resolved
// from Firestore (or the email local-part fallback). `ready` flips true after the
// first onAuthStateChanged so the UI can tell "still resolving" from "signed out".
const ACC = { ok:false, auth:null, db:null, user:null, username:null, ready:false };

function accLog(){ try{ console.log.apply(console,['%c[account]','color:#6fa8dc;font-weight:bold'].concat([].slice.call(arguments))); }catch(_){} }
function accErr(label,e){ try{ console.error('[account] '+label+' FAILED — code:',(e&&e.code)||'(none)',' message:',(e&&e.message)||e); }catch(_){} }

// ---- init (no-op + stays offline if the SDK didn't load) ----
function init(){
  if(typeof firebase==='undefined' || !firebase.initializeApp){ accLog('Firebase SDK absent — running offline (login disabled, game unaffected)'); return false; }
  try{
    if(!firebase.apps || !firebase.apps.length) firebase.initializeApp(FBCFG);
    ACC.auth = firebase.auth();
    try{ ACC.db = firebase.firestore(); }catch(_){ ACC.db = null; } // Firestore is optional: username falls back to the email local-part
    ACC.ok = true;
    accLog('init OK — project',FBCFG.projectId,'· DEFAULT (local) persistence = session shared across same-origin games · waiting for auth state…');
    ACC.auth.onAuthStateChanged(u=>onAuth(u));
    return true;
  }catch(e){ accErr('init',e); ACC.ok=false; return false; }
}

// ---- helpers / public predicates ----
const emailLocal = u => ((u&&u.email)||'').split('@')[0] || 'operator';
function available(){ return ACC.ok; }
function loggedIn(){ return ACC.ok && !!ACC.user; }
// {uid, username} when signed in, else null. The single accessor the rest of the
// game uses — never reach into ACC directly.
function current(){ return loggedIn() ? { uid:ACC.user.uid, username:ACC.username || emailLocal(ACC.user) } : null; }

// ---- auth actions (thin wrappers; promises so the UI can await + show errors) ----
async function signUp(email, pass){
  if(!ACC.ok) throw { code:'offline' };
  const cred = await ACC.auth.createUserWithEmailAndPassword((email||'').trim(), pass);
  // Seed users/{uid}.username from the email local-part so it matches the
  // cross-game convention. Best-effort: a Firestore failure must not fail signup.
  try{ if(ACC.db) await ACC.db.collection('users').doc(cred.user.uid).set({ username:emailLocal(cred.user), updatedAt:Date.now() }, { merge:true }); }catch(e){ accErr('seed users/'+cred.user.uid,e); }
  return cred.user;
}
async function signIn(email, pass){
  if(!ACC.ok) throw { code:'offline' };
  return ACC.auth.signInWithEmailAndPassword((email||'').trim(), pass);
}
function signOut(){ if(ACC.ok && ACC.auth) return ACC.auth.signOut(); }

// human-friendly, enumeration-safe error text (mirrors Riftspawn's cloudErr)
function errText(e, isSignup){
  const c = (e&&e.code) || '';
  if(c==='offline') return 'Login unavailable — playing offline';
  if(c==='auth/invalid-email') return 'That doesn’t look like a valid email';
  if(c==='auth/weak-password') return 'Password must be at least 6 characters';
  if(c==='auth/network-request-failed') return 'Network error — check your connection';
  if(c==='auth/too-many-requests') return 'Too many attempts — try again shortly';
  if(isSignup) return (c==='auth/email-already-in-use') ? 'That email already has an account' : 'Could not create account';
  return 'Wrong email or password'; // login: stay generic (enumeration protection)
}

// ---- auth state changes: resolve the username, then announce on the bus ----
async function onAuth(u){
  ACC.user = u || null;
  ACC.ready = true;
  if(!u){ accLog('auth: signed OUT'); ACC.username=null; Events.emit('account:changed', null); return; }
  accLog('auth: signed IN — uid =',u.uid);
  // Read users/{uid}.username (authenticated FIRST, so no read-before-auth race),
  // fall back to the email local-part — same precedence as Riftspawn.
  try{
    if(ACC.db){ const us = await ACC.db.collection('users').doc(u.uid).get();
      ACC.username = (us.exists && us.data().username) || emailLocal(u); }
    else ACC.username = emailLocal(u);
  }catch(e){ accErr('read users/'+u.uid,e); ACC.username = emailLocal(u); }
  accLog('username =',ACC.username);
  Events.emit('account:changed', current());
}

export const Account = { init, available, loggedIn, current, signIn, signUp, signOut, errText };
