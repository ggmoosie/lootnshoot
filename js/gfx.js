// gfx.js — ENGINE.GFX: three.js renderer/scene/camera/rig. Runs at import time
// (creates the WebGL renderer and appends it to #app), so #app must exist before
// this module loads — index.html declares it above the module script. VISUALS ARE
// PLACEHOLDER (boxes); everything else is built to not care what meshes look like.
import { T } from "./three.js";

export const GFX = (function(){
  const scene = new T.Scene();
  scene.background = new T.Color(0x0a0c0e);
  scene.fog = new T.Fog(0x141a20, 55, 165);
  const camera = new T.PerspectiveCamera(78, innerWidth/innerHeight, 0.05, 600);
  const renderer = new T.WebGLRenderer({ antialias:true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.outputEncoding = T.sRGBEncoding;
  document.getElementById('app').appendChild(renderer.domElement);

  const yaw = new T.Object3D(), pitch = new T.Object3D();
  yaw.add(pitch); pitch.add(camera); scene.add(yaw);
  yaw.position.set(0,1.7,0);

  let world = new T.Group(); scene.add(world);
  function clearWorld(){ scene.remove(world); world = new T.Group(); scene.add(world); }

  addEventListener('resize',()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); });

  // ---- CAMERA FEEL: headbob + impulse shake (feat/weapon-camera-feel) ----------
  // A tiny per-frame additive offset layered onto the camera's LOCAL transform at
  // RENDER time, then immediately restored — so it never accumulates into the rig
  // and never fights weapons.js / player.js which own camera.position directly.
  //   bob  : a smooth positional sway driven by walk/run (weapons.js feeds it).
  //   shake: a decaying impulse (rotational jitter) kicked by shots/hits/booms.
  // Both honor prefers-reduced-motion (motionScale → 0) and the per-feature
  // settings toggles (Input.applySettings pushes the live flags in here). Numbers
  // are deliberately SUBTLE; shake() callers pass a 0..1-ish intensity.
  const bob = { x:0, y:0 };                 // current bob offset (set by weapons.js)
  let shakeAmt=0, shakeT=0;                  // decaying shake magnitude + phase clock
  let bobOn=true, shakeOn=true;             // settings toggles (live)
  // reduced-motion: 1 = full, 0 = off. Live-tracks the OS setting + a hard kill if
  // both toggles are off. Re-evaluated when settings change.
  let reduceMotion = false;
  try{ const mq=window.matchMedia('(prefers-reduced-motion: reduce)');
       reduceMotion=mq.matches; mq.addEventListener&&mq.addEventListener('change',e=>reduceMotion=e.matches); }catch(e){}
  function setFeel(opts){ if(!opts) return; if(opts.headbob!=null) bobOn=!!opts.headbob; if(opts.camShake!=null) shakeOn=!!opts.camShake; }
  function setBob(x,y){ bob.x=x; bob.y=y; }
  // kick a shake. `amt` ~0.1 (light hit) .. ~1 (explosion). Takes the max so a big
  // boom isn't swallowed by a stale small kick; capped so it can never get nauseating.
  function shake(amt){ if(reduceMotion) return; shakeAmt=Math.min(0.9, Math.max(shakeAmt, amt||0)); }
  function tickShake(dt){ if(shakeAmt>0.0001){ shakeT+=dt; shakeAmt=Math.max(0, shakeAmt - dt*3.2); } }

  return {
    scene, camera, renderer, yaw, pitch, dom: renderer.domElement,
    get world(){ return world; }, clearWorld,
    baseFov:78,
    shake, setBob, setFeel, tickShake, get reduceMotion(){ return reduceMotion; },
    render(){
      // compose bob + shake as a temporary additive offset on the camera's local
      // transform, render, then restore — keeps the rig math (weapons/player) clean.
      const px=camera.position.x, py=camera.position.y, rz=camera.rotation.z, rx=camera.rotation.x;
      const bm = (bobOn && !reduceMotion) ? 1 : 0;
      camera.position.x += bob.x*bm; camera.position.y += bob.y*bm;
      if(shakeOn && shakeAmt>0.0001){
        const a=shakeAmt;
        camera.rotation.z += Math.sin(shakeT*61)*0.018*a;
        camera.rotation.x += Math.sin(shakeT*47)*0.016*a;
        camera.position.x += Math.sin(shakeT*53)*0.012*a;
      }
      renderer.render(scene,camera);
      camera.position.x=px; camera.position.y=py; camera.rotation.z=rz; camera.rotation.x=rx;
    },
  };
})();
