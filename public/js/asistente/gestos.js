// Los gestos del personaje: qué hace el cuerpo en cada reacción.
//
// Viven aparte de personaje.js por dos razones. Son datos, no lógica, y se
// leen mejor juntos; y sin Three.js detrás se pueden probar: una coreografía
// que no vuelve al reposo deja al personaje torcido para siempre, y eso hay
// que poder comprobarlo sin abrir un navegador.

import { Ease } from './anim.js';

// Un gesto es una coreografía: varios tramos seguidos por propiedad, cada uno
// con su duración y su curva. Es lo que separa "se mueve" de "reacciona".
//
// El modelo no tiene huesos ni formas de mezcla, así que no hay cara que
// mover: no puede parpadear ni cambiar la mirada. Todo se dice con el cuerpo
// entero —altura, escala, ladeo, giro—, que es exactamente lo que un chibi
// sabe hacer. Intentar expresiones faciales aquí sería prometer algo que la
// malla no puede dar.
//
//   oy    altura, en unidades del modelo (negativo = hacia arriba)
//   ox    desplazamiento lateral
//   sx/sy ancho y alto: juntos hacen el aplastar y estirar
//   tilt  ladeo extra, sobre el que ya tiene
//   giro  vuelta sobre sí mismo, extra sobre hacia dónde mira
export const GESTOS = {
  // Un bote corto para llamar la atención: cada paso de una guía, o el
  // bocadillo de saludo. Sin vuelta: pasa a menudo y marearía.
  bote: {
    oy: [[-0.09, 230, Ease.fuera], [0, 220, Ease.dentro]],
    sy: [[1.05, 180, Ease.fuera], [1, 260, Ease.rebote]],
    sx: [[0.96, 180, Ease.fuera], [1, 260, Ease.rebote]],
  },
  // Al abrir el chat: bote, vuelta entera y aterrizaje aplastado.
  saludo: {
    oy: [[-0.13, 300, Ease.fuera], [0, 260, Ease.dentro], [0, 140, Ease.lineal]],
    // El último tramo, de 0 ms, devuelve el giro a cero. Una vuelta entera
    // se ve igual que ninguna, pero si se queda en 2π el SIGUIENTE saludo
    // arrancaría desde ahí y no giraría nada: giraría una sola vez por
    // sesión, y eso no se nota mirando una captura.
    giro: [[Math.PI * 2, 900, Ease.dentroFuera], [0, 0, Ease.lineal]],
    sy: [[1, 300, Ease.lineal], [0.9, 120, Ease.fuera], [1, 320, Ease.rebote]],
    sx: [[1, 300, Ease.lineal], [1.1, 120, Ease.fuera], [1, 320, Ease.rebote]],
  },
  // Respondió y resolvió: un brinco corto y contento.
  alegre: {
    oy: [[-0.1, 220, Ease.fuera], [0, 200, Ease.dentro]],
    sy: [[1.07, 200, Ease.fuera], [1, 260, Ease.rebote]],
    sx: [[0.95, 200, Ease.fuera], [1, 260, Ease.rebote]],
    tilt: [[0.1, 200, Ease.fuera], [-0.06, 220, Ease.dentroFuera], [0, 200, Ease.dentroFuera]],
  },
  // No supo resolverlo y lo pasa a una persona: una negación corta.
  niega: {
    giro: [[-0.26, 150, Ease.fuera], [0.26, 240, Ease.dentroFuera], [0, 200, Ease.dentroFuera]],
    oy: [[0.03, 180, Ease.fuera], [0, 260, Ease.dentroFuera]],
  },
  // Le acabas de dar un toque: se echa atrás de golpe y vuelve.
  sorpresa: {
    oy: [[-0.07, 110, Ease.fuera], [0, 420, Ease.rebote]],
    sy: [[1.12, 90, Ease.fuera], [1, 480, Ease.rebote]],
    sx: [[0.9, 90, Ease.fuera], [1, 480, Ease.rebote]],
  },
  // Y si insistes, se mosquea: temblor seco.
  molesto: {
    ox: [[0.045, 60, Ease.fuera], [-0.045, 80, Ease.dentroFuera], [0.03, 80, Ease.dentroFuera],
      [-0.02, 80, Ease.dentroFuera], [0, 90, Ease.dentroFuera]],
    tilt: [[-0.1, 70, Ease.fuera], [0.1, 90, Ease.dentroFuera], [0, 160, Ease.dentroFuera]],
  },
  // Tres toques seguidos: se marea. Da vueltas y se va recuperando.
  mareado: {
    giro: [[Math.PI * 2, 620, Ease.dentroFuera], [Math.PI * 4, 620, Ease.dentroFuera],
      [Math.PI * 4, 420, Ease.lineal], [0, 0, Ease.lineal]],
    tilt: [[0.22, 300, Ease.dentroFuera], [-0.22, 420, Ease.dentroFuera],
      [0.14, 400, Ease.dentroFuera], [0, 420, Ease.dentroFuera]],
    oy: [[0.05, 400, Ease.dentroFuera], [0, 600, Ease.dentroFuera]],
  },
};

// Con "menos movimiento" activado no se suprimen los gestos: se bajan. Un
// gesto es respuesta a algo que acabas de hacer, no movimiento gratuito, y
// quitarlo del todo deja al personaje pareciendo roto. Las vueltas sobre sí
// mismo sí se quitan, que es lo que de verdad marea.
export const SIN_GIRO_EN_CALMA = ['saludo', 'mareado'];
export const FUERZA_EN_CALMA = 0.35;
