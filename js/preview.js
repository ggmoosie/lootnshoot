// preview.js — SYS: Preview. A reusable, self-contained offscreen 3D preview
// renderer that draws an arbitrary Object3D into a provided <canvas>: its own
// WebGLRenderer (alpha:true, so it sits transparently on a panel) + scene +
// perspective camera + simple lighting, with auto-fit framing, optional
// auto-rotate, an on-demand RAF loop, and full disposal. Built once here so it
// can later also power a character mannequin and an item-inspect view — keep it
// generic; it knows nothing about guns.
//
// Three stays the global CDN build; reach it through the shim like every module.
import { T } from "./three.js";

// createPreview(canvas, opts) -> handle. opts:
//   bg            : scene.background color (default null = transparent)
//   autoRotate    : start auto-rotating (default true)
//   rotateSpeed   : radians/sec yaw while auto-rotating (default 0.6)
//   fov           : camera field of view (default 42)
//   fitOffset     : multiplier on the framing distance (default 1.35; >1 = more margin)
export function createPreview(canvas, opts = {}){
  const cfg = Object.assign({
    bg: null, autoRotate: true, rotateSpeed: 0.6, fov: 42, fitOffset: 1.35,
  }, opts);

  // --- renderer: alpha so the page/panel shows through ---
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); // cap DPR at 2
  if (T.sRGBEncoding != null) renderer.outputEncoding = T.sRGBEncoding;

  // --- scene + camera ---
  const scene = new T.Scene();
  if (cfg.bg != null) scene.background = new T.Color(cfg.bg);
  const camera = new T.PerspectiveCamera(cfg.fov, 1, 0.01, 1000);
  camera.position.set(0, 0, 3);

  // --- lighting: hemi fill + key directional (mirrors the game's simple kit) ---
  const hemi = new T.HemisphereLight(0xbfd6ff, 0x202830, 0.95);
  scene.add(hemi);
  const key = new T.DirectionalLight(0xffffff, 0.95);
  key.position.set(2.5, 4, 3);
  scene.add(key);
  const rim = new T.DirectionalLight(0x6fa8dc, 0.35);
  rim.position.set(-3, 1.5, -2);
  scene.add(rim);

  // --- the model lives under a pivot we spin; framing recenters it to the origin ---
  const pivot = new T.Object3D();
  scene.add(pivot);
  let model = null;
  let autoRotate = !!cfg.autoRotate;
  let raf = 0;
  let disposed = false;
  let lastT = 0;
  let fitDist = 3;        // distance the framed camera sits back at
  let fitHeight = 0;      // vertical center of the framed model (camera looks here)

  // size the drawing buffer to the canvas's CSS box (honoring DPR via setPixelRatio)
  function syncSize(){
    const w = Math.max(1, canvas.clientWidth || canvas.width || 1);
    const h = Math.max(1, canvas.clientHeight || canvas.height || 1);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false); // false = don't touch the canvas's CSS size
  }

  // recursively free geometries/materials/textures under an object
  function disposeObject(obj){
    obj.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats){
        for (const k in m){ const v = m[k]; if (v && v.isTexture) v.dispose(); }
        if (m.dispose) m.dispose();
      }
    });
  }

  // frame the camera so the model's bounding box fits the view, recentered to origin
  function frame(){
    if (!model) return;
    const box = new T.Box3().setFromObject(model);
    if (box.isEmpty()) return;
    const size = new T.Vector3(); box.getSize(size);
    const center = new T.Vector3(); box.getCenter(center);
    // recenter the model on the pivot so it spins around its own middle
    model.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const fitW = maxDim / (2 * Math.tan((camera.fov * Math.PI / 180) / 2));
    fitHeight = 0;
    fitDist = fitW * cfg.fitOffset;
    camera.position.set(0, fitHeight, fitDist);
    camera.near = Math.max(0.01, fitDist / 100);
    camera.far = fitDist * 100;
    camera.lookAt(0, fitHeight, 0);
    camera.updateProjectionMatrix();
  }

  // ---- public API ----
  // swap in a new model: clears+frees the previous one, adds, frames the camera.
  // keepRotation: preserve the current pivot yaw/pitch across the swap (used when a
  // model is rebuilt to reflect a state change — e.g. equipping gear on the doll —
  // so it does NOT snap back to its default facing on every rebuild).
  function setModel(obj3d, keepRotation){
    if (disposed) return;
    const rx = pivot.rotation.x, ry = pivot.rotation.y;
    if (model){ pivot.remove(model); disposeObject(model); model = null; }
    if (keepRotation){ pivot.rotation.set(rx, ry, 0); } else { pivot.rotation.set(0, 0, 0); }
    model = obj3d || null;
    if (model) pivot.add(model);
    syncSize();
    frame();
  }
  function setAutoRotate(on){ autoRotate = !!on; }
  let _dragDetach = null;
  // imperatively nudge the model's facing (used by drag-to-rotate). dy tilts pitch,
  // clamped so the model can't flip fully upside-down.
  function rotateBy(dx, dy){
    pivot.rotation.y += dx;
    pivot.rotation.x = Math.max(-1.0, Math.min(1.0, pivot.rotation.x + (dy || 0)));
  }
  // Attach click-drag rotation to the canvas (the gunsmith/doll control model):
  // auto-rotate is turned OFF and the user spins the model by dragging on it. A
  // tooltip-style external hook can be passed so the caller can hide its own tip on
  // drag-start. Returns a detach fn (called automatically on dispose).
  function enableDragRotate(opts){
    opts = opts || {};
    autoRotate = false;
    let dragging = false, lx = 0, ly = 0, pid = null;
    const SENS = 0.01;
    function down(e){
      dragging = true; lx = e.clientX; ly = e.clientY; pid = e.pointerId;
      try{ canvas.setPointerCapture(pid); }catch(_){}
      canvas.style.cursor = 'grabbing';
      if (opts.onDragStart) opts.onDragStart();
      e.preventDefault(); e.stopPropagation();
    }
    function move(e){
      if (!dragging) return;
      rotateBy((e.clientX - lx) * SENS, (e.clientY - ly) * SENS);
      lx = e.clientX; ly = e.clientY;
      e.preventDefault();
    }
    function up(e){
      if (!dragging) return;
      dragging = false; canvas.style.cursor = 'grab';
      try{ if (pid != null) canvas.releasePointerCapture(pid); }catch(_){}
      pid = null;
    }
    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    const detach = () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('lostpointercapture', up);
    };
    _dragDetach = detach;
    return detach;
  }
  function resize(){ if (!disposed) syncSize(); }
  function render(){
    if (disposed) return;
    camera.lookAt(0, fitHeight, 0);
    renderer.render(scene, camera);
  }
  function tick(now){
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const t = now / 1000;
    const dt = lastT ? Math.min(0.1, t - lastT) : 0;
    lastT = t;
    if (autoRotate && model) pivot.rotation.y += cfg.rotateSpeed * dt;
    render();
  }
  function start(){
    if (disposed || raf) return;
    lastT = 0;
    syncSize();
    raf = requestAnimationFrame(tick);
  }
  function stop(){
    if (raf){ cancelAnimationFrame(raf); raf = 0; }
  }
  function dispose(){
    if (disposed) return;
    disposed = true;
    stop();
    if (_dragDetach){ _dragDetach(); _dragDetach = null; }
    if (model){ pivot.remove(model); disposeObject(model); model = null; }
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    renderer.dispose();
    if (renderer.forceContextLoss) { try { renderer.forceContextLoss(); } catch(e){} }
    // drop the WebGL canvas reference so the context can be GC'd
    if (canvas && canvas.parentNode) { /* caller owns DOM removal; we just release */ }
  }

  syncSize();
  return { setModel, setAutoRotate, rotateBy, enableDragRotate, resize, render, start, stop, dispose,
           get scene(){ return scene; }, get camera(){ return camera; } };
}
