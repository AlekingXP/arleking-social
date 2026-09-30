// Live 3D badge preview (Three.js + GLTFLoader, loaded via CDN import map —
// no bundler on this vanilla page). This is the demo viewer only; the
// inline badge next to a profile's name stays the lightweight SVG from
// vip-badge.js so every profile page load doesn't pay for a WebGL context.
import * as THREE from 'three';
// El cargador de modelos y la sonda de rendimiento son compartidos con el
// personaje del asistente: ver three-kit.js.
import { cargarModelo, dispositivoApto } from './three-kit.js';

const MODEL_URLS = {
  billete: '/models/dollars.glb',
  king: '/models/king-crown.glb',
};

/**
 * Renders a slowly auto-rotating GLB model into `container`.
 * Resolves { dispose() } on success, or null if the caller should fall
 * back (no WebGL, device too slow, or the model failed to load).
 */
export async function renderVip3D(container, tierKey) {
  const url = MODEL_URLS[tierKey];
  if (!url) return null;

  if (!dispositivoApto()) return null;

  let modelSource;
  try {
    // cargarModelo ya trae su propio tope de tiempo: un fallo del
    // decodificador muestra el aviso, nunca deja el visor colgado.
    modelSource = await cargarModelo(url);
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
