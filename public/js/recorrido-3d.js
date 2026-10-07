// La pieza del recorrido: un cristal que se abre al bajar.
//
// Procedural, no descargada. Los modelos que ya hay en /models pesan dos
// megas cada uno y están bien para el panel —donde quien mira ya tiene
// cuenta y ha pedido verlos— pero no para la página pública, que es la que
// cargan los visitantes y la que tiene que abrirse rápido. Un icosaedro con
// una subdivisión son cuarenta y dos vértices generados en el sitio: cero
// bytes de descarga.
//
// Sólo materiales sin iluminación —líneas y puntos—, así que no hay luces
// que calcular ni sombras que proyectar. Todo el coste está en mover
// doscientas cuarenta posiciones por fotograma, que es nada.
//
// Este módulo se trae con import() dinámico y sólo cuando la sección está a
// punto de entrar en pantalla: Three.js son unos cientos de kilobytes y la
// mayoría de quien abre una página de enlaces no baja hasta aquí.
import * as THREE from 'three';

function aColor(hex, porDefecto) {
  try {
    return new THREE.Color(hex || porDefecto);
  } catch {
    return new THREE.Color(porDefecto);
  }
}

/**
 * Monta la escena en `lienzo`.
 *
 * Devuelve { avance(p), parar() }. `p` va de 0 a 1 según lo recorrida que
 * esté la sección, y es lo único que conecta el scroll con la escena: el
 * giro va por su cuenta, con el reloj, para que la pieza siga viva aunque
 * nadie mueva la rueda.
 */
