"use client";

import { useEffect, useRef, type RefObject } from "react";
import { sampleTextPoints } from "./particleText";
import type { TierConfig } from "./tiers";

interface Props {
  anchorRef: RefObject<HTMLElement | null>;
  tier: TierConfig;
  onComplete: () => void;
}

// Four-beat reveal: burst out from the badge, converge into the tier word,
// hold with a shimmer, then collapse back down into the badge spot.
const DURATIONS = { explode: 450, converge: 900, hold: 700, collapse: 500 } as const;

interface Particle {
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
    const letterPoints = sampleTextPoints(tier.word, { fontPx, maxPoints: 320 });

    const particles: Particle[] = letterPoints.map((p) => {
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
