// El personaje del asistente, en 3D y en vivo.
//
// El modelo no trae esqueleto ni animaciones (vino de un OBJ), así que todo
// el movimiento es procedural y se aplica al conjunto: flota, se balancea,
// gira hacia el cursor y cambia de actitud según lo que esté haciendo el
// asistente. Girar el cuerpo entero hacia donde miras se lee natural en un
// chibi, y no depende de adivinar dónde empieza la cabeza en la malla.
//
// Hay dos capas de movimiento, y se suman:
//
//   El ESTADO, continuo, que dice en qué anda:
//     reposo      flota tranquilo y te sigue con la mirada
//     escuchando  se inclina hacia ti y flota un poco más vivo
//     pensando    ladea la cabeza y mira arriba, como quien recuerda algo
//     hablando    da un pequeño bote con cada palabra
//
//   El GESTO, puntual, que reacciona a algo que acaba de pasar: saluda al
//   abrir, brinca cuando resuelve, niega cuando lo pasa a una persona, se
//   sorprende si lo pulsas y se marea si insistes. Están en gestos.js, y el
//   motor que los reproduce —curvas y líneas de tiempo— en anim.js.
//
// Un gesto NO sustituye al estado: sigues mirando al cursor mientras das el
// brinco, que es lo que hace que no parezca un vídeo pegado encima.
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
import { Linea } from './anim.js';
import { GESTOS, SIN_GIRO_EN_CALMA, FUERZA_EN_CALMA } from './gestos.js';



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
    pulso: 0,
    proximoPulsoFalso: 0,
    ultimoPulsoReal: -10,
    toques: [],               // marcas de tiempo de los toques recientes
  };

  // La coreografía en curso, separada del estado continuo: lo de arriba
  // responde a dónde está el cursor y a qué hace el asistente; esto responde
  // a cosas puntuales que acaban de pasar.
  const gesto = new Linea();
  ['oy', 'ox', 'tilt', 'giro'].forEach((p) => gesto.fijar(p, 0));
  ['sx', 'sy'].forEach((p) => gesto.fijar(p, 1));

  function emocionar(nombre) {
    const receta = GESTOS[nombre];
    if (!receta) return;
    const fuerza = calmado ? FUERZA_EN_CALMA : 1;
    Object.keys(receta).forEach((prop) => {
      if (calmado && prop === 'giro' && SIN_GIRO_EN_CALMA.includes(nombre)) return;
      // Las escalas parten de 1, el resto de 0: atenuar es acercar al reposo
      // de cada una, no multiplicar sin más.
      const reposo = (prop === 'sx' || prop === 'sy') ? 1 : 0;
      gesto.a(prop, receta[prop].map((tramo) => [
        reposo + (tramo[0] - reposo) * fuerza, tramo[1], tramo[2],
      ]));
    });
  }

  /**
   * Alguien ha pulsado al personaje.
   *
   * En Coucou picas a Mochi y se mosquea; aquí el personaje ES el botón que
   * abre el chat, así que un clic no puede ser las dos cosas. La versión
   * honesta de "insistir" en un botón que se alterna es abrirlo y cerrarlo
   * sin parar: al tercer toque en menos de dos segundos, se marea.
   */
  function alTocar(abriendo) {
    const ahora = performance.now();
    anim.toques = anim.toques.filter((t) => ahora - t < 1700);
    anim.toques.push(ahora);

    if (anim.toques.length >= 3) {
      anim.toques = [];
      emocionar('mareado');
      return;
    }
    if (abriendo) emocionar('saludo');
    else if (anim.toques.length > 1) emocionar('sorpresa');
  }

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
      || gesto.activa()
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

    // El gesto en curso se suma a todo lo anterior, no lo sustituye: sigues
    // mirando al cursor mientras das el brinco.
    gesto.paso(d);

    const pulso = anim.pulso * fuerzaPulso;
    flotador.position.y = Math.sin(t * velocidad) * amplitud - gesto.v('oy') + pulso * 0.018;
    flotador.position.x = gesto.v('ox');
    pivote.rotation.y = anim.yaw + gesto.v('giro');
    pivote.rotation.x = anim.pitch + pulso * 0.05;
    pivote.rotation.z = anim.ladeo + gesto.v('tilt');
    pivote.scale.set(gesto.v('sx'), gesto.v('sy') + pulso * 0.03, gesto.v('sx'));

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
    /** Una reacción puntual: 'saludo', 'alegre', 'niega', 'sorpresa',
     *  'molesto' o 'mareado'. Un nombre que no existe no hace nada. */
    emocionar,
    /** Lo llama el widget cada vez que se pulsa el lanzador. */
    tocar: alTocar,
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
