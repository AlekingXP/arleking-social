"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { VipTier } from "@/lib/types";
import { markVipRevealSeen, useVipRevealSeen } from "./useVipRevealSeen";
import VipRevealCanvas from "./VipRevealCanvas";
import { TIERS } from "./tiers";

interface Props {
  tier: VipTier | null;
  /** Profile slug — scopes the "seen it already" flag to this specific profile. */
  slug: string;
}

interface PopoverPosition {
  left: number;
  top: number;
}

/**
 * VIP badge shown next to a profile's name. The first time a visitor opens a
 * given profile, the emoji explodes into particles that form the tier word,
 * then settles into a small static badge. Every visit after that (tracked
 * per-browser via localStorage) skips straight to the small static badge.
 *
 * Clicking the settled badge just confirms the tier to visitors. The Terms
 * disclosure (badge = paid decorative perk, not identity verification) is
 * shown to the subscriber in the admin dashboard when they activate it —
 * that's who needs to acknowledge it, not every visitor.
 */
export default function VipBadge({ tier, slug }: Props) {
  const badgeRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const alreadySeen = useVipRevealSeen(slug);
  const [justRevealed, setJustRevealed] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<PopoverPosition | null>(null);

  // alreadySeen === null only during the SSR/first-hydration pass, before
  // localStorage can be read — render the badge invisible until we know.
  const settled = alreadySeen === true || justRevealed;
  const revealing = alreadySeen === false && !justRevealed;

  // useLayoutEffect (not useEffect) because the popover's own position
  // depends on measuring its just-rendered DOM node — it must run
  // synchronously before paint, both to have something to measure and to
  // avoid a visible flash at the wrong spot.
  useLayoutEffect(() => {
    if (!infoOpen) return;

    function positionPopover() {
      const badge = badgeRef.current;
      const popover = popoverRef.current;
      if (!badge || !popover) return;
      const rect = badge.getBoundingClientRect();
      const popRect = popover.getBoundingClientRect();
      let left = rect.left + rect.width / 2 - popRect.width / 2;
      left = Math.max(12, Math.min(left, window.innerWidth - popRect.width - 12));
      let top = rect.bottom + 10;
      if (top + popRect.height > window.innerHeight - 12) top = rect.top - popRect.height - 10;
      setPopoverPos({ left, top });
    }
    positionPopover();

    function onOutsideClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        e.target !== badgeRef.current
      ) {
        setInfoOpen(false);
      }
    }
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") setInfoOpen(false);
    }

    document.addEventListener("click", onOutsideClick, true);
    document.addEventListener("keydown", onKeydown);
    return () => {
      document.removeEventListener("click", onOutsideClick, true);
      document.removeEventListener("keydown", onKeydown);
      setPopoverPos(null);
    };
  }, [infoOpen]);

  if (!tier) return null;
  const config = TIERS[tier];

  function handleRevealComplete() {
    markVipRevealSeen(slug);
    setJustRevealed(true);
  }

  return (
    <>
      <button
        ref={badgeRef}
        type="button"
        onClick={() => settled && setInfoOpen((open) => !open)}
        className={`inline-flex items-center border-0 bg-transparent p-0 leading-none transition-opacity duration-300 ${
          settled
            ? "cursor-pointer opacity-100 hover:scale-110"
            : "pointer-events-none cursor-default opacity-0"
        }`}
        style={settled ? { filter: `drop-shadow(0 0 4px ${config.glowCss})` } : undefined}
        title={`VIP — ${config.label}`}
        aria-label={`Insignia VIP: ${config.label}. Toca para más detalles.`}
        aria-haspopup="dialog"
        aria-expanded={infoOpen}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- small inline data-URI icon, not a page asset next/image needs to optimize */}
        <img src={config.icon} alt="" width={22} height={22} />
      </button>

      {revealing && (
        <VipRevealCanvas anchorRef={badgeRef} tier={config} onComplete={handleRevealComplete} />
      )}

      {infoOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Insignia VIP"
          className="fixed z-[1000] w-60 rounded-2xl border border-white/10 bg-[#150a10] p-4 text-left text-sm shadow-2xl"
          // Rendered off-screen and invisible until positionPopover (above)
          // measures it and supplies real coordinates, one paint later.
          style={{
            left: popoverPos?.left ?? -9999,
            top: popoverPos?.top ?? -9999,
            visibility: popoverPos ? "visible" : "hidden",
          }}
        >
          {/* Just confirms the tier to visitors. The Terms disclosure
              (badge = paid decorative perk, not identity verification) is
              shown to the subscriber in the admin dashboard when they
              activate it — that's who needs to acknowledge it. */}
          <p className="mb-1.5 flex items-center gap-1.5 font-bold text-[#ffcd46]">
            {/* eslint-disable-next-line @next/next/no-img-element -- small inline data-URI icon */}
            <img src={config.icon} alt="" width={18} height={18} />
            Cliente VIP
          </p>
          <p className="mb-2.5 text-neutral-400">{config.label}</p>
          <button
            type="button"
            onClick={() => setInfoOpen(false)}
            className="block w-full rounded-full border border-white/20 bg-white/5 py-1.5 text-xs font-semibold text-neutral-100 hover:bg-white/10"
          >
            Cerrar
          </button>
        </div>
      )}
    </>
  );
}
