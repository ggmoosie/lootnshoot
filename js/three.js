// three.js shim — surface the global CDN build (window.THREE) to ES modules.
// three stays the classic r128 build loaded in index.html; we do NOT migrate it to ESM.
// Modules import { T } from "./three.js" (the original code's alias) or { THREE }.
export const THREE = window.THREE;
export const T = window.THREE;
