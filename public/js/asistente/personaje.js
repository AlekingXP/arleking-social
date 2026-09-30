// El personaje del asistente, en 3D y en vivo.
//
// El modelo no trae esqueleto ni animaciones (vino de un OBJ), así que todo
// el movimiento es procedural y se aplica al conjunto: flota, se balancea,
// gira hacia el cursor y cambia de actitud según lo que esté haciendo el
// asistente. Girar el cuerpo entero hacia donde miras se lee natural en un
// chibi, y no depende de adivinar dónde empieza la cabeza en la malla.
//
// Estados:
//   reposo      flota tranquilo y te sigue con la mirada
//   escuchando  se inclina hacia ti y flota un poco más vivo
//   pensando    ladea la cabeza y mira arriba, como quien recuerda algo
//   hablando    da un pequeño bote con cada palabra
//
// Coste: una malla de 40.000 triángulos en un lienzo de ~120 px, a 30 fps
// cuando está quieto y a ritmo de pantalla cuando pasa algo. Se para del
// todo con la pestaña oculta.
//
// Modo tranquilo (`calmado`), para quien pide menos movimiento al sistema:
// no flota, no bota ni gira sobre sí mismo, y sigue el cursor despacio.
// Seguir el cursor es movimiento que provoca la propia persona; lo que esa
// preferencia pide evitar es el que ocurre solo.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { cargarModelo, dispositivoApto } from '../three-kit.js';

const MODELO = '/models/asistente.glb';
const ALTURA_MODELO = 0.98; // medida al preparar el GLB (pies en y=0)

const LIMITES = { yawMin: -0.75, yawMax: 0.55, pitchMin: -0.38, pitchMax: 0.18 };
const QUIETO_TRAS_MS = 4000;

const lerp = (a, b, t) => a + (b - a) * t;
const acotar = (v, min, max) => Math.min(max, Math.max(min, v));

function colorDeAcento() {
  const valor = getComputedStyle(document.documentElement).getPropertyValue('--accent-from').trim();
  try {
    return new THREE.Color(valor || '#ff5f8f');
  } catch {
    return new THREE.Color('#ff5f8f');
  }
}

/**
 * Monta el personaje dentro de `contenedor`. Devuelve null si el dispositivo
 * no lo aguanta o el modelo no carga: quien llama se queda con la imagen fija.
 */
