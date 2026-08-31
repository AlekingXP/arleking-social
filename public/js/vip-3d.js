// Live 3D badge preview (Three.js + GLTFLoader, loaded via CDN import map —
// no bundler on this vanilla page). This is the demo viewer only; the
// inline badge next to a profile's name stays the lightweight SVG from
// vip-badge.js so every profile page load doesn't pay for a WebGL context.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const MODEL_URLS = {
  king: '/models/king-crown.glb',
};

// king-crown.glb was run through gltf-transform's meshopt geometry
// compression (56MB -> 2.2MB from a raw AI-generated export) — the decoder
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

// Renders a trivial scene for a few frames and measures the achieved FPS —
// the same 30fps gate the original spec calls for before trusting a device
// with the "real" 3D tier instead of a flatter fallback.
function probeFps() {
  return new Promise((resolve) => {
    if (!supportsWebGL()) return resolve(0);

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.setSize(64, 64);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
    camera.position.z = 3;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    scene.add(mesh);
    scene.add(new THREE.DirectionalLight(0xffffff, 1));

    const SAMPLE_FRAMES = 12;
    let frame = 0;
    const start = performance.now();

    function tick() {
      mesh.rotation.y += 0.1;
      renderer.render(scene, camera);
      frame++;
      if (frame >= SAMPLE_FRAMES) {
        const fps = (SAMPLE_FRAMES / (performance.now() - start)) * 1000;
        renderer.dispose();
        resolve(fps);
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

/**
 * Renders a slowly auto-rotating GLB model into `container`.
 * Resolves { dispose() } on success, or null if the caller should fall
 * back (no WebGL, device too slow, or the model failed to load).
 */
export async function renderVip3D(container, tierKey) {
  const url = MODEL_URLS[tierKey];
  if (!url) return null;

  const fps = await probeFps();
  if (fps < 30) return null;

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

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
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
