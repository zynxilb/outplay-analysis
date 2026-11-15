"use client";

import { useMemo } from "react";
import type { RefutationLine } from "@/lib/analysis/core/types";
import { renderRefutation } from "@/lib/analysis/explain/refutation-ar";

export function RefutationPanel({
  ply,
  refutation,
  onViewAlternative,
  canViewAlternative,
}: {
  ply: number;
  refutation: RefutationLine | undefined;
  onViewAlternative?: () => void;
  canViewAlternative?: boolean;
}) {
  const localized = useMemo(() => {
    if (!refutation) return null;
    try {
      return renderRefutation(refutation);
    } catch {
      return null;
    }
  }, [refutation]);

  if (ply === 0 || !localized) return null;

  return (
    <div className="bg-[#16171B] border border-[#1F2229] p-4 space-y-3">
      <h3 className="text-xs font-semibold text-[#8B8F98] uppercase tracking-wide">
        البديل الأفضل
      </h3>
      <p className="text-[#EEEEEE] leading-relaxed">{localized.text}</p>
      {canViewAlternative && onViewAlternative && (
        <button
          onClick={onViewAlternative}
          className="w-full text-sm bg-[#7FB069]/10 hover:bg-[#7FB069]/20 text-[#7FB069] border border-[#7FB069]/30 px-3 py-2 transition-colors"
        >
          شاهد البديل على الرقعة ←
        </button>
      )}
    </div>
  );
}
