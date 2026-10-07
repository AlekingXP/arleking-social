/* Fondos generativos.
 *
 * Nueve fondos que no son imágenes: son algoritmos. Pesan unos kilobytes de
 * código en vez de megabytes de JPEG, se ven nítidos en cualquier pantalla
 * —no hay píxeles que estirar— y se mueven, que es justo lo que no puede
 * hacer una foto.
 *
 * Todos están escritos para ir DETRÁS de algo que hay que leer. Esa es la
 * regla que manda sobre cualquier otra: contraste bajo, nada de movimiento
 * brusco, y el centro de la pantalla más tranquilo que los bordes, porque
 * es donde caen el nombre y los enlaces. Un fondo que se nota es un fondo
 * que estorba.
 *
 * Cada uno toma los dos colores de acento de quien lo usa, así que el mismo
 * algoritmo se ve distinto en cada página sin que nadie elija nada más.
 *
 * El azar lleva semilla: el mismo fondo se dibuja igual en cada visita. Sin
 * eso, una página cambiaría de aspecto al recargarla, que es lo contrario
 * de tener una identidad.
 *
 * Lo usan dos sitios: la página pública, a pantalla completa, y el panel,
 * en miniatura dentro de cada baldosa del selector. Por eso vive aparte y
 * no sabe nada de ninguno de los dos.
 */
