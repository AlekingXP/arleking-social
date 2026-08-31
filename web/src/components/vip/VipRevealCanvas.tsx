"use client";

import { useEffect, useRef, type RefObject } from "react";
import { sampleTextPoints } from "./particleText";
import type { TierConfig } from "./tiers";

interface Props {
  anchorRef: RefObject<HTMLElement | null>;
  tier: TierConfig;
  onComplete: () => void;
}

// Six-beat reveal: loose dust converges into the emoji shape, the emoji
// charges up and bursts apart, the scattered particles converge again into
// the tier word, hold with a shimmer, then collapse back into the badge.
const DURATIONS = {
  form: 650,
  impulse: 180,
  explode: 420,
  converge: 850,
  hold: 650,
  collapse: 500,
} as const;

interface Particle {
  startX: number;
  startY: number;
  emojiX: number;
  emojiY: number;
  impulseX: number;
  impulseY: number;
  scatterX: number;
  scatterY: number;
  targetX: number;
  targetY: number;
  size: number;
  seed: number;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}
function easeInOutQuad(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Canvas 2D particle engine for the VIP badge reveal. This is the "renderer"
 * half of the reveal — VipBadge owns *when* to show it (first visit only).
 *
 * This is the tier-1 renderer in the eventual FPS-based degradation ladder
 * (Three.js -> Lottie -> CSS -> static PNG); Canvas 2D is a solid default on
 * its own and doesn't need WebGL, so it ships first. Swapping in Three.js
 * later means adding a sibling renderer behind the same anchorRef/tier/
 * onComplete contract, not touching VipBadge.
 */
export default function VipRevealCanvas({ anchorRef, tier, onComplete }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const anchorEl = anchorRef.current;
    if (!canvas || !anchorEl) {
      onComplete();
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      onComplete();
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      onComplete();
      return;
    }

    let rafId = 0;
    let cancelled = false;

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

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
    const wordPoints = sampleTextPoints(tier.word, { fontPx, maxPoints: 320 });
    const emojiPoints = sampleTextPoints(tier.emoji, { fontPx, maxPoints: 320 });

    const particles: Particle[] = wordPoints.map((p, i) => {
      const emojiP = emojiPoints.length ? emojiPoints[i % emojiPoints.length] : { x: 0, y: 0 };
      const emojiX = textCenter.x + emojiP.x;
      const emojiY = textCenter.y + emojiP.y;

      // Impulse target: the emoji point pushed a little further out along
      // its own vector from the shape's center — a quick "charging up"
      // pop before the real burst.
      const centerDist = Math.hypot(emojiP.x, emojiP.y) || 1;
      const impulseX = emojiX + (emojiP.x / centerDist) * 16;
      const impulseY = emojiY + (emojiP.y / centerDist) * 16;

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

    function frame(now: number) {
      if (cancelled) return;
      const elapsed = now - start;
      const w = canvas!.width;
      const h = canvas!.height;
      ctx!.clearRect(0, 0, w, h);

      if (elapsed >= tCollapse) {
        window.removeEventListener("resize", resize);
        onComplete();
        return;
      }

      ctx!.shadowColor = tier.glowCss;
      ctx!.shadowBlur = 10;

      for (const particle of particles) {
        let x: number;
        let y: number;
        let alpha: number;
        let radius: number;

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

        ctx!.beginPath();
        ctx!.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx!.arc(x, y, Math.max(0.2, radius), 0, Math.PI * 2);
        ctx!.fill();
      }

      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- anchor/tier/onComplete are read once per reveal by design; VipBadge never re-renders while this is mounted
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[999]"
      aria-hidden="true"
    />
  );
}
