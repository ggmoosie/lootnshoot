// audio.js — SYS: Audio. Thin WebAudio blip layer. Event-driven so real SFX can
// drop in later. No-ops safely where WebAudio is unavailable.

export const Audio = (function(){
  let ctx=null, ok=true;
  function ac(){ if(ctx) return ctx; try{ const C=window.AudioContext||window.webkitAudioContext; if(!C){ ok=false; return null; } ctx=new C(); }catch(e){ ok=false; } return ctx; }
  function resume(){ const c=ac(); if(c && c.state==='suspended'){ try{ c.resume(); }catch(e){} } }
  // name -> [freq, seconds, waveform, gain]
  const defs={ shot:[210,.05,'square',.16], shotSupp:[140,.05,'sine',.07], boom:[70,.4,'sawtooth',.22],
               drone:[520,.04,'triangle',.07], ui:[440,.03,'sine',.05], pickup:[660,.05,'triangle',.06],
               step:[120,.03,'sine',.025], reload:[330,.04,'square',.06], equip:[290,.05,'triangle',.07],
               clear:[523,.5,'triangle',.13], notify:[440,.14,'sine',.1] };
  function play(name){ if(!ok) return; const c=ac(); if(!c) return; const d=defs[name]||defs.ui;
    try{ const o=c.createOscillator(), g=c.createGain(); o.type=d[2]; o.frequency.value=d[0];
      o.connect(g); g.connect(c.destination); const t=c.currentTime;
      g.gain.setValueAtTime(d[3],t); g.gain.exponentialRampToValueAtTime(0.0001,t+d[1]); o.start(t); o.stop(t+d[1]); }catch(e){} }

  // ----- squad voice callouts: terse two-tone "radio chirps" so each key event
  // reads distinctly (rising = alert/contact, falling = grenade, flat = reloading).
  // name -> [f0, f1, seconds, waveform, gain] (frequency glides f0 -> f1).
  const calls={ contact:[420,760,.16,'square',.12], reloading:[300,300,.12,'triangle',.09],
                grenade:[680,300,.20,'sawtooth',.13], flank:[500,620,.12,'triangle',.08] };
  function callout(name){ if(!ok) return; const c=ac(); if(!c) return; const d=calls[name]; if(!d) return;
    try{ const o=c.createOscillator(), g=c.createGain(); o.type=d[3]; const t=c.currentTime;
      o.frequency.setValueAtTime(d[0],t); o.frequency.exponentialRampToValueAtTime(Math.max(1,d[1]),t+d[2]*0.9);
      o.connect(g); g.connect(c.destination);
      g.gain.setValueAtTime(d[4],t); g.gain.exponentialRampToValueAtTime(0.0001,t+d[2]); o.start(t); o.stop(t+d[2]); }catch(e){} }

  return { play, callout, resume };
})();
