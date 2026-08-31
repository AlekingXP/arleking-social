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

  // Six-beat reveal: loose dust converges into the emoji shape, the emoji
  // charges up and bursts apart, the scattered particles converge again into
  // the tier word, hold with a shimmer, then collapse back into the badge.
  const DURATIONS = { form: 650, impulse: 180, explode: 420, converge: 850, hold: 650, collapse: 500 };

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

    // Two target shapes, sampled the same way: the emoji itself (formed
    // first, then bursts apart) and the tier word (formed second, then
    // collapses into the small badge). Word points drive the particle
    // count; if the emoji has fewer sample points, some particles simply
    // share an emoji target — harmless, it just clusters slightly there.
    const wordPoints = sampleTextPoints(tier.word, fontPx, 320);
    const emojiPoints = sampleTextPoints(tier.emoji, fontPx, 320);

    const particles = wordPoints.map((p, i) => {
      const emojiP = emojiPoints.length ? emojiPoints[i % emojiPoints.length] : { x: 0, y: 0 };
      const emojiX = textCenter.x + emojiP.x;
      const emojiY = textCenter.y + emojiP.y;

      // Impulse target: the emoji point pushed a little further out along
      // its own vector from the shape's center — a quick "charging up"
      // pop before the real burst.
      const fromCenterX = emojiP.x;
      const fromCenterY = emojiP.y;
      const centerDist = Math.hypot(fromCenterX, fromCenterY) || 1;
      const impulseX = emojiX + (fromCenterX / centerDist) * 16;
      const impulseY = emojiY + (fromCenterY / centerDist) * 16;

      const angle = Math.random() * Math.PI * 2;
      const dist = 60 + Math.random() * 150;

      return {
        // Loose dust start: scattered around where the emoji will form.
        startX: textCenter.x + (Math.random() - 0.5) * 340,
        startY: textCenter.y + (Math.random() - 0.5) * 220,
        emojiX,
        emojiY,
        impulseX,
        impulseY,
        scatterX: emojiX + Math.cos(angle) * dist,
        scatterY: emojiY + Math.sin(angle) * dist,
        targetX: textCenter.x + p.x,
        targetY: textCenter.y + p.y,
        size: 1.6 + Math.random() * 2.2,
        seed: Math.random() * Math.PI * 2,
      };
    });

    const [r, g, b] = tier.colorRgb;
    const tForm = DURATIONS.form;
    const tImpulse = tForm + DURATIONS.impulse;
    const tExplode = tImpulse + DURATIONS.explode;
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

        if (elapsed < tForm) {
          const t = easeInOutQuad(elapsed / DURATIONS.form);
          x = lerp(particle.startX, particle.emojiX, t);
          y = lerp(particle.startY, particle.emojiY, t);
          alpha = Math.min(1, elapsed / (DURATIONS.form * 0.5));
          radius = particle.size * (0.5 + 0.5 * t);
        } else if (elapsed < tImpulse) {
          // Triangular envelope: push out from the emoji shape, then snap
          // back — the "impulse" before it bursts apart.
          const t = (elapsed - tForm) / DURATIONS.impulse;
          const e = Math.sin(t * Math.PI);
          x = lerp(particle.emojiX, particle.impulseX, e);
          y = lerp(particle.emojiY, particle.impulseY, e);
          alpha = 1;
          radius = particle.size * (1 + 0.35 * e);
        } else if (elapsed < tExplode) {
          const t = easeOutCubic((elapsed - tImpulse) / DURATIONS.explode);
          x = lerp(particle.emojiX, particle.scatterX, t);
          y = lerp(particle.emojiY, particle.scatterY, t);
          alpha = 1;
          radius = particle.size;
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

  // Clicking the settled badge explains what it actually is: a paid,
  // decorative perk — not an identity check. Required disclosure (see
  // Terms): the badge is a subscription benefit, and the user is
  // acknowledging they paid for a decorative seal, not a verification.
  function attachInfoPopover(badge, tier) {
    let popover = null;

    function closePopover() {
      if (!popover) return;
      popover.remove();
      popover = null;
      document.removeEventListener('click', onOutsideClick, true);
      document.removeEventListener('keydown', onKeydown);
      badge.setAttribute('aria-expanded', 'false');
    }

    function onOutsideClick(e) {
      if (popover && !popover.contains(e.target) && e.target !== badge) closePopover();
    }

    function onKeydown(e) {
      if (e.key === 'Escape') closePopover();
    }

    function openPopover() {
      popover = document.createElement('div');
      popover.className = 'vip-info-popover';
      popover.setAttribute('role', 'dialog');
      popover.setAttribute('aria-label', 'Qué significa la insignia VIP');

      const title = document.createElement('p');
      title.className = 'vip-info-title';
      title.textContent = tier.emoji + ' Insignia VIP — ' + tier.label;

      const body = document.createElement('p');
      body.textContent =
        'Es un beneficio de tu suscripción de pago, no una verificación de identidad. ' +
        'Al activarla confirmas que pagaste por este sello decorativo, nada más.';

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'vip-info-close';
      closeBtn.textContent = 'Entendido';
      closeBtn.addEventListener('click', closePopover);

      popover.append(title, body, closeBtn);
      document.body.appendChild(popover);

      const rect = badge.getBoundingClientRect();
      const popRect = popover.getBoundingClientRect();
      let left = rect.left + rect.width / 2 - popRect.width / 2;
      left = Math.max(12, Math.min(left, window.innerWidth - popRect.width - 12));
      let top = rect.bottom + 10;
      if (top + popRect.height > window.innerHeight - 12) {
        top = rect.top - popRect.height - 10;
      }
      popover.style.left = left + 'px';
      popover.style.top = top + 'px';

      badge.setAttribute('aria-expanded', 'true');
      closeBtn.focus();

      // Deferred so the click that opened the popover doesn't also close it
      // via the outside-click listener.
      setTimeout(() => {
        document.addEventListener('click', onOutsideClick, true);
        document.addEventListener('keydown', onKeydown);
      }, 0);
    }

    badge.addEventListener('click', () => {
      if (popover) closePopover();
      else openPopover();
    });
  }

  // VIP badge next to a profile's name. The first time a visitor opens a
  // given profile, the emoji explodes into particles that form the tier
  // word, then settles into a small static badge. Every visit after that
  // (tracked per-browser via localStorage) skips straight to the static
  // badge. Clicking the settled badge explains it's a paid decorative
  // perk, not identity verification.
  function renderVipBadge(profile) {
    const tier = TIERS[profile.vip_tier];
    if (!tier) return;

    const nameEl = document.getElementById('main-name');
    if (!nameEl) return;

    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'vip-badge';
    badge.textContent = tier.emoji;
    badge.title = 'VIP — ' + tier.label;
    badge.setAttribute('aria-label', 'Insignia VIP: ' + tier.label + '. Toca para más información.');
    badge.setAttribute('aria-haspopup', 'dialog');
    badge.setAttribute('aria-expanded', 'false');
    nameEl.appendChild(badge);

    attachInfoPopover(badge, tier);

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