export async function montarPersonaje(contenedor, { alPerderse, calmado = false } = {}) {
  if (!dispositivoApto()) return null;

  let base;
  try {
    base = await cargarModelo(MODELO);
  } catch (err) {
    console.warn('No se pudo cargar el personaje:', err.message);
    return null;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return null;
  }

  const ancho = contenedor.clientWidth || 120;
  const alto = contenedor.clientHeight || 150;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(ancho, alto);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const lienzo = renderer.domElement;
  lienzo.className = 'sup-lienzo';
  lienzo.setAttribute('aria-hidden', 'true');

  const escena = new THREE.Scene();
  // Un entorno que reflejar: sin él los materiales PBR se ven planos.
  const pmrem = new THREE.PMREMGenerator(renderer);
  escena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const clave = new THREE.DirectionalLight(0xffffff, 1.25);
  clave.position.set(-1.2, 2.2, 2.4);
  // Luz de contorno con el color de la página: el personaje "pertenece" al
  // panel de cada persona sin tocar el modelo.
  const contorno = new THREE.DirectionalLight(colorDeAcento(), 1.8);
  contorno.position.set(1.6, 1.3, -2.2);
  escena.add(clave, contorno);

  // Jerarquía: flotador (sube y baja) > pivote (gira y se ladea) > modelo.
  // El pivote queda en el centro del cuerpo para que los giros no lo
  // desplacen de sitio.
  const modelo = base.clone(true);
  modelo.position.y = -ALTURA_MODELO / 2;
  const pivote = new THREE.Group();
  pivote.add(modelo);
  const flotador = new THREE.Group();
  flotador.add(pivote);
  escena.add(flotador);

  const camara = new THREE.PerspectiveCamera(26, ancho / alto, 0.1, 20);
  camara.position.set(0, 0.04, 2.75);
  camara.lookAt(0, 0.02, 0);

  // ---- Estado de la animación ----
  // Arranca en la misma pose que la imagen fija (renderizada con
  // yaw -0.32 y pitch -0.1), para que el relevo entre ambas no se note.
  const anim = {
    modo: 'reposo',
    yaw: -0.32, pitch: -0.1, ladeo: 0.02,
    objetivoYaw: -0.35, objetivoPitch: -0.12,
    ultimoPuntero: 0,
    miradaFija: null,         // { x, y } en coordenadas de página, o null
    saltoDesde: -10,
    giroDesde: -10,
    pulso: 0,
    proximoPulsoFalso: 0,
    ultimoPulsoReal: -10,
  };

  function objetivoDesde(x, y) {
    const r = contenedor.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height * 0.3; // la cabeza está arriba
    const dx = x - cx;
    const dy = y - cy;
    const distancia = 520; // px a los que el giro se satura
    anim.objetivoYaw = acotar(Math.atan2(dx, distancia), LIMITES.yawMin, LIMITES.yawMax);
    anim.objetivoPitch = acotar(Math.atan2(dy, distancia) * 0.8, LIMITES.pitchMin, LIMITES.pitchMax);
  }

  function alMoverPuntero(e) {
    anim.ultimoPuntero = performance.now();
    if (anim.miradaFija) return;
    objetivoDesde(e.clientX, e.clientY);
  }
  window.addEventListener('pointermove', alMoverPuntero, { passive: true });
  window.addEventListener('pointerdown', alMoverPuntero, { passive: true });

  // ---- Bucle ----
  // Timer y no Clock: Clock está obsoleto en esta versión de Three.js.
  const reloj = new THREE.Timer();
  let acumulado = 0;
  let destruido = false;

  function activo() {
    const ahora = performance.now();
    return anim.modo !== 'reposo'
      || ahora - anim.ultimoPuntero < 1500
      || (reloj.getElapsed() - anim.saltoDesde) < 1.2
      || (reloj.getElapsed() - anim.giroDesde) < 1.2
      || anim.pulso > 0.01;
  }

  function paso(marca) {
    reloj.update(marca);
    const dt = Math.min(reloj.getDelta(), 0.1);
    const t = reloj.getElapsed();

    // En reposo y sin nada que mirar, 30 fps bastan y gastan la mitad.
    acumulado += dt;
    if (!activo() && acumulado < 1 / 30) return;
    const d = acumulado;
    acumulado = 0;

    const ahora = performance.now();
    const quieto = !anim.miradaFija && ahora - anim.ultimoPuntero > QUIETO_TRAS_MS;

    // Hacia dónde mira según el estado.
    let yawDeseado = anim.objetivoYaw;
    let pitchDeseado = anim.objetivoPitch;
    let ladeoDeseado = Math.sin(t * 0.9) * 0.035;
    let amplitud = 0.026;
    let velocidad = 1.7;

    if (anim.modo === 'pensando') {
      yawDeseado = -0.28 + Math.sin(t * 0.7) * 0.05;
      pitchDeseado = -0.3;
      ladeoDeseado = 0.14;
      amplitud = 0.018;
      velocidad = 1.1;
    } else if (anim.modo === 'escuchando') {
      pitchDeseado = Math.max(pitchDeseado, 0.05) + Math.sin(t * 3.1) * 0.03;
      ladeoDeseado = Math.sin(t * 1.6) * 0.06;
      amplitud = 0.034;
      velocidad = 2.3;
    } else if (quieto && !calmado) {
      // Sin cursor que seguir, echa vistazos por la página.
      yawDeseado = -0.3 + Math.sin(t * 0.33) * 0.28;
      pitchDeseado = -0.1 + Math.sin(t * 0.21) * 0.06;
    }

    if (calmado) {
      amplitud = 0;
      ladeoDeseado = anim.modo === 'pensando' ? 0.08 : 0;
    }

    const suave = Math.min(1, d * (calmado ? 2 : 5));
    anim.yaw = lerp(anim.yaw, yawDeseado, suave);
    anim.pitch = lerp(anim.pitch, pitchDeseado, suave);
    anim.ladeo = lerp(anim.ladeo, ladeoDeseado, Math.min(1, d * 3));

    // Hablando: un bote por palabra. Si la voz no avisa de las palabras
    // (hay navegadores y voces que no lo hacen), se simulan.
    if (anim.modo === 'hablando' && t - anim.ultimoPulsoReal > 0.6 && t > anim.proximoPulsoFalso) {
      anim.pulso = 1;
      anim.proximoPulsoFalso = t + 0.16 + Math.random() * 0.14;
    }
    anim.pulso *= Math.exp(-d * 9);
    // En modo tranquilo, hablar apenas se nota: un leve asentimiento.
    const fuerzaPulso = calmado ? 0.3 : 1;

    // Saludo: bote y media vuelta (nada de eso en modo tranquilo).
    const s = calmado ? 99 : t - anim.saltoDesde;
    const bote = s < 0.55 ? Math.sin((s / 0.55) * Math.PI) * 0.13 : 0;
    const aplaste = s >= 0.55 && s < 0.8 ? Math.sin(((s - 0.55) / 0.25) * Math.PI) * 0.06 : 0;
    const g = calmado ? 99 : t - anim.giroDesde;
    const giro = g < 0.9 ? Math.sin((g / 0.9) * Math.PI * 2) * 0.5 * (1 - g / 0.9) : 0;

    const pulso = anim.pulso * fuerzaPulso;
    flotador.position.y = Math.sin(t * velocidad) * amplitud + bote + pulso * 0.018;
    pivote.rotation.y = anim.yaw + giro;
    pivote.rotation.x = anim.pitch + pulso * 0.05;
    pivote.rotation.z = anim.ladeo;
    const estira = 1 + pulso * 0.03 - aplaste;
    pivote.scale.set(1 + aplaste * 0.6, estira, 1 + aplaste * 0.6);

    renderer.render(escena, camara);
  }

  function arrancar() {
    if (destruido) return;
    reloj.reset(); // que la pausa no cuente como un salto de tiempo
    renderer.setAnimationLoop(paso);
  }
  function parar() {
    renderer.setAnimationLoop(null);
  }
  function alCambiarVisibilidad() {
    if (document.hidden) parar();
    else arrancar();
  }
  document.addEventListener('visibilitychange', alCambiarVisibilidad);

  lienzo.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    parar();
    if (typeof alPerderse === 'function') alPerderse();
  });

  const observador = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
      const w = contenedor.clientWidth;
      const h = contenedor.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camara.aspect = w / h;
      camara.updateProjectionMatrix();
    })
    : null;
  if (observador) observador.observe(contenedor);

  // Un primer fotograma ya, fuera del bucle: quien llama oculta la imagen
  // fija en cuanto esto resuelve, y el lienzo no puede estar vacío en ese
  // momento. requestAnimationFrame puede tardar —o no llegar, con la
  // pestaña en segundo plano— y dejaría un hueco en la esquina.
  pivote.rotation.set(anim.pitch, anim.yaw, anim.ladeo);
  renderer.render(escena, camara);

  contenedor.appendChild(lienzo);
  if (!document.hidden) arrancar();

  return {
    lienzo,
    estado(modo) {
      anim.modo = ['reposo', 'escuchando', 'pensando', 'hablando'].includes(modo) ? modo : 'reposo';
    },
    /** Un bote de "palabra": lo llama la voz en cada límite de palabra. */
    pulso() {
      anim.pulso = 1;
      anim.ultimoPulsoReal = reloj.getElapsed();
    },
    saltar() {
      anim.saltoDesde = reloj.getElapsed();
    },
    girar() {
      anim.giroDesde = reloj.getElapsed();
    },
    /** Mira a un punto de la página (una guía); null para volver al cursor. */
    mirarA(x, y) {
      if (x == null) {
        anim.miradaFija = null;
        return;
      }
      anim.miradaFija = { x, y };
      objetivoDesde(x, y);
    },
    actualizarAcento() {
      contorno.color.copy(colorDeAcento());
    },
    destruir() {
      destruido = true;
      parar();
      window.removeEventListener('pointermove', alMoverPuntero);
      window.removeEventListener('pointerdown', alMoverPuntero);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
      reloj.dispose();
      if (observador) observador.disconnect();
      escena.environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      lienzo.remove();
    },
  };
}
