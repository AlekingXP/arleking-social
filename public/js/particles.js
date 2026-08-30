(function () {
  const canvas = document.getElementById('particles-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const CONNECT_DIST = 130;
  const MOUSE_DIST = 150;

  let nodes = [];
  let width = 0;
  let height = 0;
  let color = '255, 255, 255';
  let running = false;
  let rafId = null;

  const mouse = { x: -9999, y: -9999, active: false };

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return '255, 255, 255';
    return `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`;
  }

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  function makeNodes(count) {
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: 1.4 + Math.random() * 1.6,
    }));
  }

  function step() {
    ctx.clearRect(0, 0, width, height);

    for (const n of nodes) {
      n.x += n.vx;
      n.y += n.vy;

      if (n.x < 0 || n.x > width) n.vx *= -1;
      if (n.y < 0 || n.y > height) n.vy *= -1;
      n.x = Math.max(0, Math.min(width, n.x));
      n.y = Math.max(0, Math.min(height, n.y));

      if (mouse.active) {
        const dx = n.x - mouse.x;
        const dy = n.y - mouse.y;
        const dist = Math.hypot(dx, dy);
        if (dist < MOUSE_DIST && dist > 0.01) {
          const force = (1 - dist / MOUSE_DIST) * 0.6;
          n.x += (dx / dist) * force;
          n.y += (dy / dist) * force;
        }
      }
    }

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist < CONNECT_DIST) {
          ctx.strokeStyle = `rgba(${color}, ${(1 - dist / CONNECT_DIST) * 0.25})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      if (mouse.active) {
        const a = nodes[i];
        const dist = Math.hypot(a.x - mouse.x, a.y - mouse.y);
        if (dist < MOUSE_DIST) {
          ctx.strokeStyle = `rgba(${color}, ${(1 - dist / MOUSE_DIST) * 0.55})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }
      }
    }

    for (const n of nodes) {
      const dist = mouse.active ? Math.hypot(n.x - mouse.x, n.y - mouse.y) : Infinity;
      const near = dist < MOUSE_DIST;
      ctx.fillStyle = `rgba(${color}, ${near ? 0.95 : 0.55})`;
      ctx.beginPath();
      ctx.arc(n.x, n.y, near ? n.r * 1.6 : n.r, 0, Math.PI * 2);
      ctx.fill();
    }

    rafId = requestAnimationFrame(step);
  }

  function start(profile) {
    color = hexToRgb(profile.particles_color);
    const density = Math.max(0, Math.min(150, profile.particles_density ?? 60));

    resize();
    makeNodes(density);

    if (!running && density > 0) {
      running = true;
      window.addEventListener('resize', resize);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseleave', onMouseLeave);
      step();
    } else if (density === 0 && running) {
      stop();
    }
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener('resize', resize);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseleave', onMouseLeave);
    ctx.clearRect(0, 0, width, height);
  }

  function onMouseMove(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
  }

  function onMouseLeave() {
    mouse.active = false;
  }

  fetch('/api/public/profile')
    .then((r) => r.json())
    .then((profile) => {
      if (!profile.particles_enabled) return;
      start(profile);
    })
    .catch(() => {});
})();
