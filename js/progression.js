// progression.js — SYS: Progression. XP/level/skill points + skill effects.
// Derived stats are computed here and read by Player/Weapons so tuning stays in
// one place.
import { DATA } from "./data.js";
import { S, Events } from "./state.js";
import { Save } from "./save.js";
import { UI } from "./ui.js";

export const Progression = (function(){
  function xpForLevel(l){ return 100 + (l-1)*80; }
  function addXP(n){
    const p=S.profile; p.xp+=n;
    while(p.xp >= xpForLevel(p.level)){ p.xp-=xpForLevel(p.level); p.level++; p.skillPoints++; UI.toast(`Level ${p.level} — +1 skill point`,'rare'); }
    Events.emit('progress:changed');
  }
  function spend(skill){
    const p=S.profile; const d=DATA.skills[skill];
    if(!d || p.skillPoints<=0 || p.skills[skill]>=d.max) return false;
    p.skillPoints--; p.skills[skill]++;
    recompute(); Events.emit('progress:changed'); Save.save(); return true;
  }
  // derived stats
  function maxHealth(){ return 100 + S.profile.skills.vitality*15; }
  function maxStamina(){ return 100 * (1 + S.profile.skills.athletics*0.10); }
  function moveMult(){ return 1 + S.profile.skills.athletics*0.10; }
  function damageMult(){ return 1 + S.profile.skills.marksman*0.06; }
  function reloadMult(){ return 1 - S.profile.skills.engineer*0.15; }
  function recompute(){
    S.player.maxHealth=maxHealth(); S.player.maxStamina=maxStamina();
    if(S.player.health>S.player.maxHealth) S.player.health=S.player.maxHealth;
  }
  Events.on('enemy:killed', e=> addXP(20 + (e&&e.tier?e.tier*10:0)));
  return { addXP, spend, recompute, maxHealth, maxStamina, moveMult, damageMult, reloadMult };
})();
