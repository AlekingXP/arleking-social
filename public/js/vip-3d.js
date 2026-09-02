// Live 3D badge preview (Three.js + GLTFLoader, loaded via CDN import map —
// no bundler on this vanilla page). This is the demo viewer only; the
// inline badge next to a profile's name stays the lightweight SVG from
// vip-badge.js so every profile page load doesn't pay for a WebGL context.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const MODEL_URLS = {
  billete: '/models/dollars.glb',
  king: '/models/king-crown.glb',
};

// Both models were run through gltf-transform's meshopt geometry
// compression (56-58MB -> ~2MB from raw AI-generated exports) — the decoder
// must be registered before loading or GLTFLoader rejects the file.
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const modelCache = new Map();

function loadModel(url) {
  if (!modelCache.has(url)) {
    modelCache.set(
      url,
      // MeshoptDecoder wraps a WASM module that finishes initializing
      // asynchronously — using the loader before `.ready` resolves is a
      // known way to get GLTFLoader to silently hang parsing a
      // meshopt-compressed file instead of erroring.
      MeshoptDecoder.ready.then(
        () =>
          new Promise((resolve, reject) => {
            loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
          })
      )
    );
  }
  return modelCache.get(url);
}

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}

// Mide lo que cuesta a la GPU dibujar un fotograma, en milisegundos.
//
// La version anterior contaba fotogramas de requestAnimationFrame y exigia
// 30 fps. Eso mide el ritmo que CONCEDE el navegador, no lo que la GPU
// aguanta: en una pestana de fondo, en ahorro de bateria o dentro de un
// webview, rAF baja a ~1 Hz y un movil perfectamente capaz reprobaba. Ademas
// tardaba doce fotogramas -- nueve segundos a esa cadencia -- en decidirlo.
//
// Este bucle es sincrono y no toca rAF, asi que el estrangulamiento no le
// afecta. readPixels al final fuerza a esperar a la GPU: sin ese punto de
// sincronizacion se estaria midiendo lo que tarda en encolar ordenes, que en
// WebGL es casi cero y siempre pareceria rapidisimo.
const FRAME_BUDGET_MS = 33; // 30 fps, el listado del planteamiento original
const PROBE_FRAMES = 20;

function probeFrameCostMs() {
  if (!supportsWebGL()) return Infinity;

  let renderer;
  try {
    // Los entornos con render por software tienen limites bajos de contextos
    // WebGL simultaneos; que falle al crearlo cuenta como "no apto", no como
    // excepcion que rompa al que llama.
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  } catch {
    return Infinity;
  }

  try {
    renderer.setSize(64, 64);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
    camera.position.z = 3;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    scene.add(mesh);
    scene.add(new THREE.DirectionalLight(0xffffff, 1));

    const gl = renderer.getContext();
    // Un fotograma de calentamiento: el primero paga la compilacion de
    // shaders y la subida de buffers, que no se repiten despues.
    renderer.render(scene, camera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

    const start = performance.now();
    for (let i = 0; i < PROBE_FRAMES; i++) {
      mesh.rotation.y += 0.1;
      renderer.render(scene, camera);
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return (performance.now() - start) / PROBE_FRAMES;
  } catch {
    return Infinity;
  } finally {
    renderer.dispose();
    renderer.forceContextLoss(); // libera el contexto ya, sin esperar al GC
  }
}

/**
 * Renders a slowly auto-rotating GLB model into `container`.
 * Resolves { dispose() } on success, or null if the caller should fall
 * back (no WebGL, device too slow, or the model failed to load).
 */
export async function renderVip3D(container, tierKey) {
  const url = MODEL_URLS[tierKey];
  if (!url) return null;

  const frameCostMs = probeFrameCostMs();
  if (frameCostMs > FRAME_BUDGET_MS) return null;

  let modelSource;
  try {
    // Belt-and-suspenders timeout: loader/decoder issues should show the
    // fallback hint, never hang the viewer forever.
    modelSource = await Promise.race([
      loadModel(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
    ]);
  } catch (err) {
    console.error('No se pudo cargar el modelo 3D:', err);
    return null;
  }

  const width = container.clientWidth || 160;
  const height = container.clientHeight || 160;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (err) {
    console.error('No se pudo crear el contexto WebGL:', err);
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.innerHTML = '';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);

  const model = modelSource.clone(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  model.position.sub(center);

  const wrapper = new THREE.Group();
  wrapper.add(model);
  scene.add(wrapper);

  camera.position.set(0, maxDim * 0.15, maxDim * 2.6);
  camera.lookAt(0, 0, 0);

  // Warm gold-friendly lighting: ambient fill + a bright key light + a cool
  // rim light for that "catches the light" gleam on gold materials.
  scene.add(new THREE.AmbientLight(0xfff2d0, 0.65));
  const key = new THREE.DirectionalLight(0xffe6a8, 2.2);
  key.position.set(2, 3, 2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xfff6dd, 1.1);
  rim.position.set(-2, 1, -2);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.4);
  fill.position.set(0, -1, 2);
  scene.add(fill);

  let rafId = 0;
  let disposed = false;
  function tick() {
    if (disposed) return;
    wrapper.rotation.y += 0.008;
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  }
  tick();

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(rafId);
      renderer.dispose();
      renderer.forceContextLoss(); // free the WebGL context now, not whenever GC gets to it
    },
  };
}

window.renderVip3D = renderVip3D;
// vip-3d.js is a module, so it can't guarantee it finishes loading (fetching
// three.module.js + GLTFLoader.js from the CDN) before classic scripts like
// admin.js run their init code — they should check `window.renderVip3D`
// first and, if it's not there yet, wait for this event instead of assuming
// a race that may or may not have resolved in their favor.
window.dispatchEvent(new CustomEvent('vip3d-ready'));
