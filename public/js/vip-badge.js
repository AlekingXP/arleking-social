(function () {
  // Tier config: emoji, reveal word, particle color. Only 'billete' ($5)
  // exists today — 'diamante' ($10, red) and 'sello' ($15, black wax) get
  // their own entries here once they're sellable via Stripe.
  const TIERS = {
    billete: {
      emoji: '💵',
      label: 'Billete dorado',
      word: 'VIP',
      colorRgb: [255, 205, 70],
      glowCss: 'rgba(255, 205, 70, 0.55)',
    },
  };

  // Four-beat reveal: burst out from the badge, converge into the tier word,
  // hold with a shimmer, then collapse back down into the badge spot.
  const DURATIONS = { explode: 450, converge: 900, hold: 700, collapse: 500 };

  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOutQuad(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  // Renders `text` to an offscreen canvas and samples the pixels it covers,
  // returning points centered on (0, 0) — the target shape particles
  // converge into.
  function sampleTextPoints(text, fontPx, maxPoints) {
    const width = Math.ceil(fontPx * text.length * 0.85) + fontPx;
    const height = Math.ceil(fontPx * 1.6);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    ctx.fillStyle = '#fff';
    ctx.font = `700 ${fontPx}px "Playfair Display", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2);

    const { data } = ctx.getImageData(0, 0, width, height);
    const step = 3;
    const candidates = [];
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha > 128) candidates.push({ x: x - width / 2, y: y - height / 2 });
      }
    }

    if (candidates.length <= maxPoints) return candidates;
    const stride = candidates.length / maxPoints;
    const picked = [];
    for (let i = 0; i < maxPoints; i++) picked.push(candidates[Math.floor(i * stride)]);
    return picked;
  }

  function storageKey(slug) {
    return 'vip-badge-revealed:' + slug;
  }

  function readSeen(slug) {
    try {
      return localStorage.getItem(storageKey(slug)) === '1';
    } catch {
      return false;
    }
  }

  function markSeen(slug) {
    try {
      localStorage.setItem(storageKey(slug), '1');
    } catch {
      // Ignore — worst case the reveal plays again on the next visit.
    }
  }

  // Canvas 2D particle engine for the reveal. Runs once per profile per
  // browser (see readSeen/markSeen below) — anchorEl is the small badge span
  // the particles burst from and collapse back into.
  function playReveal(anchorEl, tier, onComplete) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      onComplete();
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'vip-reveal-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      canvas.remove();
      onComplete();
      return;
    }

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const rect = anchorEl.getBoundingClientRect();
    const anchor = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const textCenter = {
      x: window.innerWidth / 2,
      y: Math.min(window.innerHeight * 0.42, window.innerHeight - 100),
    };
    const fontPx = Math.min(160, Math.max(72, window.innerWidth * 0.2));
    const letterPoints = sampleTextPoints(tier.word, fontPx, 320);

    const particles = letterPoints.map((p) => {
      const angle = Math.random() * Math.PI * 2;
      const dist = 60 + Math.random() * 150;
      return {
        scatterX: anchor.x + Math.cos(angle) * dist,
        scatterY: anchor.y + Math.sin(angle) * dist,
        targetX: textCenter.x + p.x,
        targetY: textCenter.y + p.y,
        size: 1.6 + Math.random() * 2.2,
        seed: Math.random() * Math.PI * 2,
      };
    });

    const [r, g, b] = tier.colorRgb;
    const tExplode = DURATIONS.explode;
    const tConverge = tExplode + DURATIONS.converge;
    const tHold = tConverge + DURATIONS.hold;
    const tCollapse = tHold + DURATIONS.collapse;
    const start = performance.now();

    function cleanup() {
      window.removeEventListener('resize', resize);
      canvas.remove();
    }

    function frame(now) {
      const elapsed = now - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (elapsed >= tCollapse) {
        cleanup();
        onComplete();
        return;
      }

      ctx.shadowColor = tier.glowCss;
      ctx.shadowBlur = 10;

      particles.forEach((particle) => {
        let x, y, alpha, radius;

        if (elapsed < tExplode) {
          const t = easeOutCubic(elapsed / DURATIONS.explode);
          x = lerp(anchor.x, particle.scatterX, t);
          y = lerp(anchor.y, particle.scatterY, t);
          alpha = Math.min(1, elapsed / (DURATIONS.explode * 0.3));
          radius = particle.size * (0.5 + 0.5 * t);
        } else if (elapsed < tConverge) {
          const t = easeInOutQuad((elapsed - tExplode) / DURATIONS.converge);
          x = lerp(particle.scatterX, particle.targetX, t);
          y = lerp(particle.scatterY, particle.targetY, t);
          alpha = 1;
          radius = particle.size;
        } else if (elapsed < tHold) {
          const shimmer = 0.75 + 0.25 * Math.sin(now / 220 + particle.seed);
          x = particle.targetX;
          y = particle.targetY;
          alpha = shimmer;
          radius = particle.size * (0.9 + 0.2 * shimmer);
        } else {
          const t = easeInOutQuad((elapsed - tHold) / DURATIONS.collapse);
          x = lerp(particle.targetX, anchor.x, t);
          y = lerp(particle.targetY, anchor.y, t);
          alpha = 1 - t;
          radius = particle.size * (1 - t * 0.8);
        }

        ctx.beginPath();
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.arc(x, y, Math.max(0.2, radius), 0, Math.PI * 2);
        ctx.fill();
      });

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  // VIP badge next to a profile's name. The first time a visitor opens a
  // given profile, the emoji explodes into particles that form the tier
  // word, then settles into a small static badge. Every visit after that
  // (tracked per-browser via localStorage) skips straight to the static
  // badge.
  function renderVipBadge(profile) {
    const tier = TIERS[profile.vip_tier];
    if (!tier) return;

    const nameEl = document.getElementById('main-name');
    if (!nameEl) return;

    const badge = document.createElement('span');
    badge.className = 'vip-badge';
    badge.textContent = tier.emoji;
    badge.title = 'VIP — ' + tier.label;
    badge.setAttribute('aria-label', 'Insignia VIP: ' + tier.label);
    nameEl.appendChild(badge);

    if (readSeen(profile.slug)) {
      badge.classList.add('settled');
      return;
    }

    playReveal(badge, tier, () => {
      markSeen(profile.slug);
      badge.classList.add('settled');
    });
  }

  window.renderVipBadge = renderVipBadge;
})();
