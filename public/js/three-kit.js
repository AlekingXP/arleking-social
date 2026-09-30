// Piezas 3D compartidas: cargar modelos, saber si hay WebGL y medir si el
// dispositivo aguanta.
//
// Las usan el visor de la insignia VIP (vip-3d.js) y el personaje del
// asistente (asistente/personaje.js). Vivían dentro del visor; se sacaron
// aquí para no tener dos cargadores y dos sondas haciendo lo mismo en la
// misma página — y en el panel conviven los dos.

import { WebGLRenderer, Scene, PerspectiveCamera, Mesh, BoxGeometry, MeshStandardMaterial, DirectionalLight } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Los modelos pasaron por la compresión meshopt de gltf-transform; el
// decodificador tiene que estar registrado antes de cargar o GLTFLoader los
// rechaza.
const cargador = new GLTFLoader();
cargador.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();

/**
 * Carga un GLB y devuelve su escena. La misma URL se descarga una sola vez
 * aunque la pidan dos visores; un fallo no se queda en caché, para que el
 * siguiente intento pueda salir bien.
 */
export function cargarModelo(url, { tiempoMaximo = 15000 } = {}) {
  if (!cache.has(url)) {
    // MeshoptDecoder envuelve un módulo WASM que termina de iniciarse de
    // forma asíncrona; usar el cargador antes de `.ready` hace que GLTFLoader
    // se quede colgado en silencio con los archivos comprimidos.
    const promesa = MeshoptDecoder.ready.then(
      () => new Promise((resolver, rechazar) => {
        cargador.load(url, (gltf) => resolver(gltf.scene), undefined, rechazar);
      })
    );
    promesa.catch(() => cache.delete(url));
    cache.set(url, promesa);
  }
  // Tope de tiempo: un problema del decodificador debe acabar en la versión
  // plana, nunca en un visor esperando para siempre.
  return Promise.race([
    cache.get(url),
    new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('tiempo agotado')), tiempoMaximo)),
  ]);
}

export function soportaWebGL() {
  try {
    const lienzo = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (lienzo.getContext('webgl') || lienzo.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}

// Mide lo que cuesta a la GPU dibujar un fotograma, en milisegundos.
//
// No cuenta fotogramas de requestAnimationFrame: eso mide el ritmo que
// CONCEDE el navegador, no lo que la GPU aguanta, y en una pestaña de fondo
// o en ahorro de batería rAF baja a ~1 Hz y un móvil capaz reprobaba. Este
// bucle es síncrono y no toca rAF; readPixels al final obliga a esperar a la
// GPU (sin ese punto de sincronización se mediría lo que tarda en encolar
// órdenes, que en WebGL es casi cero).
export const PRESUPUESTO_FOTOGRAMA_MS = 33; // 30 fps
const FOTOGRAMAS_SONDA = 20;

function medir() {
  if (!soportaWebGL()) return Infinity;

  let renderer;
  try {
    // Con render por software hay pocos contextos simultáneos; que falle al
    // crearlo cuenta como "no apto", no como excepción.
    renderer = new WebGLRenderer({ antialias: false, alpha: true });
  } catch {
    return Infinity;
  }

  try {
    renderer.setSize(64, 64);
    const escena = new Scene();
    const camara = new PerspectiveCamera(50, 1, 0.1, 10);
    camara.position.z = 3;
    const malla = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    escena.add(malla);
    escena.add(new DirectionalLight(0xffffff, 1));

    const gl = renderer.getContext();
    // Calentamiento: el primer fotograma paga la compilación de shaders.
    renderer.render(escena, camara);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

    const inicio = performance.now();
    for (let i = 0; i < FOTOGRAMAS_SONDA; i++) {
      malla.rotation.y += 0.1;
      renderer.render(escena, camara);
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return (performance.now() - inicio) / FOTOGRAMAS_SONDA;
  } catch {
    return Infinity;
  } finally {
    renderer.dispose();
    renderer.forceContextLoss(); // libera el contexto ya, sin esperar al GC
  }
}

// Una sola medición por página: cada una abre un contexto WebGL, y con el
// visor VIP y el personaje en el mismo panel se medía dos veces lo mismo.
let costeMedido = null;
export function costeFotogramaMs() {
  if (costeMedido === null) costeMedido = medir();
  return costeMedido;
}

export function dispositivoApto() {
  return costeFotogramaMs() <= PRESUPUESTO_FOTOGRAMA_MS;
}
