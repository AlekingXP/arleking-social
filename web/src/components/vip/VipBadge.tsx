"use client";

import { useRef, useState } from "react";
import type { VipTier } from "@/lib/types";
import { markVipRevealSeen, useVipRevealSeen } from "./useVipRevealSeen";
import VipRevealCanvas from "./VipRevealCanvas";
import { TIERS } from "./tiers";

interface Props {
  tier: VipTier | null;
  /** Profile slug — scopes the "seen it already" flag to this specific profile. */
  slug: string;
}

/**
 * VIP badge shown next to a profile's name. The first time a visitor opens a
 * given profile, the emoji explodes into particles that form the tier word,
 * then settles into a small static badge. Every visit after that (tracked
 * per-browser via localStorage) skips straight to the small static badge.
 */
export default function VipBadge({ tier, slug }: Props) {
  const badgeRef = useRef<HTMLSpanElement>(null);
  const alreadySeen = useVipRevealSeen(slug);
  const [justRevealed, setJustRevealed] = useState(false);

  if (!tier) return null;
  const config = TIERS[tier];

  // alreadySeen === null only during the SSR/first-hydration pass, before
  // localStorage can be read — render the badge invisible until we know.
  const settled = alreadySeen === true || justRevealed;
  const revealing = alreadySeen === false && !justRevealed;

  function handleRevealComplete() {
    markVipRevealSeen(slug);
    setJustRevealed(true);
  }

  return (
    <>
      <span
        ref={badgeRef}
        className={`inline-flex items-center text-[1.05em] leading-none transition-opacity duration-300 ${
          settled ? "opacity-100" : "opacity-0"
        }`}
        style={settled ? { filter: `drop-shadow(0 0 4px ${config.glowCss})` } : undefined}
        title={`VIP — ${config.label}`}
        aria-label={`Insignia VIP: ${config.label}`}
      >
        {config.emoji}
      </span>
      {revealing && (
        <VipRevealCanvas anchorRef={badgeRef} tier={config} onComplete={handleRevealComplete} />
      )}
    </>
  );
}
