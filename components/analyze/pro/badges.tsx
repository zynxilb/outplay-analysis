// components/analyze/pro/badges.tsx

import React from "react";
import { QUALITY_META, type MoveQuality } from "./quality";

export function DestinationQualityBadge({ quality }: { quality: MoveQuality }) {
  const meta = QUALITY_META[quality];
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-6 h-6 absolute -top-1.5 -right-1.5 z-20 drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)] pointer-events-none"
      aria-label={meta.labelAr}
    >
      <circle cx="12" cy="12" r="11" fill={meta.badgeBg} stroke="#090A0D" strokeWidth="1.75" />
      {quality === 'best' ? (
        <path
          d="M12 5.4l1.85 3.75 4.15.6-3 2.92.71 4.13L12 14.85l-3.71 1.95.71-4.13-3-2.92 4.15-.6L12 5.4z"
          fill={meta.badgeText}
        />
      ) : (
        <text
          x="12"
          y="15.8"
          textAnchor="middle"
          fill={meta.badgeText}
          fontSize="11.5"
          fontWeight="800"
          fontFamily="JetBrains Mono, monospace"
        >
          {meta.symbol}
        </text>
      )}
    </svg>
  );
}

export function InlineQualityDot({ quality }: { quality: MoveQuality }) {
  if (quality === 'book') return null;
  const meta = QUALITY_META[quality];
  return (
    <svg viewBox="0 0 16 16" className="w-4 h-4 shrink-0 inline-block" aria-hidden="true">
      <circle cx="8" cy="8" r="7.5" fill={meta.badgeBg} />
      {quality === 'best' ? (
        <path
          d="M8 3.6l1.2 2.5 2.7.4-2 1.9.5 2.7-2.4-1.3-2.4 1.3.5-2.7-2-1.9 2.7-.4L8 3.6z"
          fill={meta.badgeText}
        />
      ) : (
        <text
          x="8"
          y="10.8"
          textAnchor="middle"
          fill={meta.badgeText}
          fontSize="8.2"
          fontWeight="800"
          fontFamily="JetBrains Mono, monospace"
        >
          {meta.symbol}
        </text>
      )}
    </svg>
  );
}
