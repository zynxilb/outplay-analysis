// components/analyze/pro/quality.ts
// Quality metadata + mapping from our certified classifier.

import type { Annotation, ClassifiedMove, QualityLevel } from "@/lib/analysis/core/types";

export type MoveQuality =
  | "brilliant"
  | "best"
  | "excellent"
  | "good"
  | "book"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export interface QualityMeta {
  labelAr: string;
  symbol: string;
  badgeBg: string;
  badgeText: string;
  pillClasses: string;
}

export const QUALITY_META: Record<MoveQuality, QualityMeta> = {
  brilliant: {
    labelAr: "نقلة عبقرية",
    symbol: "!!",
    badgeBg: "#10B981",
    badgeText: "#FFFFFF",
    pillClasses: "bg-[#10B981]/15 text-[#34D399] border-[#10B981]/40",
  },
  best: {
    labelAr: "أفضل نقلة",
    symbol: "★",
    badgeBg: "#10B981",
    badgeText: "#FFFFFF",
    pillClasses: "bg-[#10B981]/15 text-[#34D399] border-[#10B981]/35",
  },
  excellent: {
    labelAr: "نقلة ممتازة",
    symbol: "!",
    badgeBg: "#38BDF8",
    badgeText: "#0D0E11",
    pillClasses: "bg-sky-500/15 text-sky-300 border-sky-400/35",
  },
  good: {
    labelAr: "نقلة جيدة",
    symbol: "✓",
    badgeBg: "#94A3B8",
    badgeText: "#0D0E11",
    pillClasses: "bg-slate-500/15 text-slate-300 border-slate-400/35",
  },
  book: {
    labelAr: "نقلة كتاب",
    symbol: "•",
    badgeBg: "#71717A",
    badgeText: "#FFFFFF",
    pillClasses: "bg-zinc-500/15 text-zinc-300 border-zinc-500/35",
  },
  inaccuracy: {
    labelAr: "عدم دقة",
    symbol: "?!",
    badgeBg: "#F59E0B",
    badgeText: "#0D0E11",
    pillClasses: "bg-amber-500/15 text-amber-300 border-amber-400/35",
  },
  mistake: {
    labelAr: "خطأ",
    symbol: "?",
    badgeBg: "#F97316",
    badgeText: "#FFFFFF",
    pillClasses: "bg-orange-500/15 text-orange-300 border-orange-400/35",
  },
  blunder: {
    labelAr: "بلندر",
    symbol: "??",
    badgeBg: "#D84040",
    badgeText: "#FFFFFF",
    pillClasses: "bg-[#D84040]/20 text-[#FCA5A5] border-[#D84040]/50",
  },
};

export function qualityFromClassified(move: ClassifiedMove): MoveQuality {
  const annotations = new Set<Annotation>(move.annotations);
  if (annotations.has("BRILLIANT")) return "brilliant";
  if (annotations.has("BOOK")) return "book";

  const q: QualityLevel = move.quality;
  switch (q) {
    case "Best":
      return "best";
    case "Excellent":
      return "excellent";
    case "Good":
      return "good";
    case "Inaccuracy":
      return "inaccuracy";
    case "Mistake":
      return "mistake";
    case "Blunder":
      return "blunder";
  }
}
