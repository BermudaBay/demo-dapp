"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

export type SwapAnimPhase =
  | "unshield"
  | "swap"
  | "reshield"
  | "sending"
  | "confirming"
  | "success"
  | "error";

interface SwapAnimationOverlayProps {
  phase: SwapAnimPhase;
  fromToken: string;
  toToken: string;
  fromLogo: string;
  toLogo: string;
  message: string;
  subMessage?: string;
  txHash?: string;
  onDone?: () => void;
  autoDismiss?: number;
}

export default function SwapAnimationOverlay({
  phase,
  fromToken,
  toToken,
  fromLogo,
  toLogo,
  message,
  subMessage,
  txHash,
  onDone,
  autoDismiss = 3500,
}: SwapAnimationOverlayProps) {
  const [visible, setVisible] = useState(true);
  const [showToFace, setShowToFace] = useState(false);

  useEffect(() => {
    if (phase === "swap") {
      const t = setTimeout(() => setShowToFace(true), 500);
      return () => clearTimeout(t);
    }
    if (phase === "reshield" || phase === "sending" || phase === "confirming" || phase === "success") {
      queueMicrotask(() => setShowToFace(true));
    }
  }, [phase]);

  useEffect(() => {
    if (phase === "success" && autoDismiss > 0) {
      const timer = setTimeout(() => {
        setVisible(false);
        onDone?.();
      }, autoDismiss);
      return () => clearTimeout(timer);
    }
  }, [phase, autoDismiss, onDone]);

  if (!visible) return null;

  const isTerminal = phase === "success" || phase === "error";
  const dismiss = () => {
    if (isTerminal) { setVisible(false); onDone?.(); }
  };

  const phaseSteps: SwapAnimPhase[] = ["unshield", "swap", "reshield"];
  const activeIdx = phaseSteps.indexOf(phase);
  const isPastReshield = ["sending", "confirming", "success"].includes(phase);

  const coinLeft =
    phase === "unshield"
      ? "16px"
      : phase === "swap"
        ? "calc(50% - 22px)"
        : "calc(100% - 60px)";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-sm"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("a")) dismiss();
      }}
    >
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-8 flex flex-col items-center gap-5 max-w-sm w-[340px] mx-4 animate-in">

        {/* Main animation area */}
        {!isTerminal && (
          <div className="relative w-[220px] h-[100px] flex items-center justify-center">
            {/* Dotted path line */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 220 100">
              <line
                x1="46" y1="50" x2="174" y2="50"
                stroke="var(--border)"
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity="0.5"
              />
              <polygon points="108,46 116,50 108,54" fill="var(--border)" opacity="0.4" />
            </svg>

            {/* Shield left (source) */}
            <div className="absolute left-0 top-1/2 -translate-y-1/2">
              <ShieldIcon
                active={phase === "unshield"}
                opening={phase === "unshield"}
                locked={false}
                color="var(--text-tertiary)"
              />
            </div>

            {/* Shield right (destination) */}
            <div className="absolute right-0 top-1/2 -translate-y-1/2">
              <ShieldIcon
                active={isPastReshield || phase === "reshield"}
                opening={false}
                locked={isPastReshield}
                color={isPastReshield ? "var(--green)" : "var(--text-tertiary)"}
              />
            </div>

            {/* Moving token coin */}
            <div
              className="absolute top-1/2 -translate-y-1/2 z-10"
              style={{
                left: coinLeft,
                transition: "left 800ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              <div
                className={`relative w-11 h-11 ${phase === "swap" ? "swap-coin-flip-anim" : ""}`}
                style={{ transformStyle: phase === "swap" ? "preserve-3d" : undefined }}
              >
                {/* From token face */}
                <div
                  className={`absolute inset-0 rounded-full shadow-md flex items-center justify-center bg-[var(--bg)] border border-[var(--border)] transition-opacity duration-200 ${
                    showToFace && phase !== "swap" ? "opacity-0 pointer-events-none" : "opacity-100"
                  }`}
                  style={phase === "swap" ? { backfaceVisibility: "hidden" } : undefined}
                >
                  <img src={fromLogo} alt={fromToken} className="w-8 h-8 rounded-full" />
                </div>
                {/* To token face */}
                <div
                  className={`absolute inset-0 rounded-full shadow-md flex items-center justify-center bg-[var(--bg)] border border-[var(--border)] transition-opacity duration-200 ${
                    !showToFace && phase !== "swap" ? "opacity-0 pointer-events-none" : "opacity-100"
                  }`}
                  style={phase === "swap" ? { backfaceVisibility: "hidden", transform: "rotateY(180deg)" } : undefined}
                >
                  <img src={toLogo} alt={toToken} className="w-8 h-8 rounded-full" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Phase progress bar */}
        {!isTerminal && (
          <div className="flex items-center gap-1 w-full px-2">
            {phaseSteps.map((step, i) => {
              const isCurrent = step === phase || (isPastReshield && i === 2);
              const isDone = i < activeIdx || isPastReshield;
              const labels = ["Unshield", "Swap", "Reshield"];
              return (
                <div key={step} className="flex-1 flex flex-col items-center gap-1.5">
                  <div
                    className={`h-1 w-full rounded-full transition-all duration-500 ${
                      isDone
                        ? "bg-[var(--green)]"
                        : isCurrent
                          ? "bg-[var(--primary)] swap-bar-pulse"
                          : "bg-[var(--border)]"
                    }`}
                  />
                  <span
                    className={`text-[10px] font-medium transition-colors duration-300 ${
                      isCurrent
                        ? "text-[var(--text)]"
                        : isDone
                          ? "text-[var(--green)]"
                          : "text-[var(--text-tertiary)]"
                    }`}
                  >
                    {labels[i]}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Success display */}
        {phase === "success" && (
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center shadow-sm swap-fade-in">
                <img src={fromLogo} alt={fromToken} className="w-9 h-9 rounded-full opacity-50" />
              </div>
              <svg
                width="24" height="24" viewBox="0 0 24 24"
                className="text-[var(--green)] swap-fade-in"
                style={{ animationDelay: "0.15s" }}
              >
                <path
                  d="M5 12h14M13 6l6 6-6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div
                className="w-12 h-12 rounded-full bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center shadow-sm swap-fade-in"
                style={{ animationDelay: "0.3s" }}
              >
                <img src={toLogo} alt={toToken} className="w-9 h-9 rounded-full" />
              </div>
            </div>
            <div className="w-10 h-10 animate-success-pop">
              <svg viewBox="0 0 48 48" className="w-10 h-10">
                <circle cx="24" cy="24" r="22" fill="var(--green-bg)" stroke="var(--green)" strokeWidth="1.5" />
                <path
                  d="M15 24 L21 30 L33 18"
                  fill="none"
                  stroke="var(--green)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="animate-check-draw"
                />
              </svg>
            </div>
          </div>
        )}

        {/* Error display */}
        {phase === "error" && (
          <div className="w-12 h-12 animate-success-pop">
            <svg viewBox="0 0 48 48" className="w-12 h-12">
              <circle cx="24" cy="24" r="22" fill="var(--red-bg)" stroke="var(--red)" strokeWidth="1.5" />
              <path
                d="M17 17 L31 31 M31 17 L17 31"
                fill="none"
                stroke="var(--red)"
                strokeWidth="2.5"
                strokeLinecap="round"
                className="animate-check-draw"
              />
            </svg>
          </div>
        )}

        {/* Message text */}
        <div className="text-center">
          <p className="text-sm font-semibold">{message}</p>
          {subMessage && (
            <p className="text-xs text-[var(--text-secondary)] mt-1">{subMessage}</p>
          )}
        </div>

        {/* Spinner for sending/confirming */}
        {(phase === "sending" || phase === "confirming") && (
          <div className="w-5 h-5">
            <svg className="w-5 h-5 animate-spin" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="8" fill="none" stroke="var(--border)" strokeWidth="2" />
              <circle cx="10" cy="10" r="8" fill="none" stroke="var(--text)" strokeWidth="2" strokeDasharray="16 34" strokeLinecap="round" />
            </svg>
          </div>
        )}

        {/* Explorer link on success */}
        {phase === "success" && txHash && (
          <a
            href={`https://base-sepolia.blockscout.com/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="animate-fade-up flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text)] transition-colors"
          >
            View on Explorer
            <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  );
}

function ShieldIcon({
  active,
  opening,
  locked,
  color,
}: {
  active: boolean;
  opening: boolean;
  locked: boolean;
  color: string;
}) {
  return (
    <svg
      width="36"
      height="42"
      viewBox="0 0 36 42"
      className={`transition-all duration-700 ${active ? "opacity-100" : "opacity-40"}`}
    >
      <path
        d="M18 2 L32 8 L32 22 Q32 36 18 40 Q4 36 4 22 L4 8 Z"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        className={opening ? "swap-shield-open" : ""}
      />
      {locked && (
        <g className="swap-lock-appear">
          <rect x="13" y="20" width="10" height="8" rx="1.5" fill="none" stroke={color} strokeWidth="1" />
          <path d="M15 20 L15 16 Q15 12 18 12 Q21 12 21 16 L21 20" fill="none" stroke={color} strokeWidth="1" />
        </g>
      )}
    </svg>
  );
}
