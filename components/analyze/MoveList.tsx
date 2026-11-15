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

export function MoveList({
  moves,
  selectedPly,
  onSelect,
}: {
  moves: readonly ClassifiedMove[];
  selectedPly: number;
  onSelect: (ply: number) => void;
}) {
  const rows: { n: number; white?: ClassifiedMove; black?: ClassifiedMove }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({
      n: Math.floor(i / 2) + 1,
      white: moves[i],
      black: moves[i + 1],
    });
  }

  return (
    <div className="bg-[#16171B] border border-[#1F2229] p-3">
      <h3 className="text-xs font-semibold text-[#8B8F98] uppercase tracking-wide mb-2">
        النقلات
      </h3>
      <div className="space-y-0.5 max-h-96 overflow-y-auto">
        {rows.map(({ n, white, black }) => (
          <div
            key={n}
            className="flex items-center gap-1 text-sm"
          >
            <span
              className="w-8 text-end text-[#6D6D75] font-mono"
              dir="ltr"
            >
              {n}.
            </span>
            {white && (
              <MoveChip
                move={white}
                selected={white.ply === selectedPly}
                onSelect={() => onSelect(white.ply)}
              />
            )}
            {black && (
              <MoveChip
                move={black}
                selected={black.ply === selectedPly}
                onSelect={() => onSelect(black.ply)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MoveChip({
  move,
  selected,
  onSelect,
}: {
  move: ClassifiedMove;
  selected: boolean;
  onSelect: () => void;
}) {
  const color = QUALITY_COLOR[move.quality] ?? "#8B8F98";
  return (
    <button
      onClick={onSelect}
      title={QUALITY_LABEL[move.quality]}
      className={`flex-1 text-start px-2 py-1 rounded transition-colors ${
        selected ? "bg-[#1F2229]" : "hover:bg-[#1A1B1F]"
      }`}
      style={{
        borderInlineStartWidth: 3,
        borderInlineStartStyle: "solid",
        borderInlineStartColor: color,
      }}
    >
      <span
        dir="ltr"
        className="inline-block"
        style={{ fontFamily: "var(--font-jetbrains-mono)" }}
      >
        {move.san}
      </span>
    </button>
  );
}
