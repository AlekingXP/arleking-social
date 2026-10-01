// Curvas, muelles y líneas de tiempo para el personaje.
//
// ---------------------------------------------------------------------------
// Las curvas (`Ease`), el muelle (`Muelle`) y la idea de la línea de tiempo
// por propiedad vienen de Coucou, de Louis Raillé, que está bajo licencia MIT:
//
//     https://github.com/Louis-CFM/coucou
//     Copyright (c) 2026 Louis Raillé — MIT
//
// Se porta el MOTOR, no el personaje: el aspecto de Mochi, sus expresiones y
// sus sonidos son suyos y no están bajo esa licencia. Lo que se usa aquí son
// las matemáticas, aplicadas a nuestro propio personaje.
// ---------------------------------------------------------------------------
//
// Por qué hacía falta. Hasta ahora el personaje se movía con `lerp` hacia un
// objetivo y con senos: vale para seguir el cursor y para flotar, pero no deja
// COREOGRAFIAR nada. Un gesto de verdad —encogerse y luego estirarse de golpe,
// echarse atrás y volver con rebote— son varios tramos seguidos, cada uno con
// su duración y su curva. Eso es lo que añade esto.

export const Ease = {
  // Sale rápido y frena: para lo que reacciona a algo.
  fuera: function (t) { return 1 - Math.pow(1 - t, 3); },
  // Arranca y termina suave: para lo que se mueve por su cuenta.
  dentroFuera: function (t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  },
  // Se pasa de largo y vuelve. Es lo que hace que algo parezca vivo.
  rebote: function (t) {
    var c1 = 1.7;
    var c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  lineal: function (t) { return t; },
  dentro: function (t) { return t * t * t; },
};

export function acotar(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Muelle amortiguado, integrado a pasos pequeños.
 *
 * Se subdivide el paso porque con un fotograma largo —una pestaña que vuelve
 * del fondo, un móvil que se atraganta— un muelle integrado de una sola vez
 * se dispara y el personaje pega un salto.
 */
export function Muelle(valor, respuesta, amortiguacion) {
  this.valor = valor;
  this.objetivo = valor;
  this.velocidad = 0;
  this.configurar(respuesta || 0.5, amortiguacion == null ? 0.72 : amortiguacion);
}
Muelle.prototype.configurar = function (respuesta, amortiguacion) {
  this.omega = (2 * Math.PI) / respuesta;
  this.zeta = amortiguacion;
};
Muelle.prototype.fijar = function (v) {
  this.valor = v;
  this.objetivo = v;
  this.velocidad = 0;
};
Muelle.prototype.quieto = function () {
  return Math.abs(this.objetivo - this.valor) < 0.001 && Math.abs(this.velocidad) < 0.005;
};
Muelle.prototype.paso = function (dt) {
  var pasos = Math.max(1, Math.ceil(dt / (1 / 240)));
  var h = dt / pasos;
  for (var i = 0; i < pasos; i++) {
    var acc = this.omega * this.omega * (this.objetivo - this.valor)
      - 2 * this.zeta * this.omega * this.velocidad;
    this.velocidad += acc * h;
    this.valor += this.velocidad * h;
  }
};

/**
 * Varias propiedades animándose a la vez, cada una por su lista de tramos.
 *
 *   t.a('oy', [[-0.3, 140, Ease.fuera], [0, 380, Ease.rebote]]);
 *
 * se lee: "sube a -0.3 en 140 ms frenando, y vuelve a 0 en 380 ms pasándote
 * un poco". Cada propiedad tiene su propia lista; lanzar una nueva sobre una
 * propiedad descarta la anterior, que es lo que se quiere cuando algo
 * interrumpe a lo que estaba pasando.
 */
export function Linea() {
  this.props = Object.create(null);
}

Linea.prototype.a = function (prop, tramos, alTerminar) {
  this.props[prop] = {
    tramos: tramos,
    i: 0,
    desde: this.v(prop),
    t: 0,
    alTerminar: alTerminar || null,
  };
};

/** Pone un valor sin animarlo y corta lo que hubiera en marcha. */
Linea.prototype.fijar = function (prop, valor) {
  this.props[prop] = { tramos: [], i: 0, desde: valor, t: 0, alTerminar: null, fijo: valor };
};

Linea.prototype.v = function (prop) {
  var p = this.props[prop];
  if (!p) return 0;
  if (p.fijo !== undefined) return p.fijo;
  var tramo = p.tramos[p.i];
  if (!tramo) return p.desde;
  var dur = tramo[1] / 1000;
  var avance = dur <= 0 ? 1 : acotar(p.t / dur, 0, 1);
  var curva = tramo[2] || Ease.dentroFuera;
  return p.desde + (tramo[0] - p.desde) * curva(avance);
};

Linea.prototype.activa = function () {
  for (var k in this.props) {
    var p = this.props[k];
    if (p.fijo === undefined && p.i < p.tramos.length) return true;
  }
  return false;
};

Linea.prototype.paso = function (dt) {
  for (var k in this.props) {
    var p = this.props[k];
    if (p.fijo !== undefined) continue;
    var tramo = p.tramos[p.i];
    if (!tramo) continue;
    p.t += dt;
    var dur = tramo[1] / 1000;
    if (p.t >= dur) {
      // El tramo terminó: su destino es el punto de partida del siguiente.
      p.desde = tramo[0];
      p.t -= dur;
      p.i++;
      if (p.i >= p.tramos.length) {
        p.t = 0;
        if (p.alTerminar) { var f = p.alTerminar; p.alTerminar = null; f(); }
      }
    }
  }
};