(function () {
  'use strict';

  // ---- Lo que comparten todos ----

  /* Azar con semilla (mulberry32). Corto, rápido y reproducible: la misma
     semilla da siempre la misma secuencia, en cualquier navegador. */
  function azar(semilla) {
    let a = semilla >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Semilla a partir del nombre, para que cada fondo tenga su propia cara
     sin tener que inventarse un número por cada uno. */
  function semillaDe(texto) {
    let h = 2166136261;
    for (let i = 0; i < texto.length; i++) {
      h ^= texto.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* Ruido de valor en dos dimensiones, con interpolación suave.
   *
   * No es Perlin ni Simplex: es la versión sencilla, una rejilla de valores
   * al azar interpolada. Para un fondo desenfocado y lento la diferencia no
   * se ve, y esto son veinte líneas en vez de una librería. */
  function crearRuido(semilla) {
    const r = azar(semilla);
    const TAM = 256;
    const tabla = new Float32Array(TAM * TAM);
    for (let i = 0; i < tabla.length; i++) tabla[i] = r();

    const valor = (x, y) => tabla[((y & (TAM - 1)) * TAM + (x & (TAM - 1)))];
    // Suavizado de quinto grado: su primera y segunda derivada valen cero en
    // los extremos, y por eso no se ven las costuras de la rejilla.
    const suave = (t) => t * t * t * (t * (t * 6 - 15) + 10);

    return function (x, y) {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const xf = suave(x - xi);
      const yf = suave(y - yi);
      const a = valor(xi, yi);
      const b = valor(xi + 1, yi);
      const c = valor(xi, yi + 1);
      const d = valor(xi + 1, yi + 1);
      return (a + (b - a) * xf) + ((c + (d - c) * xf) - (a + (b - a) * xf)) * yf;
    };
  }

  function aRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return [255, 255, 255];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }

  function mezclar(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
    ];
  }

  const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

  // ---- Los fondos ----
  //
  // Cada uno es una fábrica: recibe el lienzo y la paleta, y devuelve algo
  // con dibujar(t) y, si lo necesita, medir(). `t` son segundos desde que
  // arrancó, no el número de fotograma: así el movimiento va igual de rápido
  // en una pantalla de 60 Hz que en una de 144.

  const CATALOGO = [];
  const definir = (def) => CATALOGO.push(def);

  /* MALLA — una topografía de alambre que respira.
     Líneas horizontales cuya altura sale del ruido; cada una se rellena del
     color del fondo antes de dibujarse, así que tapa a las de detrás y
     aparece la profundidad sin calcular ninguna. */
  definir({
    clave: 'malla',
    nombre: 'Malla',
    resumen: 'Una topografía de alambre que respira despacio.',
    crear(ctx, p) {
      const ruido = crearRuido(semillaDe('malla'));
      return function (t, w, h) {
        const lineas = Math.max(14, Math.round(h / 26));
        const paso = Math.max(6, Math.round(w / 90));
        ctx.lineWidth = Math.max(1, p.escala * 0.8);
        for (let i = 0; i < lineas; i++) {
          const f = i / (lineas - 1);
          // La perspectiva: las de abajo son más altas y más claras.
          const base = h * (0.42 + f * 0.62);
          // Relativa al alto del lienzo: así la topografía tiene la misma
          // forma en la miniatura y a pantalla completa.
          const amplitud = h * (0.018 + f * f * 0.13);
          const color = mezclar(p.frio, p.calido, f);
          ctx.beginPath();
          ctx.moveTo(-paso, h + 10);
          for (let x = -paso; x <= w + paso; x += paso) {
            const n = ruido(x * 0.006 + t * 0.05, i * 0.35 + t * 0.02);
            ctx.lineTo(x, base - (n - 0.5) * 2 * amplitud);
          }
          ctx.lineTo(w + paso, h + 10);
          ctx.closePath();
          ctx.fillStyle = p.fondoSolido;
          ctx.fill();
          ctx.strokeStyle = rgba(color, 0.06 + f * 0.3);
          ctx.stroke();
        }
      };
    },
  });

  /* DERIVA — un campo de fuerzas que sólo se ve por lo que arrastra.
     Partículas que siguen el ángulo que marca el ruido en cada punto, y un
     velo translúcido encima en cada fotograma: eso borra el pasado poco a
     poco y es lo que deja la estela. */
  definir({
    clave: 'deriva',
    nombre: 'Deriva',
    resumen: 'Partículas arrastradas por una corriente invisible.',
    crear(ctx, p) {
      const ruido = crearRuido(semillaDe('deriva'));
      const r = azar(semillaDe('deriva'));
      let puntos = [];
      let anchoPrevio = 0;

      return function (t, w, h) {
        if (w !== anchoPrevio) {
          anchoPrevio = w;
          // Recuento fijo, no derivado del área: la miniatura es una
          // maqueta a escala de la página, y con (w*h)/2600 se quedaba en
          // doce partículas y parecía estropeada.
          puntos = Array.from({ length: 280 }, () => ({
            x: r() * w, y: r() * h, vida: r() * 220,
          }));
        }
        // El velo, más fino que el de la lluvia: aquí la estela ES el
        // dibujo. Con el velo compartido se borraba en siete fotogramas y
        // lo que quedaba era moteado, no una corriente.
        ctx.fillStyle = p.veloTenue;
        ctx.fillRect(0, 0, w, h);

        ctx.lineWidth = 1.1 * p.escala;
        for (const q of puntos) {
          const ang = ruido(q.x * 0.0022, q.y * 0.0022 + t * 0.03) * Math.PI * 4;
          // Relativa al lienzo: a velocidad fija en píxeles, la miniatura
          // se cruza en un suspiro y la pantalla completa no avanza.
          const v = Math.min(w, h) * 0.004;
          const vx = Math.cos(ang) * v;
          const vy = Math.sin(ang) * v;
          const color = mezclar(p.frio, p.calido, q.y / h);
          ctx.strokeStyle = rgba(color, 0.4);
          ctx.beginPath();
          ctx.moveTo(q.x, q.y);
          q.x += vx; q.y += vy; q.vida--;
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
          // Renacen en otro sitio al salirse o al agotarse: si no, todas
          // acaban atrapadas en los mismos remolinos y el cuadro se congela.
          if (q.vida < 0 || q.x < -20 || q.x > w + 20 || q.y < -20 || q.y > h + 20) {
            q.x = r() * w; q.y = r() * h; q.vida = 120 + r() * 200;
          }
        }
      };
    },
  });

  /* LLUVIA — columnas de unos y ceros cayendo.
     Encaja con la monoespaciada de toda la página: es la misma idea que las
     tiras de binario, pero vertical y sin prisa. */
  definir({
    clave: 'lluvia',
    nombre: 'Lluvia',
    resumen: 'Columnas de unos y ceros bajando sin prisa.',
    crear(ctx, p) {
      const r = azar(semillaDe('lluvia'));
      let columnas = [];
      let anchoPrevio = 0;
      const PASO = 17;

      return function (t, w, h) {
        if (w !== anchoPrevio) {
          anchoPrevio = w;
          columnas = Array.from({ length: Math.ceil(w / PASO) }, () => ({
            y: r() * h, v: 18 + r() * 44, largo: 6 + Math.floor(r() * 14), fase: r() * 100,
          }));
        }
        ctx.fillStyle = p.velo;
        ctx.fillRect(0, 0, w, h);
        ctx.font = `${Math.round(PASO * 0.72)}px ui-monospace, monospace`;
        ctx.textBaseline = 'top';

        columnas.forEach((c, i) => {
          c.y += c.v * 0.016;
          if (c.y - c.largo * PASO > h) { c.y = -r() * h * 0.4; c.v = 18 + r() * 44; }
          for (let j = 0; j < c.largo; j++) {
            const y = c.y - j * PASO;
            if (y < -PASO || y > h) continue;
            // El de delante va casi blanco y la cola se apaga: es lo que da
            // la sensación de que cae y no de que son rayas quietas.
            const cabeza = j === 0;
            const color = cabeza ? p.claro : mezclar(p.frio, p.calido, i / columnas.length);
            ctx.fillStyle = rgba(color, cabeza ? 0.5 : 0.26 * (1 - j / c.largo));
            // El dígito cambia con el tiempo, pero despacio y distinto por
            // celda: parpadear todos a la vez se lee como un error.
            const bit = (Math.floor(t * 1.7 + c.fase + j * 1.3 + i) % 2) ? '1' : '0';
            ctx.fillText(bit, i * PASO + 3, y);
          }
        });
      };
    },
  });

  /* AURORA — bandas de luz que se cruzan.
     Nada de partículas: franjas verticales con degradado, desplazadas por
     senos de distinta frecuencia. Es el fondo más tranquilo del conjunto y
     el que mejor deja leer encima. */
  definir({
    clave: 'aurora',
    nombre: 'Aurora',
    resumen: 'Cortinas de luz que se cruzan muy despacio.',
    crear(ctx, p) {
      const r = azar(semillaDe('aurora'));
      const capas = Array.from({ length: 5 }, (_, i) => ({
        f1: 0.3 + r() * 0.5, f2: 0.7 + r() * 1.1, fase: r() * 6.28,
        alto: 0.18 + r() * 0.3, pos: 0.15 + i * 0.17,
      }));

      return function (t, w, h) {
        ctx.fillStyle = p.fondoSolido;
        ctx.fillRect(0, 0, w, h);
        const paso = Math.max(4, Math.round(w / 140));
        capas.forEach((c, i) => {
          const color = mezclar(p.frio, p.calido, i / (capas.length - 1));
          const grad = ctx.createLinearGradient(0, h * (c.pos - c.alto), 0, h * (c.pos + c.alto));
          grad.addColorStop(0, rgba(color, 0));
          grad.addColorStop(0.5, rgba(color, 0.2));
          grad.addColorStop(1, rgba(color, 0));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(0, h);
          for (let x = 0; x <= w + paso; x += paso) {
            const u = x / w;
            const y = h * c.pos
              + Math.sin(u * 6.28 * c.f1 + t * 0.19 + c.fase) * h * 0.1
              + Math.sin(u * 6.28 * c.f2 - t * 0.12) * h * 0.05;
            ctx.lineTo(x, y);
          }
          ctx.lineTo(w, h);
          ctx.closePath();
          ctx.fill();
        });
      };
    },
  });

  /* ÓRBITAS — cuerpos girando en elipses inclinadas.
     Las estelas no se guardan: se vuelven a dibujar enteras cada fotograma
     recorriendo el pasado de cada órbita, que es exacto y no acumula error
     ni memoria. */
  definir({
    clave: 'orbitas',
    nombre: 'Órbitas',
    resumen: 'Cuerpos girando en elipses inclinadas.',
    crear(ctx, p) {
      const r = azar(semillaDe('orbitas'));
      const cuerpos = Array.from({ length: 11 }, (_, i) => ({
        rx: 0.12 + r() * 0.42, ry: 0.05 + r() * 0.3,
        giro: r() * Math.PI, v: (r() < 0.5 ? -1 : 1) * (0.07 + r() * 0.22),
        fase: r() * 6.28, tono: i / 10,
      }));

      return function (t, w, h) {
        ctx.fillStyle = p.fondoSolido;
        ctx.fillRect(0, 0, w, h);
        const cx = w / 2;
        const cy = h / 2;
        const m = Math.min(w, h);
        for (const c of cuerpos) {
          const color = mezclar(p.frio, p.calido, c.tono);
          const cos = Math.cos(c.giro);
          const sen = Math.sin(c.giro);
          const punto = (ang) => {
            const x = Math.cos(ang) * c.rx * m;
            const y = Math.sin(ang) * c.ry * m;
            return [cx + x * cos - y * sen, cy + x * sen + y * cos];
          };
          // La estela: treinta pasos hacia atrás, apagándose.
          ctx.lineWidth = 1.2 * p.escala;
          for (let k = 30; k > 0; k--) {
            const a0 = c.fase + (t - k * 0.05) * c.v * 6.28;
            const a1 = c.fase + (t - (k - 1) * 0.05) * c.v * 6.28;
            const [x0, y0] = punto(a0);
            const [x1, y1] = punto(a1);
            ctx.strokeStyle = rgba(color, 0.22 * (1 - k / 30));
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
          }
          const [x, y] = punto(c.fase + t * c.v * 6.28);
          ctx.fillStyle = rgba(color, 0.65);
          ctx.beginPath();
          ctx.arc(x, y, 1.8 * p.escala, 0, 6.2832);
          ctx.fill();
        }
      };
    },
  });

  /* INTERFERENCIA — tres focos de onda que se suman.
     Donde las crestas coinciden sale un punto brillante y donde se cancelan
     un hueco; el dibujo de anillos no está programado en ninguna parte,
     aparece solo. Se muestrea en rejilla gruesa: a resolución de píxel sería
     precioso y costaría la batería de cualquiera. */
  definir({
    clave: 'interferencia',
    nombre: 'Interferencia',
    resumen: 'Ondas que se suman y se anulan.',
    crear(ctx, p) {
      const r = azar(semillaDe('interferencia'));
      // Repartidos a tercios y no al azar por todo el cuadro: tres focos
      // que caen juntos no interfieren, sólo hacen una mancha.
      const focos = [0, 1, 2].map((i) => ({
        x: 0.22 + (i % 2) * 0.5 + (r() - 0.5) * 0.12,
        y: 0.24 + Math.floor(i / 2) * 0.46 + (r() - 0.5) * 0.12,
        vx: (r() - 0.5) * 0.035, vy: (r() - 0.5) * 0.035, k: 7 + r() * 5,
      }));

      return function (t, w, h) {
        ctx.fillStyle = p.fondoSolido;
        ctx.fillRect(0, 0, w, h);
        const paso = Math.max(5, Math.round(Math.min(w, h) / 40));
        const diagonal = Math.sqrt(w * w + h * h);
        const centros = focos.map((f) => [
          (f.x + Math.sin(t * f.vx * 6.28) * 0.18) * w,
          (f.y + Math.cos(t * f.vy * 6.28) * 0.18) * h,
        ]);
        for (let y = paso / 2; y < h; y += paso) {
          for (let x = paso / 2; x < w; x += paso) {
            let suma = 0;
            for (let i = 0; i < focos.length; i++) {
              const dx = x - centros[i][0];
              const dy = y - centros[i][1];
              // k en vueltas por diagonal, no en radianes por píxel: así el
              // número de anillos es el mismo en la miniatura y en la
              // pantalla completa.
              const dist = Math.sqrt(dx * dx + dy * dy) / diagonal;
              suma += Math.sin(dist * focos[i].k * 6.2832 - t * 1.6);
            }
            const v = suma / focos.length;        // -1 .. 1
            if (v < 0.05) continue;               // sólo las crestas
            const color = mezclar(p.frio, p.calido, (v + 1) / 2);
            ctx.fillStyle = rgba(color, 0.08 + v * 0.34);
            const rad = v * paso * 0.3 * p.escala;
            ctx.beginPath();
            ctx.arc(x, y, rad, 0, 6.2832);
            ctx.fill();
          }
        }
      };
    },
  });

  /* CELDAS — teselación orgánica.
     Un Voronoi de verdad por píxel no cabe en el presupuesto, así que se
     calcula en un lienzo aparte ocho veces más pequeño y se estira. El
     desenfoque que eso provoca aquí no es un defecto: es exactamente el
     aspecto que debe tener algo que está detrás. */
  definir({
    clave: 'celdas',
    nombre: 'Celdas',
    resumen: 'Una teselación que se reacomoda sola.',
    crear(ctx, p) {
      const r = azar(semillaDe('celdas'));
      const sitios = Array.from({ length: 14 }, () => ({
        x: r(), y: r(), vx: (r() - 0.5) * 0.02, vy: (r() - 0.5) * 0.02, tono: r(),
      }));
      const chico = document.createElement('canvas');
      const cctx = chico.getContext('2d', { willReadFrequently: true });
      const DIV = 5;

      return function (t, w, h) {
        const aw = Math.max(2, Math.ceil(w / DIV));
        const ah = Math.max(2, Math.ceil(h / DIV));
        if (chico.width !== aw || chico.height !== ah) { chico.width = aw; chico.height = ah; }

        const img = cctx.createImageData(aw, ah);
        const d = img.data;
        const pos = sitios.map((s) => [
          (s.x + Math.sin(t * s.vx * 6.28) * 0.25) * aw,
          (s.y + Math.cos(t * s.vy * 6.28) * 0.25) * ah,
        ]);
        const base = aRgb(p.fondoHex);

        for (let y = 0; y < ah; y++) {
          for (let x = 0; x < aw; x++) {
            let d1 = Infinity, d2 = Infinity, cual = 0;
            for (let i = 0; i < pos.length; i++) {
              const dx = x - pos[i][0];
              const dy = y - pos[i][1];
              const dd = dx * dx + dy * dy;
              if (dd < d1) { d2 = d1; d1 = dd; cual = i; }
              else if (dd < d2) { d2 = dd; }
            }
            // La diferencia entre el sitio más cercano y el segundo: casi
            // cero justo en la frontera entre dos celdas. Eso dibuja el
            // borde sin tener que calcular ninguna arista.
            // Una banda estrecha alrededor de la frontera, y elevada a la
            // cuarta para que el borde sea una línea y no un degradado: a
            // la segunda salía una nube magenta en vez de una teselación.
            const borde = Math.max(0, 1 - (Math.sqrt(d2) - Math.sqrt(d1)) / (1.6 * p.escala));
            const color = mezclar(p.frio, p.calido, sitios[cual].tono);
            const b2 = borde * borde;
            const a = b2 * b2 * 0.45;
            const o = (y * aw + x) * 4;
            d[o] = base[0] + (color[0] - base[0]) * a;
            d[o + 1] = base[1] + (color[1] - base[1]) * a;
            d[o + 2] = base[2] + (color[2] - base[2]) * a;
            d[o + 3] = 255;
          }
        }
        cctx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(chico, 0, 0, w, h);
      };
    },
  });

  /* REJILLA — un suelo infinito que viene hacia ti.
     El espaciado de las horizontales sale de dividir la distancia, no de
     sumarla: así se amontonan contra el horizonte como lo harían de verdad.
     El desplazamiento es fraccionario y continuo, de modo que no hay ningún
     salto cuando una línea desaparece por abajo. */
  definir({
    clave: 'rejilla',
    nombre: 'Rejilla',
    resumen: 'Un suelo infinito que viene hacia ti.',
    crear(ctx, p) {
      return function (t, w, h) {
        ctx.fillStyle = p.fondoSolido;
        ctx.fillRect(0, 0, w, h);
        const horizonte = h * 0.45;
        const cx = w / 2;
        ctx.lineWidth = Math.max(1, p.escala * 0.7);

        // Verticales: todas salen del punto de fuga.
        const COLUMNAS = 26;
        for (let i = -COLUMNAS; i <= COLUMNAS; i++) {
          const f = i / COLUMNAS;
          ctx.strokeStyle = rgba(mezclar(p.frio, p.calido, (f + 1) / 2), 0.12);
          ctx.beginPath();
          ctx.moveTo(cx, horizonte);
          ctx.lineTo(cx + f * w * 2.4, h);
          ctx.stroke();
        }

        // Horizontales. El avance va en la parte fraccionaria del tiempo
        // para que el bucle sea invisible.
        const FILAS = 18;
        const avance = (t * 0.22) % 1;
        for (let i = 0; i < FILAS; i++) {
          const z = (i + avance) / FILAS;     // 0 en el horizonte, 1 a tus pies
          const y = horizonte + (h - horizonte) * (z * z);
          const cerca = z;
          ctx.strokeStyle = rgba(mezclar(p.frio, p.calido, cerca), 0.05 + cerca * 0.25);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }

        // Un resplandor bajo el horizonte, que es lo que impide que la
        // rejilla parezca una hoja de cálculo.
        const brillo = ctx.createLinearGradient(0, horizonte - h * 0.18, 0, horizonte + h * 0.06);
        brillo.addColorStop(0, rgba(p.calido, 0));
        brillo.addColorStop(1, rgba(p.calido, 0.16));
        ctx.fillStyle = brillo;
        ctx.fillRect(0, horizonte - h * 0.18, w, h * 0.24);
      };
    },
  });

  /* POLVO — lo más discreto del catálogo.
     Para quien quiere algo y casi nada: motas lentas con un halo. Existe
     porque no todo el mundo quiere un fondo que se note, y «ninguno» deja
     la página plana. */
  definir({
    clave: 'polvo',
    nombre: 'Polvo',
    resumen: 'Motas de luz a la deriva. Lo más discreto.',
    crear(ctx, p) {
      const r = azar(semillaDe('polvo'));
      let motas = [];
      let anchoPrevio = 0;

      return function (t, w, h) {
        if (w !== anchoPrevio) {
          anchoPrevio = w;
          // Fijo, por lo mismo que en Deriva: con el área, la miniatura se
          // quedaba en dos motas.
          motas = Array.from({ length: 70 }, () => ({
            x: r(), y: r(), rad: 0.6 + r() * 2.4, v: 0.004 + r() * 0.016,
            amp: 0.01 + r() * 0.05, fase: r() * 6.28, tono: r(),
          }));
        }
        ctx.fillStyle = p.fondoSolido;
        ctx.fillRect(0, 0, w, h);
        for (const m of motas) {
          const y = ((m.y - t * m.v) % 1 + 1) % 1;
          const x = m.x + Math.sin(t * 0.3 + m.fase) * m.amp;
          const color = mezclar(p.frio, p.calido, m.tono);
          const px = x * w;
          const py = y * h;
          const rad = m.rad * p.escala;
          const halo = ctx.createRadialGradient(px, py, 0, px, py, rad * 3.5);
          halo.addColorStop(0, rgba(color, 0.55));
          halo.addColorStop(0.4, rgba(color, 0.12));
          halo.addColorStop(1, rgba(color, 0));
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(px, py, rad * 3.5, 0, 6.2832);
          ctx.fill();
        }
      };
    },
  });

  // ---- El motor ----

  /* Arranca un fondo sobre un lienzo y lo mantiene vivo.
   *
   * Lo que hace aparte de dibujar, que es la mitad del trabajo:
   *
   *   - Se detiene cuando la pestaña no está delante. Un fondo animado en
   *     una pestaña que nadie mira es batería tirada.
   *   - Se detiene cuando el lienzo sale de la pantalla, que es lo que pasa
   *     con las miniaturas del selector al bajar la lista.
   *   - Dibuja un solo fotograma y para si el sistema pide menos movimiento.
   *   - Va a 30 por segundo, no a 60: es un fondo desenfocado y lento, y
   *     nadie distingue la diferencia mirando a otra cosa.
   */
  function montar(lienzo, opciones) {
    const op = opciones || {};
    const def = CATALOGO.find((d) => d.clave === op.clave);
    if (!def || !lienzo) return null;

    const ctx = lienzo.getContext('2d');
    if (!ctx) return null;

    const quieto = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const frio = aRgb(op.desde || '#ff5f8f');
    const calido = aRgb(op.hasta || '#ff9a5a');
    const fondoHex = op.fondo || '#0e0a10';
    const paleta = {
      frio,
      calido,
      claro: [245, 240, 245],
      fondoHex,
      fondoSolido: `rgb(${aRgb(fondoHex).join(',')})`,
      // El velo de las estelas: el mismo color del fondo, casi
      // transparente. Dos espesores, porque la lluvia quiere una cola corta
      // y la deriva vive de que la suya sea larga.
      velo: rgba(aRgb(fondoHex), 0.13),
      veloTenue: rgba(aRgb(fondoHex), 0.045),
      // Las miniaturas son diez veces más pequeñas que la página: sin esto,
      // una línea de un píxel y una mota de dos se verían como una mancha.
      //
      // REGLA: la escala multiplica GROSORES y RADIOS, y nada más. Ni
      // amplitudes, ni velocidades, ni opacidades. Esas tres ya son
      // relativas al lienzo o están en su sitio, y multiplicarlas dio
      // exactamente lo que se vio la primera vez: una malla con ondas más
      // altas que la pantalla, celdas con la opacidad por encima de uno y
      // partículas cruzando la miniatura en medio segundo.
      escala: op.escala || 1,
    };

    const dibujar = def.crear(ctx, paleta);

    let w = 0;
    let h = 0;
    let rafId = null;
    let vivo = false;
    let visible = true;
    const t0 = performance.now();
    let ultimo = 0;

    function medir() {
      // El tope de 2 en la densidad es deliberado: en un móvil de 3x, un
      // lienzo a pantalla completa serían nueve veces los píxeles para un
      // fondo borroso.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const caja = lienzo.getBoundingClientRect();
      w = Math.max(1, Math.round(caja.width));
      h = Math.max(1, Math.round(caja.height));
      if (lienzo.width !== Math.round(w * dpr) || lienzo.height !== Math.round(h * dpr)) {
        lienzo.width = Math.round(w * dpr);
        lienzo.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }

    function unFotograma(ahora) {
      ctx.clearRect(0, 0, w, h);
      dibujar((ahora - t0) / 1000, w, h);
    }

    function bucle(ahora) {
      rafId = requestAnimationFrame(bucle);
      if (ahora - ultimo < 33) return;   // ~30 por segundo
      ultimo = ahora;
      unFotograma(ahora);
    }

    function arrancar() {
      if (vivo || quieto) return;
      vivo = true;
      ultimo = 0;
      rafId = requestAnimationFrame(bucle);
    }

    function parar() {
      vivo = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    }

    function replantear() {
      if (!visible || document.hidden) parar();
      else arrancar();
    }

    medir();
    // Siempre un primer fotograma, aunque luego no se anime: con movimiento
    // reducido o con la pestaña detrás, lo que se ve es el cuadro quieto y
    // no un rectángulo vacío.
    unFotograma(performance.now());
    replantear();

    const alCambiarPestana = () => replantear();
    document.addEventListener('visibilitychange', alCambiarPestana);

    let observador = null;
    if (window.IntersectionObserver) {
      observador = new IntersectionObserver((entradas) => {
        visible = entradas.some((e) => e.isIntersecting);
        replantear();
      }, { rootMargin: '120px' });
      observador.observe(lienzo);
    }

    let observadorTam = null;
    const alRedimensionar = () => { medir(); if (!vivo) unFotograma(performance.now()); };
    if (window.ResizeObserver) {
      observadorTam = new ResizeObserver(alRedimensionar);
      observadorTam.observe(lienzo);
    } else {
      window.addEventListener('resize', alRedimensionar);
    }

    return {
      parar() {
        parar();
        document.removeEventListener('visibilitychange', alCambiarPestana);
        if (observador) observador.disconnect();
        if (observadorTam) observadorTam.disconnect();
        else window.removeEventListener('resize', alRedimensionar);
        ctx.clearRect(0, 0, w, h);
      },
    };
  }

  window.AKFondos = {
    catalogo: () => CATALOGO.map((d) => ({ clave: d.clave, nombre: d.nombre, resumen: d.resumen })),
    existe: (clave) => CATALOGO.some((d) => d.clave === clave),
    montar,
  };
})();
