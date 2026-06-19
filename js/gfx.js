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

  return {
    scene, camera, renderer, yaw, pitch, dom: renderer.domElement,
    get world(){ return world; }, clearWorld,
    baseFov:78,
    render(){ renderer.render(scene,camera); },
  };
})();
