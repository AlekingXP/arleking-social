/* Panel de analíticas.
 *
 * Las gráficas son SVG escrito a mano, no una librería. Chart.js habría
 * costado 200 KB desde un CDN y habría traído su propia estética —ejes
 * grises, tooltips blancos, tipografía ajena— que en esta interfaz de vidrio
 * y oro se vería pegada con cinta. Un área con degradado y unas barras son
 * cincuenta líneas y encajan con el resto.
 */
(function () {
  const NUM = new Intl.NumberFormat('es');

  function fmt(n) {
    return NUM.format(n || 0);
  }

  function fmtDuration(ms) {
    if (!ms) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  // Bandera por código ISO: cada letra desplazada al bloque de símbolos
  // regionales. Evita cargar un juego de iconos entero para veinte países.
  function flag(code) {
    if (!code || code.length !== 2) return '🌐';
    return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // ---- Gráfica de área ----

  function areaChart(points, { width = 720, height = 180, pad = 8 } = {}) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'chart-svg');

    const values = points.map((p) => p.value);
    // El techo nunca es 0: con todo a cero la curva debe apoyarse en la base,
    // no dividir por cero.
    const max = Math.max(1, ...values);
    const stepX = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
    const y = (v) => height - pad - (v / max) * (height - pad * 2);

    const coords = points.map((p, i) => [pad + i * stepX, y(p.value)]);

    // Curva suavizada con Catmull-Rom convertida a Bézier: una polilínea
    // recta delata lo pocos puntos que hay.
    let d = `M ${coords[0][0]} ${coords[0][1]}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[i - 1] || coords[i];
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const p3 = coords[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
    }

    const defs = document.createElementNS(ns, 'defs');
    const grad = document.createElementNS(ns, 'linearGradient');
    const gradId = 'chart-fill-' + Math.random().toString(36).slice(2, 8);
    grad.setAttribute('id', gradId);
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
    [['0%', 0.32], ['100%', 0]].forEach(([offset, opacity]) => {
      const stop = document.createElementNS(ns, 'stop');
      stop.setAttribute('offset', offset);
      stop.setAttribute('stop-color', 'var(--accent-from)');
      stop.setAttribute('stop-opacity', String(opacity));
      grad.appendChild(stop);
    });
    defs.appendChild(grad);
    svg.appendChild(defs);

    const area = document.createElementNS(ns, 'path');
    area.setAttribute('d', `${d} L ${coords[coords.length - 1][0]} ${height} L ${coords[0][0]} ${height} Z`);
    area.setAttribute('fill', `url(#${gradId})`);
    svg.appendChild(area);

    const line = document.createElementNS(ns, 'path');
    line.setAttribute('d', d);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'var(--accent-from)');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(line);

    return { svg, coords, max };
  }

  // ---- Fila de barra ----

  function barRow(item, { icon } = {}) {
    const row = el('div', 'stat-row');
    const bar = el('div', 'stat-bar');
    bar.style.width = Math.max(2, item.percent) + '%';
    row.appendChild(bar);

    const label = el('span', 'stat-label', (icon ? icon + ' ' : '') + item.name);
    const value = el('span', 'stat-value', `${fmt(item.value)}  ${item.percent}%`);
    row.append(label, value);
    return row;
  }

  function fillBreakdown(containerId, items, iconFor) {
    const box = document.getElementById(containerId);
    if (!box) return;
    box.innerHTML = '';
    if (!items.length) {
      box.appendChild(el('p', 'stat-empty', 'Sin datos todavía'));
      return;
    }
    items.forEach((item) => box.appendChild(barRow(item, { icon: iconFor ? iconFor(item) : null })));
  }

  // ---- Tarjetas ----

  function setMetric(id, value, change) {
    const box = document.getElementById(id);
    if (!box) return;
    box.querySelector('.metric-value').textContent = value;
    const delta = box.querySelector('.metric-change');
    if (change == null) { delta.textContent = ''; return; }
    const up = change > 0;
    // El color sigue al signo, no al "es bueno": subir el rebote es peor, y
    // pintarlo de verde sería mentir con estilo. Por eso el rebote pasa
    // `null` y no muestra flecha.
    delta.textContent = `${up ? '▲' : change < 0 ? '▼' : '–'} ${Math.abs(change)}%`;
    delta.className = 'metric-change ' + (change > 0 ? 'up' : change < 0 ? 'down' : '');
  }

  async function load(range) {
    const data = await fetch(`/api/analytics?range=${encodeURIComponent(range)}`).then((r) => r.json());
    if (data.error) return;

    const s = data.summary;
    setMetric('m-pageviews', fmt(s.pageviews), s.change.pageviews);
    setMetric('m-visitors', fmt(s.visitors), s.change.visitors);
    setMetric('m-sessions', fmt(s.sessions), s.change.sessions);
    setMetric('m-clicks', fmt(s.clicks), s.change.clicks);
    setMetric('m-ctr', s.ctr + '%', null);
    setMetric('m-bounce', s.bounceRate + '%', null);
    setMetric('m-dwell', fmtDuration(s.avgDwellMs), null);

    document.getElementById('live-count').textContent = data.live;
    document.getElementById('live-word').textContent = data.live === 1 ? 'visitante' : 'visitantes';

    // Gráfica
    const holder = document.getElementById('chart-holder');
    holder.innerHTML = '';
    const puntos = data.series.map((p) => ({ label: p.bucket, value: p.pageviews }));
    if (puntos.length) {
      const { svg } = areaChart(puntos);
      holder.appendChild(svg);
      const ejes = el('div', 'chart-axis');
      ejes.append(
        el('span', null, formatBucket(puntos[0].label)),
        el('span', null, `máx ${fmt(Math.max(...puntos.map((p) => p.value)))}`),
        el('span', null, formatBucket(puntos[puntos.length - 1].label))
      );
      holder.appendChild(ejes);
    }

    // Enlaces
    const lista = document.getElementById('link-perf');
    lista.innerHTML = '';
    if (!data.links.length) {
      lista.appendChild(el('p', 'stat-empty', 'Aún no tienes enlaces'));
    } else {
      const maxClicks = Math.max(1, ...data.links.map((l) => l.clicks));
      data.links.forEach((l) => {
        lista.appendChild(barRow({
          name: l.label,
          value: l.clicks,
          percent: (l.clicks / maxClicks) * 100,
        }));
        const pie = el('p', 'stat-sub', `${l.ctr}% de las visitas lo pulsaron`);
        lista.appendChild(pie);
      });
    }

    fillBreakdown('bd-referrers', data.referrers);
    fillBreakdown('bd-browsers', data.browsers);
    fillBreakdown('bd-systems', data.systems);
    fillBreakdown('bd-devices', data.devices);
    fillBreakdown('bd-countries', data.countries, (i) => flag(i.name));
  }

  function formatBucket(bucket) {
    if (bucket.includes('T')) return bucket.slice(11, 16);
    const [, m, d] = bucket.split('-');
    return `${d}/${m}`;
  }

  let rangoActual = '7d';
  let temporizador = null;

  function init() {
    const barra = document.getElementById('range-tabs');
    if (!barra) return;

    barra.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-range]');
      if (!btn) return;
      rangoActual = btn.dataset.range;
      [...barra.querySelectorAll('[data-range]')].forEach((b) => {
        b.setAttribute('aria-selected', String(b === btn));
      });
      load(rangoActual);
    });

    load(rangoActual);
    // Refresco tranquilo: el contador de "ahora mismo" pierde sentido si se
    // queda congelado, pero cada cinco segundos sería un martilleo inútil
    // para una página con este tráfico.
    temporizador = setInterval(() => load(rangoActual), 30000);
    if (temporizador.unref) temporizador.unref();
  }

  window.initAnalytics = init;
})();