export function montarCristal(lienzo, opciones) {
  const op = opciones || {};
  const desde = aColor(op.desde, '#ff5f8f');
  const hasta = aColor(op.hasta, '#ff9a5a');

  let render;
  try {
    render = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true });
  } catch {
    return null;   // sin WebGL: quien llama enseña el respaldo
  }
  // Tope de 1.5: por encima de eso son más píxeles de los que distingue
  // nadie en una pieza de alambre, y en un móvil de 3x se nota en la
  // batería mucho antes que en la pantalla.
  render.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camara.position.z = 3.4;

  const grupo = new THREE.Group();
  escena.add(grupo);

  // El cristal. Detalle 1 y no más: con 2 son ciento sesenta caras y la
  // malla deja de leerse como un sólido para parecer una bola de lana.
  const solido = new THREE.IcosahedronGeometry(1, 1);
  const alambre = new THREE.WireframeGeometry(solido);
  const base = Float32Array.from(alambre.attributes.position.array);
  const total = base.length / 3;

  // Cuánto se aleja cada vértice al abrirse. Fijo por vértice y no al azar
  // en cada fotograma: así la pieza se abre siempre igual, como un objeto,
  // y no tiembla como una interferencia.
  const empuje = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    // Determinista a partir de la posición, no de Math.random: dos cargas
    // de la misma página tienen que dar el mismo cristal.
    const x = base[i * 3];
    const y = base[i * 3 + 1];
    const z = base[i * 3 + 2];
    empuje[i] = 0.35 + (Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453) % 1) * 0.9;
  }

  // Color por vértice, de un acento al otro según la altura: un degradado
  // de verdad sobre la pieza, en vez de un color plano.
  const colores = new Float32Array(total * 3);
  for (let i = 0; i < total; i++) {
    const t = (base[i * 3 + 1] + 1) / 2;
    const c = desde.clone().lerp(hasta, t);
    colores[i * 3] = c.r;
    colores[i * 3 + 1] = c.g;
    colores[i * 3 + 2] = c.b;
  }

  const geoLineas = new THREE.BufferGeometry();
  geoLineas.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(base), 3));
  geoLineas.setAttribute('color', new THREE.BufferAttribute(colores, 3));
  const lineas = new THREE.LineSegments(
    geoLineas,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 })
  );
  grupo.add(lineas);

  // Los vértices, como puntos. Duplicados respecto a las líneas, pero son
  // cuarenta y dos posiciones: sale más barato repetirlas que deduplicarlas.
  const geoPuntos = new THREE.BufferGeometry();
  geoPuntos.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(base), 3));
  geoPuntos.setAttribute('color', new THREE.BufferAttribute(colores, 3));
  const puntos = new THREE.Points(
    geoPuntos,
    new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, opacity: 0.9 })
  );
  grupo.add(puntos);

  const posLineas = geoLineas.attributes.position;
  const posPuntos = geoPuntos.attributes.position;

  let avanceDestino = 0;
  let avanceSuave = 0;
  let rafId = null;
  let vivo = false;
  let ancho = 0;
  let alto = 0;
  const t0 = performance.now();

  const quieto = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function medir() {
    const caja = lienzo.getBoundingClientRect();
    const w = Math.max(1, Math.round(caja.width));
    const h = Math.max(1, Math.round(caja.height));
    if (w === ancho && h === alto) return;
    ancho = w;
    alto = h;
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
    render.setSize(w, h, false);
  }

  function pintar(ahora) {
    const t = (ahora - t0) / 1000;

    // El scroll se persigue, no se obedece. Enganchar la apertura
    // directamente al scroll da saltos en cuanto la rueda va a tirones o el
    // móvil rebota al final de la página; perseguirlo con un muelle flojo
    // convierte eso en un movimiento continuo.
    avanceSuave += (avanceDestino - avanceSuave) * 0.08;

    const apertura = avanceSuave * 0.55;
    const a = posLineas.array;
    const b = posPuntos.array;
    for (let i = 0; i < total; i++) {
      // Cada vértice se aleja del centro por su propia dirección, que es su
      // propia posición normalizada: el cristal se abre, no se infla.
      const k = 1 + apertura * empuje[i];
      const o = i * 3;
      a[o] = b[o] = base[o] * k;
      a[o + 1] = b[o + 1] = base[o + 1] * k;
      a[o + 2] = b[o + 2] = base[o + 2] * k;
    }
    posLineas.needsUpdate = true;
    posPuntos.needsUpdate = true;

    // Giro por reloj, no por scroll: la pieza sigue viva cuando se deja de
    // bajar, que es justo cuando alguien se para a mirarla.
    grupo.rotation.y = t * 0.22 + avanceSuave * 0.9;
    grupo.rotation.x = Math.sin(t * 0.17) * 0.22;
    // Respiración: la escala late despacio. Es el detalle que separa una
    // pieza montada de una pieza quieta en medio de la pantalla.
    const late = 1 + Math.sin(t * 0.6) * 0.015;
    grupo.scale.setScalar(late);

    // Los puntos se encienden al abrirse y las líneas se apagan: lo que
    // empieza siendo un sólido acaba siendo una constelación.
    puntos.material.opacity = 0.55 + avanceSuave * 0.4;
    lineas.material.opacity = 0.85 - avanceSuave * 0.45;

    render.render(escena, camara);
  }

  function bucle(ahora) {
    rafId = requestAnimationFrame(bucle);
    medir();
    pintar(ahora);
  }

  function arrancar() {
    if (vivo) return;
    vivo = true;
    if (quieto) { medir(); pintar(performance.now()); return; }
    rafId = requestAnimationFrame(bucle);
  }

  function detener() {
    vivo = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  medir();
  pintar(performance.now());

  return {
    avance(p) { avanceDestino = Math.max(0, Math.min(1, p)); },
    visible(si) { if (si) arrancar(); else detener(); },
    parar() {
      detener();
      geoLineas.dispose();
      geoPuntos.dispose();
      solido.dispose();
      alambre.dispose();
      lineas.material.dispose();
      puntos.material.dispose();
      render.dispose();
      // Sin esto el contexto WebGL se queda ocupado hasta que pase el
      // recolector, y los navegadores sólo dan unos pocos por pestaña.
      if (render.forceContextLoss) render.forceContextLoss();
    },
  };
}
