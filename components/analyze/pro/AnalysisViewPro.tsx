"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Chess, type Square } from "chess.js";
import {
  ChevronLeft,
  ChevronRight,
  FlipVertical2,
  RotateCcw,
  Star,
  Swords,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { AnalyzedGame } from "@/lib/analysis/core/types";
import { ChessPieceSvg } from "./pieces";
import { DestinationQualityBadge, InlineQualityDot } from "./badges";
import { QUALITY_META } from "./quality";
import { playChessTone } from "./audio";
import { buildTimelineFromGame, type ComputedPly } from "./timeline";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;

function squareToXY(square: Square, isFlipped: boolean): { x: number; y: number } {
  const fIdx = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rIdx = RANKS.indexOf(square[1] as (typeof RANKS)[number]);
  const col = isFlipped ? 7 - fIdx : fIdx;
  const row = isFlipped ? 7 - rIdx : rIdx;
  return { x: col * 100 + 50, y: row * 100 + 50 };
}

function evalBarPercent(cp: number | null): number {
  if (cp === null) return 50;
  const clamped = Math.max(-800, Math.min(800, cp));
  return Math.round(50 + (clamped / 800) * 42);
}

export function AnalysisViewPro({
  game,
  pgn,
  onReset,
}: {
  game: AnalyzedGame;
  pgn: string;
  onReset: () => void;
}) {
  const timeline = useMemo(() => buildTimelineFromGame(game, pgn), [game, pgn]);
  const [currentPly, setCurrentPly] = useState<number>(timeline.length);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [showBestArrow, setShowBestArrow] = useState<boolean>(false);
  const [refutationStep, setRefutationStep] = useState<number | null>(null);

  const activePly: ComputedPly | null =
    currentPly > 0 ? timeline[currentPly - 1] ?? null : null;

  const displayState = useMemo(() => {
    if (refutationStep !== null && activePly && activePly.refutationLine.length > 0) {
      const step = activePly.refutationLine[refutationStep];
      return {
        fen: step.fen,
        from: step.from as Square | null,
        to: step.to as Square | null,
        badgeQuality: null,
        arrow: { from: step.from, to: step.to, color: "#D84040" } as
          | { from: Square; to: Square; color: string }
          | null,
      };
    }
    if (!activePly) {
      return {
        fen: new Chess().fen(),
        from: null as Square | null,
        to: null as Square | null,
        badgeQuality: null,
        arrow: null as { from: Square; to: Square; color: string } | null,
      };
    }
    const bestArrow =
      showBestArrow && activePly.bestMove
        ? {
            from: activePly.bestMove.from,
            to: activePly.bestMove.to,
            color: "#10B981",
          }
        : null;
    return {
      fen: activePly.fen,
      from: activePly.from,
      to: activePly.to,
      badgeQuality: activePly.quality,
      arrow: bestArrow,
    };
  }, [activePly, refutationStep, showBestArrow]);

  const chess = useMemo(() => new Chess(displayState.fen), [displayState.fen]);
  const board = useMemo(() => chess.board(), [chess]);

  const goToPly = useCallback(
    (target: number) => {
      const clamped = Math.max(0, Math.min(timeline.length, target));
      setRefutationStep(null);
      setShowBestArrow(false);
      setCurrentPly(clamped);
      if (clamped > 0) {
        const ply = timeline[clamped - 1];
        playChessTone(ply.isCapture ? "capture" : "move", soundEnabled);
      }
    },
    [soundEnabled, timeline]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPly(currentPly - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToPly(currentPly + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentPly, goToPly]);

  const toggleBestArrow = () => {
    setRefutationStep(null);
    setShowBestArrow((v) => !v);
  };

  const toggleRefutation = () => {
    setShowBestArrow(false);
    if (!activePly || activePly.refutationLine.length === 0) return;
    if (refutationStep === null) {
      setRefutationStep(0);
      playChessTone("move", soundEnabled);
    } else if (refutationStep + 1 < activePly.refutationLine.length) {
      setRefutationStep(refutationStep + 1);
      playChessTone("move", soundEnabled);
    } else {
      setRefutationStep(null);
    }
  };

  const coachDisplay = useMemo(() => {
    if (refutationStep !== null && activePly && activePly.refutationLine.length > 0) {
      const step = activePly.refutationLine[refutationStep];
      return {
        badgeLabel: "البديل الأفضل",
        badgeClasses: "bg-[#7FB069]/15 text-[#7FB069] border-[#7FB069]/40",
        movePrefix: "",
        moveSan: step.san,
        evalLabel: activePly.evalLabel,
        coachText: step.noteAr,
      };
    }
    if (!activePly) {
      return {
        badgeLabel: "بداية",
        badgeClasses: "bg-white/10 text-zinc-200 border-white/15",
        movePrefix: "",
        moveSan: "Start",
        evalLabel: "—",
        coachText: "اختر نقلة من القائمة لبدء المراجعة.",
      };
    }
    const meta = activePly.quality ? QUALITY_META[activePly.quality] : null;
    return {
      badgeLabel: meta ? meta.labelAr : "لم تُحلل",
      badgeClasses: meta ? meta.pillClasses : "bg-white/5 text-zinc-400 border-white/10",
      movePrefix: `${activePly.moveNumber}${activePly.color === "w" ? "." : "..."}`,
      moveSan: activePly.san,
      evalLabel: activePly.evalLabel,
      coachText: activePly.quality
        ? activePly.explanationAr ||
          "لا يوجد شرح متاح لهذه النقلة من بين القوالب المعتمدة."
        : "لم تُحلل هذه النقلة — لا يمكن عرض تصنيف أو شرح.",
    };
  }, [activePly, refutationStep]);

  const displayRanks = useMemo(
    () => (isFlipped ? [...RANKS].reverse() : [...RANKS]),
    [isFlipped]
  );
  const displayFiles = useMemo(
    () => (isFlipped ? [...FILES].reverse() : [...FILES]),
    [isFlipped]
  );

  const checkedKingSquare = useMemo<Square | null>(() => {
    if (!chess.inCheck()) return null;
    const turn = chess.turn();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = board[r][c];
        if (cell && cell.type === "k" && cell.color === turn) {
          return `${FILES[c]}${RANKS[r]}` as Square;
        }
      }
    }
    return null;
  }, [chess, board]);

  const hasBest = Boolean(activePly?.bestMove);
  const hasRefutation = Boolean(activePly && activePly.refutationLine.length > 0);
  const evalPct = evalBarPercent(activePly ? activePly.evalCp : null);

  // Empty state (bad PGN or empty analysis)
  if (timeline.length === 0) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-bold text-[#D84040]">تعذّر التحليل</h1>
          <p className="text-[#8B8F98]">
            لم نتمكن من تحليل هذه المباراة. تأكد من صحة صيغة PGN.
          </p>
          <button
            onClick={onReset}
            className="bg-[#D84040] hover:bg-[#B83535] text-white px-5 py-2 font-semibold"
          >
            حاول مرة أخرى
          </button>
        </div>
      </main>
    );
  }

  return (
    <div className="h-[100dvh] lg:h-screen w-screen overflow-hidden flex flex-col bg-[#090A0D] text-[#F8FAFC]">
      {/* Header */}
      <header className="h-11 px-3 lg:h-12 lg:px-4 shrink-0 border-b border-white/[0.06] flex items-center justify-between max-w-6xl w-full mx-auto">
        <div className="flex items-center gap-2.5" dir="ltr">
          <span className="font-mono text-sm font-bold tracking-tight text-[#F8FAFC] whitespace-nowrap shrink-0">
            Outplay
          </span>
        </div>
        <h1 className="text-xs sm:text-sm font-semibold text-[#CBD5E1] whitespace-nowrap shrink-0" dir="rtl">
          مراجعة المباراة
        </h1>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setIsFlipped((f) => !f)}
            title="قلب الرقعة"
            aria-label="قلب الرقعة"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.07] transition-colors"
          >
            <FlipVertical2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setSoundEnabled((s) => !s)}
            title={soundEnabled ? "كتم الصوت" : "تفعيل الصوت"}
            aria-label={soundEnabled ? "كتم الصوت" : "تفعيل الصوت"}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.07] transition-colors"
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={onReset}
            title="مباراة جديدة"
            aria-label="مباراة جديدة"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.07] transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Partial-analysis banner + device-speed note */}
      {game.status !== "complete" && (
        <div dir="rtl" className="shrink-0 px-3 lg:px-4 pt-2 max-w-6xl w-full mx-auto space-y-1">
          <div className="bg-[#E0B252]/10 border border-[#E0B252]/30 text-[#E0B252] text-xs sm:text-sm px-3 py-2 rounded-lg">
            تحليل جزئي — بعض النقلات لم تُحلَّل. النتائج الظاهرة مبنية على ما اكتمل فقط.
            {game.failures.length > 0 && (
              <span className="opacity-80">
                {" "}({game.failures.length} حالة فشل مسجلة)
              </span>
            )}
          </div>
          <p className="text-[11px] text-[#6D6D75] px-1">
            تنبيه: على الأجهزة البطيئة، قد تختلف دقة التصنيف عن الأجهزة الأسرع. استخدم جهازاً حديثاً للحصول على أفضل النتائج.
          </p>
        </div>
      )}

      {/* Workspace */}
      <main className="w-full flex-1 min-h-0 flex flex-col justify-between lg:max-w-6xl lg:mx-auto lg:px-4 lg:py-3 lg:grid lg:grid-cols-12 lg:gap-4 lg:items-center">
        {/* Mobile coach strip */}
        <div className="lg:hidden shrink-0 px-3 py-2" dir="rtl">
          <div className="bg-[#1A1E29] border-t border-white/15 border-x border-b border-white/[0.06] shadow-xl rounded-xl px-3 py-2 flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {activePly?.quality && refutationStep === null && (
                  <InlineQualityDot quality={activePly.quality} />
                )}
                <h2 className="text-[14px] font-bold text-[#F8FAFC] leading-tight whitespace-nowrap shrink-0">
                  {coachDisplay.badgeLabel}
                </h2>
                <span
                  dir="ltr"
                  style={{ unicodeBidi: "isolate" }}
                  className="inline-flex items-center font-mono text-xs font-bold text-white bg-white/[0.06] px-2 py-0.5 rounded-md tabular-nums whitespace-nowrap shrink-0"
                >
                  {coachDisplay.movePrefix
                    ? `${coachDisplay.movePrefix} ${coachDisplay.moveSan}`
                    : coachDisplay.moveSan}
                </span>
              </div>
              <span
                dir="ltr"
                style={{ unicodeBidi: "isolate" }}
                className="font-mono text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-md bg-[#090A0D]/80 border border-white/10 text-[#F8FAFC] whitespace-nowrap shrink-0"
              >
                {coachDisplay.evalLabel}
              </span>
            </div>
            <p className="text-[12.5px] leading-snug text-[#CBD5E1] line-clamp-2">
              {coachDisplay.coachText}
            </p>
          </div>
        </div>

        {/* Board column */}
        <section className="shrink-0 px-3 py-1 lg:p-0 lg:col-span-7 flex items-center justify-center lg:h-full lg:min-h-0">
          <div
            dir="ltr"
            className="relative w-full max-w-[min(100vw-1.5rem,46dvh)] lg:max-w-[calc(100vh-5rem)] lg:max-h-[calc(100vh-5rem)] aspect-square mx-auto rounded-xl overflow-hidden border border-white/10 bg-[#141720] shadow-[0_24px_60px_rgba(0,0,0,0.7)]"
          >
            <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
              {displayRanks.map((rank, rIdx) =>
                displayFiles.map((file, cIdx) => {
                  const sq = `${file}${rank}` as Square;
                  const isLight = (rIdx + cIdx) % 2 === 0;
                  const cell = board[RANKS.indexOf(rank)]?.[FILES.indexOf(file)] ?? null;
                  const isFrom = displayState.from === sq;
                  const isTo = displayState.to === sq;
                  const isKing = checkedKingSquare === sq;
                  return (
                    <div
                      key={sq}
                      className="relative flex items-center justify-center"
                      style={{
                        backgroundColor: isLight ? "#4B5366" : "#262A34",
                      }}
                    >
                      {/* File/rank labels */}
                      {rIdx === 7 && (
                        <span className="absolute bottom-0.5 left-1 text-[8px] sm:text-[9px] text-slate-500 font-mono pointer-events-none select-none">
                          {file}
                        </span>
                      )}
                      {cIdx === 0 && (
                        <span className="absolute top-0.5 left-1 text-[8px] sm:text-[9px] text-slate-500 font-mono pointer-events-none select-none">
                          {rank}
                        </span>
                      )}
                      {/* Highlights */}
                      {isFrom && (
                        <div className="absolute inset-0 bg-[#D84040]/25 pointer-events-none" />
                      )}
                      {isTo && (
                        <div className="absolute inset-0 bg-[#D84040]/20 border-2 border-[#D84040]/60 pointer-events-none" />
                      )}
                      {isKing && (
                        <div className="absolute inset-0 bg-[#D84040]/30 pointer-events-none" />
                      )}
                      {/* Piece */}
                      {cell && (
                        <div className="absolute inset-[7%] flex items-center justify-center">
                          <ChessPieceSvg type={cell.type} color={cell.color} />
                        </div>
                      )}
                      {/* Quality badge */}
                      {displayState.badgeQuality && isTo && (
                        <DestinationQualityBadge quality={displayState.badgeQuality} />
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Arrow overlay */}
            {displayState.arrow && (
              <svg
                viewBox="0 0 800 800"
                className="absolute inset-0 pointer-events-none"
                style={{ zIndex: 10 }}
              >
                <defs>
                  <marker
                    id="arrow-head"
                    markerWidth="6"
                    markerHeight="6"
                    refX="5"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0,0 L6,3 L0,6 Z" fill={displayState.arrow.color} />
                  </marker>
                </defs>
                <line
                  x1={squareToXY(displayState.arrow.from, isFlipped).x}
                  y1={squareToXY(displayState.arrow.from, isFlipped).y}
                  x2={squareToXY(displayState.arrow.to, isFlipped).x}
                  y2={squareToXY(displayState.arrow.to, isFlipped).y}
                  stroke={displayState.arrow.color}
                  strokeWidth="14"
                  strokeLinecap="round"
                  markerEnd="url(#arrow-head)"
                  opacity="0.9"
                />
              </svg>
            )}
          </div>
        </section>

        {/* Right column (desktop) */}
        <section className="hidden lg:flex lg:col-span-5 h-full max-h-[calc(100vh-5rem)] flex-col justify-between gap-3 min-h-0">
          {/* Coach card */}
          <div dir="rtl" className="bg-[#1A1E29] border border-white/15 rounded-xl p-4 space-y-2 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {activePly?.quality && refutationStep === null && (
                  <InlineQualityDot quality={activePly.quality} />
                )}
                <span
                  className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-md border ${coachDisplay.badgeClasses}`}
                >
                  {coachDisplay.badgeLabel}
                </span>
                <span
                  dir="ltr"
                  style={{ unicodeBidi: "isolate" }}
                  className="font-mono text-sm font-bold text-white bg-white/[0.06] px-2 py-0.5 rounded-md tabular-nums whitespace-nowrap"
                >
                  {coachDisplay.movePrefix
                    ? `${coachDisplay.movePrefix} ${coachDisplay.moveSan}`
                    : coachDisplay.moveSan}
                </span>
              </div>
              <span
                dir="ltr"
                style={{ unicodeBidi: "isolate" }}
                className="font-mono text-xs font-semibold tabular-nums px-2 py-0.5 rounded-md bg-[#090A0D]/80 border border-white/10 text-[#F8FAFC] whitespace-nowrap"
              >
                {coachDisplay.evalLabel}
              </span>
            </div>
            <p className="text-[13.5px] leading-relaxed text-[#CBD5E1]">
              {coachDisplay.coachText}
            </p>
          </div>

          {/* Move table */}
          <div dir="ltr" className="flex-1 min-h-0 overflow-y-auto bg-[#141519] border border-white/10 rounded-xl p-2 outplay-scroll">
            <div className="grid grid-cols-[auto_1fr_1fr] gap-x-2 gap-y-0.5 text-sm">
              {Array.from({ length: Math.ceil(timeline.length / 2) }, (_, rowIdx) => {
                const moveNum = rowIdx + 1;
                const whitePly = 2 * rowIdx;
                const blackPly = 2 * rowIdx + 1;
                const wMove = timeline[whitePly];
                const bMove = timeline[blackPly];
                return (
                  <div key={moveNum} className="contents">
                    <span className="font-mono text-xs text-slate-500 tabular-nums px-2 py-1 text-right">
                      {moveNum}.
                    </span>
                    {wMove ? (
                      <button
                        data-ply={wMove.plyIndex}
                        data-quality={wMove.quality ?? "unanalyzed"}
                        data-san={wMove.san}
                        onClick={() => goToPly(wMove.plyIndex)}
                        title={wMove.quality ? QUALITY_META[wMove.quality].labelAr : "لم تُحلل هذه النقلة"}
                        aria-label={wMove.quality ? QUALITY_META[wMove.quality].labelAr : "لم تُحلل هذه النقلة"}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-left transition-colors ${
                          wMove.plyIndex === currentPly
                            ? "bg-[#D84040]/20 border border-[#D84040]"
                            : "hover:bg-white/[0.04]"
                        } ${!wMove.quality ? "opacity-60" : ""}`}
                      >
                        {wMove.quality && <InlineQualityDot quality={wMove.quality} />}
                        <span className={`font-mono text-xs truncate ${wMove.quality ? "text-white" : "text-zinc-500"}`}>
                          {wMove.san}
                        </span>
                      </button>
                    ) : (
                      <span />
                    )}
                    {bMove ? (
                      <button
                        data-ply={bMove.plyIndex}
                        data-quality={bMove.quality ?? "unanalyzed"}
                        data-san={bMove.san}
                        onClick={() => goToPly(bMove.plyIndex)}
                        title={bMove.quality ? QUALITY_META[bMove.quality].labelAr : "لم تُحلل هذه النقلة"}
                        aria-label={bMove.quality ? QUALITY_META[bMove.quality].labelAr : "لم تُحلل هذه النقلة"}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-left transition-colors ${
                          bMove.plyIndex === currentPly
                            ? "bg-[#D84040]/20 border border-[#D84040]"
                            : "hover:bg-white/[0.04]"
                        } ${!bMove.quality ? "opacity-60" : ""}`}
                      >
                        {bMove.quality && <InlineQualityDot quality={bMove.quality} />}
                        <span className={`font-mono text-xs truncate ${bMove.quality ? "text-white" : "text-zinc-500"}`}>
                          {bMove.san}
                        </span>
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Controls */}
          <div className="space-y-2 shrink-0">
            {/* Eval bar */}
            <div className="flex items-center gap-2" dir="ltr">
              <span className="font-mono text-[10px] text-slate-500 tabular-nums w-10 text-right">
                {coachDisplay.evalLabel}
              </span>
              <div className="flex-1 h-1.5 bg-[#262A34] rounded-full overflow-hidden">
                <div
                  className="h-full bg-white transition-transform duration-200 ease-out"
                  style={{
                    width: "100%",
                    transform: `scaleX(${evalPct / 100})`,
                    transformOrigin: "left",
                  }}
                />
              </div>
            </div>

            {/* Nav buttons */}
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => goToPly(currentPly - 1)}
                disabled={currentPly === 0}
                className="h-9 bg-[#1A1E29] border border-white/10 rounded-lg text-slate-300 hover:text-white hover:bg-[#262A34] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                aria-label="السابق"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => goToPly(currentPly + 1)}
                disabled={currentPly === timeline.length}
                className="h-9 bg-[#1A1E29] border border-white/10 rounded-lg text-slate-300 hover:text-white hover:bg-[#262A34] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                aria-label="التالي"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Tactical actions */}
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={toggleBestArrow}
                disabled={!hasBest}
                className={`h-9 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                  showBestArrow
                    ? "bg-[#10B981]/20 border border-[#10B981]/50 text-[#34D399]"
                    : "bg-[#1A1E29] border border-white/10 text-slate-300 hover:text-white hover:bg-[#262A34] disabled:opacity-40 disabled:cursor-not-allowed"
                }`}
              >
                <Star className="w-3.5 h-3.5" />
                أفضل نقلة
              </button>
              <button
                onClick={toggleRefutation}
                disabled={!hasRefutation}
                className={`h-9 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                  refutationStep !== null
                    ? "bg-[#D84040]/20 border border-[#D84040]/50 text-[#FCA5A5]"
                    : "bg-[#1A1E29] border border-white/10 text-slate-300 hover:text-white hover:bg-[#262A34] disabled:opacity-40 disabled:cursor-not-allowed"
                }`}
              >
                <Swords className="w-3.5 h-3.5" />
                {refutationStep !== null ? "إنهاء التفنيد" : "إظهار التفنيد"}
              </button>
            </div>

            {/* Next CTA */}
            <button
              onClick={() => goToPly(currentPly + 1)}
              disabled={currentPly === timeline.length}
              className="w-full h-11 bg-[#D84040] hover:bg-[#B83535] disabled:bg-[#262A34] disabled:cursor-not-allowed text-white font-bold rounded-lg transition-colors"
            >
              {currentPly === timeline.length ? "نهاية المباراة" : "النقلة التالية"}
            </button>
          </div>
        </section>

        {/* Mobile move table + controls */}
        <div className="lg:hidden shrink-0 px-3 py-2 space-y-2">
          <div dir="ltr" className="overflow-x-auto outplay-scroll flex gap-1 pb-1">
            {timeline.map((ply) => (
              <button
                key={ply.plyIndex}
                onClick={() => goToPly(ply.plyIndex)}
                title={ply.quality ? QUALITY_META[ply.quality].labelAr : "لم تُحلل هذه النقلة"}
                aria-label={ply.quality ? QUALITY_META[ply.quality].labelAr : "لم تُحلل هذه النقلة"}
                className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono transition-colors ${
                  ply.plyIndex === currentPly
                    ? "bg-[#D84040]/20 border border-[#D84040] text-white"
                    : !ply.quality
                      ? "bg-[#1A1E29]/50 border border-white/5 text-zinc-500 opacity-60"
                      : "bg-[#1A1E29] border border-white/5 text-slate-300"
                }`}
              >
                {ply.quality && <InlineQualityDot quality={ply.quality} />}
                {ply.san}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-1">
            <button
              onClick={() => goToPly(currentPly - 1)}
              disabled={currentPly === 0}
              className="h-9 bg-[#1A1E29] border border-white/10 rounded-lg text-slate-300 hover:text-white disabled:opacity-40 flex items-center justify-center"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => goToPly(currentPly + 1)}
              disabled={currentPly === timeline.length}
              className="h-9 bg-[#1A1E29] border border-white/10 rounded-lg text-slate-300 hover:text-white disabled:opacity-40 flex items-center justify-center"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={toggleBestArrow}
              disabled={!hasBest}
              title={hasBest ? "إظهار أفضل نقلة" : "لا يوجد بديل متاح"}
              aria-label={hasBest ? "إظهار أفضل نقلة" : "لا يوجد بديل متاح"}
              className={`h-9 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 ${
                showBestArrow
                  ? "bg-[#10B981]/20 border border-[#10B981]/50 text-[#34D399]"
                  : "bg-[#1A1E29] border border-white/10 text-slate-300 disabled:opacity-40"
              }`}
            >
              <Star className="w-3 h-3" />
            </button>
            <button
              onClick={toggleRefutation}
              disabled={!hasRefutation}
              title={hasRefutation ? (refutationStep !== null ? "إنهاء التفنيد" : "إظهار التفنيد") : "لا يوجد تفنيد متاح"}
              aria-label={hasRefutation ? (refutationStep !== null ? "إنهاء التفنيد" : "إظهار التفنيد") : "لا يوجد تفنيد متاح"}
              className={`h-9 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 ${
                refutationStep !== null
                  ? "bg-[#D84040]/20 border border-[#D84040]/50 text-[#FCA5A5]"
                  : "bg-[#1A1E29] border border-white/10 text-slate-300 disabled:opacity-40"
              }`}
            >
              <Swords className="w-3 h-3" />
            </button>
          </div>
          <button
            onClick={() => goToPly(currentPly + 1)}
            disabled={currentPly === timeline.length}
            className="w-full h-10 bg-[#D84040] hover:bg-[#B83535] disabled:bg-[#262A34] disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors"
          >
            {currentPly === timeline.length ? "نهاية المباراة" : "النقلة التالية"}
          </button>
        </div>
      </main>
    </div>
  );
}
