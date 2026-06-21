// audio.js — SYS: Audio. Thin WebAudio blip layer. Event-driven so real SFX can
// drop in later. No-ops safely where WebAudio is unavailable.
//
// POSITIONAL AUDIO (feat/audio-minimap): every blip can be placed in the world.
// `play(name, pos)` / `callout(name, pos)` accept an optional THREE.Vector3 (or
// any {x,y,z}); when given, the sound is routed through a PannerNode so it pans
// L/R by direction and attenuates by distance from the listener (the camera).
// Calls WITHOUT a position stay exactly as before — a plain mono blip on the
// master bus — so every existing caller (UI clicks, pickups, player steps) is
// unaffected. `setListener(pos, fwd)` syncs the WebAudio listener to the camera
// each frame; the loop calls it. Everything degrades gracefully: no WebAudio,
// no PannerNode, or a bad position all fall back to a plain mono blip.

export const Audio = (function(){
  let ctx=null, ok=true, master=null;
  function ac(){ if(ctx) return ctx; try{ const C=window.AudioContext||window.webkitAudioContext; if(!C){ ok=false; return null; } ctx=new C(); master=ctx.createGain(); master.gain.value=1; master.connect(ctx.destination); }catch(e){ ok=false; } return ctx; }
  function resume(){ const c=ac(); if(c && c.state==='suspended'){ try{ c.resume(); }catch(e){} } }

  // ----- positional listener: kept in sync with the camera by the loop ---------
  // Stores the latest listener world position + forward so we can decide whether
  // a sound is even audible (cull far events) and so the PannerNode math has a
  // current reference. Updating ctx.listener uses the modern AudioParam API when
  // present, falling back to the deprecated setPosition/setOrientation.
  const _lp={x:0,y:1.7,z:0};            // last listener position (defaults: spawn eye height)
  function setListener(pos, fwd){
    if(pos){ _lp.x=pos.x; _lp.y=pos.y; _lp.z=pos.z; }
    const c=ctx; if(!c||!c.listener) return;     // don't spin up ctx just to track the camera
    try{
      const L=c.listener, t=c.currentTime;
      if(L.positionX){ L.positionX.setValueAtTime(_lp.x,t); L.positionY.setValueAtTime(_lp.y,t); L.positionZ.setValueAtTime(_lp.z,t); }
      else if(L.setPosition){ L.setPosition(_lp.x,_lp.y,_lp.z); }
      if(fwd){
        if(L.forwardX){ L.forwardX.setValueAtTime(fwd.x,t); L.forwardY.setValueAtTime(fwd.y,t); L.forwardZ.setValueAtTime(fwd.z,t);
          L.upX.setValueAtTime(0,t); L.upY.setValueAtTime(1,t); L.upZ.setValueAtTime(0,t); }
        else if(L.setOrientation){ L.setOrientation(fwd.x,fwd.y,fwd.z, 0,1,0); }
      }
    }catch(e){}
  }
  // build a per-sound spatial node chain (panner) anchored at world `pos`, feeding
  // the master bus. Returns the node a source should connect INTO, or null to mean
  // "play flat on master". distance model = inverse rolloff so close events are
  // loud and far ones taper — refDistance/maxDistance tuned for the raid's scale.
  function spatialNode(pos){
    const c=ctx; if(!c||!pos||!c.createPanner) return null;
    try{
      const pan=c.createPanner();
      // equalpower (not HRTF): cheap L/R + distance panning that scales to many
      // simultaneous enemy footsteps/shots without the HRTF convolution cost.
      try{ pan.panningModel='equalpower'; }catch(_){ }
      pan.distanceModel='inverse'; pan.refDistance=6; pan.maxDistance=120; pan.rolloffFactor=1.0;
      const t=c.currentTime;
      if(pan.positionX){ pan.positionX.setValueAtTime(pos.x,t); pan.positionY.setValueAtTime(pos.y,t); pan.positionZ.setValueAtTime(pos.z,t); }
      else if(pan.setPosition){ pan.setPosition(pos.x,pos.y,pos.z); }
      pan.connect(master);
      return pan;
    }catch(e){ return null; }
  }
  // a sound is worth synthesizing only if it's within earshot of the listener —
  // cheap squared-distance cull so a 200-unit-away footstep never spins up nodes.
  const HEAR2 = 130*130;
  function audible(pos){ if(!pos) return true; const dx=pos.x-_lp.x, dy=(pos.y||0)-_lp.y, dz=pos.z-_lp.z; return (dx*dx+dy*dy+dz*dz)<=HEAR2; }

  // name -> [freq, seconds, waveform, gain]
  const defs={ shot:[210,.05,'square',.16], shotSupp:[140,.05,'sine',.07], boom:[70,.4,'sawtooth',.22],
               drone:[520,.04,'triangle',.07], ui:[440,.03,'sine',.05], pickup:[660,.05,'triangle',.06],
               step:[120,.03,'sine',.025], reload:[330,.04,'square',.06], equip:[290,.05,'triangle',.07],
               clear:[523,.5,'triangle',.13], notify:[440,.14,'sine',.1],
               // ----- ENEMY sounds (feat/audio-minimap): always played positional -----
               efoot:[95,.045,'sine',.05],      // enemy footstep — duller/heavier than the player's
               ehurt:[200,.10,'sawtooth',.12],  // enemy takes a hit — short pained rasp
               edeath:[150,.34,'sawtooth',.16]  // enemy goes down — longer falling rasp (glide handled below)
             };
  // optional per-name frequency glide end (for falling/rising blips). f -> f1 over life.
  const glide={ edeath:60 };
  function play(name, pos){ if(!ok) return; const c=ac(); if(!c) return; const d=defs[name]||defs.ui;
    if(pos && !audible(pos)) return;                            // too far to hear — skip entirely
    try{ const o=c.createOscillator(), g=c.createGain(); o.type=d[2]; const t=c.currentTime;
      o.frequency.setValueAtTime(d[0],t);
      if(glide[name]!=null) o.frequency.exponentialRampToValueAtTime(Math.max(1,glide[name]),t+d[1]*0.95);
      const spat = pos ? spatialNode(pos) : null;              // positional chain, or flat on master
      o.connect(g); g.connect(spat||master||c.destination);
      g.gain.setValueAtTime(d[3],t); g.gain.exponentialRampToValueAtTime(0.0001,t+d[1]); o.start(t); o.stop(t+d[1]);
      if(spat) o.onended=()=>{ try{ spat.disconnect(); }catch(_){} };
    }catch(e){} }

  // ----- squad voice callouts: terse two-tone "radio chirps" so each key event
  // reads distinctly (rising = alert/contact, falling = grenade, flat = reloading).
  // name -> [f0, f1, seconds, waveform, gain] (frequency glides f0 -> f1).
  const calls={ contact:[420,760,.16,'square',.12], reloading:[300,300,.12,'triangle',.09],
                grenade:[680,300,.20,'sawtooth',.13], flank:[500,620,.12,'triangle',.08],
                // aggro/alert tag the moment an enemy locks on — a sharp rising bark
                aggro:[300,640,.14,'square',.13] };
  function callout(name, pos){ if(!ok) return; const c=ac(); if(!c) return; const d=calls[name]; if(!d) return;
    if(pos && !audible(pos)) return;
    try{ const o=c.createOscillator(), g=c.createGain(); o.type=d[3]; const t=c.currentTime;
      o.frequency.setValueAtTime(d[0],t); o.frequency.exponentialRampToValueAtTime(Math.max(1,d[1]),t+d[2]*0.9);
      const spat = pos ? spatialNode(pos) : null;
      o.connect(g); g.connect(spat||master||c.destination);
      g.gain.setValueAtTime(d[4],t); g.gain.exponentialRampToValueAtTime(0.0001,t+d[2]); o.start(t); o.stop(t+d[2]);
      if(spat) o.onended=()=>{ try{ spat.disconnect(); }catch(_){} };
    }catch(e){} }

  return { play, callout, resume, setListener };
})();
