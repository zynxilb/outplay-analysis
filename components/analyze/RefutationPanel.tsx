"use client";

import { useMemo } from "react";
import type { RefutationLine } from "@/lib/analysis/core/types";
import { renderRefutation } from "@/lib/analysis/explain/refutation-ar";

export function RefutationPanel({
  ply,
  refutation,
}: {
  ply: number;
  refutation: RefutationLine | undefined;
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
    <div className="bg-[#16171B] border border-[#1F2229] p-4 space-y-2">
      <h3 className="text-xs font-semibold text-[#8B8F98] uppercase tracking-wide">
        البديل الأفضل
      </h3>
      <p className="text-[#EEEEEE] leading-relaxed">{localized.text}</p>
    </div>
  );
}
