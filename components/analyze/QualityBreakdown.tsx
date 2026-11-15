"use client";

import type { ClassifiedMove, QualityLevel } from "@/lib/analysis/core/types";

const QUALITY_COLOR: Record<QualityLevel, string> = {
  Best: "#7FB069",
  Excellent: "#92C27F",
  Good: "#A0AEC0",
  Inaccuracy: "#E0B252",
  Mistake: "#E0895C",
  Blunder: "#D84040",
};

const QUALITY_LABEL: Record<QualityLevel, string> = {
  Best: "الأفضل",
  Excellent: "ممتاز",
  Good: "جيد",
  Inaccuracy: "عدم دقة",
  Mistake: "خطأ",
  Blunder: "خطأ فادح",
};

const ORDER: readonly QualityLevel[] = [
  "Blunder",
  "Mistake",
  "Inaccuracy",
  "Good",
  "Excellent",
  "Best",
];

export function QualityBreakdown({
  moves,
}: {
  moves: readonly ClassifiedMove[];
}) {
  if (moves.length === 0) return null;

  const counts = new Map<QualityLevel, number>();
  for (const m of moves) {
    counts.set(m.quality, (counts.get(m.quality) ?? 0) + 1);
  }

  const visible = ORDER.filter((q) => (counts.get(q) ?? 0) > 0);
  if (visible.length === 0) return null;

  return (
    <div className="bg-[#16171B] border border-[#1F2229] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-[#8B8F98] uppercase tracking-wide">
          ملخص الجودة
        </h3>
        <span className="text-xs text-[#6D6D75]">
          {moves.length} نقلة
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((q) => {
          const c = counts.get(q) ?? 0;
          return (
            <span
              key={q}
              className="text-xs px-2 py-0.5 rounded"
              style={{
                backgroundColor: `${QUALITY_COLOR[q]}22`,
                color: QUALITY_COLOR[q],
              }}
            >
              {QUALITY_LABEL[q]}: {c}
            </span>
          );
        })}
      </div>
    </div>
  );
}
