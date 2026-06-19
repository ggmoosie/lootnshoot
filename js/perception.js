// perception.js — SYS: Perception. Noise bus for stealth. Actions emit noise of a
// radius; the Enemies 'alert' handler turns nearby noise into investigation.
// Suppressors + crouch shrink the radius. This is the spine of stealth play.
import { DATA } from "./data.js";
import { S, MODE, Events } from "./state.js";

export const Perception = (function(){
  function noise(pos, radius){ if(S.mode!==MODE.RAID) return; Events.emit('alert',{ pos: pos.clone?pos.clone():pos, radius }); }
  function shot(pos, suppressed){ noise(pos, suppressed?DATA.noise.shotSuppressed:DATA.noise.shot); }
  function footstep(pos, sprint, crouch){ noise(pos, crouch?DATA.noise.crouchStep:(sprint?DATA.noise.sprint:DATA.noise.step)); }
  return { noise, shot, footstep };
})();
