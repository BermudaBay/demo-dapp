"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

export type TxFlowType = "deposit" | "transfer" | "withdraw";

export type TxFlowPhase =
  | "approve"
  | "compliance"
  | "proving"
  | "sending"
  | "confirming"
  | "success"
  | "error";

interface TxFlowOverlayProps {
  flowType: TxFlowType;
  phase: TxFlowPhase;
  steps: string[];
  activeStep: number;
  tokenLogo: string;
  tokenName: string;
  message: string;
  subMessage?: string;
  txHash?: string;
  onDone?: () => void;
  autoDismiss?: number;
}

function WalletIcon({ color, active }: { color: string; active: boolean }) {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 36 36"
      className={`transition-all duration-700 ${active ? "opacity-100" : "opacity-40"}`}
    >
      <rect x="3" y="8" width="30" height="22" rx="3" fill="none" stroke={color} strokeWidth="1.5" />
      <rect x="3" y="8" width="30" height="7" rx="3" fill="none" stroke={color} strokeWidth="1.5" />
      <circle cx="25" cy="21" r="2" fill={color} opacity="0.5" />
    </svg>
  );
}

function ShieldIcon({
  color,
  active,
  locked,
  opening,
}: {
  color: string;
  active: boolean;
  locked: boolean;
  opening: boolean;
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

export default function TxFlowOverlay({
  flowType,
  phase,
  steps,
  activeStep,
  tokenLogo,
  tokenName,
  message,
  subMessage,
  txHash,
  onDone,
  autoDismiss = 3500,
}: TxFlowOverlayProps) {
  const [visible, setVisible] = useState(true);

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

  const isEarly =
    phase === "approve" || phase === "compliance" || phase === "proving";
  const isLate = phase === "sending" || phase === "confirming";
  const isDone = phase === "success";

  const coinProgress = isEarly ? 0 : isLate ? 0.5 : isDone ? 1 : 0;
  const coinLeft = `calc(${16 + coinProgress * (100 - 16 - 28)}%)`;

  const leftIsShield = flowType === "transfer" || flowType === "withdraw";
  const rightIsShield = flowType === "deposit" || flowType === "transfer";

  const leftActive = isEarly;
  const leftOpening = flowType !== "deposit" && isEarly;
  const rightActive = isLate || isDone;
  const rightLocked = isDone && rightIsShield;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-sm"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("a")) dismiss();
      }}
    >
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-8 flex flex-col items-center gap-5 max-w-sm w-[340px] mx-4 animate-in">

        {/* Animation area */}
        {!isTerminal && (
          <div className="relative w-[220px] h-[100px] flex items-center justify-center">
            {/* Dotted path */}
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

            {/* Left icon */}
            <div className="absolute left-0 top-1/2 -translate-y-1/2">
              {leftIsShield ? (
                <ShieldIcon
                  active={leftActive}
                  opening={leftOpening}
                  locked={false}
                  color="var(--text-tertiary)"
                />
              ) : (
                <WalletIcon active={leftActive} color="var(--text-tertiary)" />
              )}
            </div>

            {/* Right icon */}
            <div className="absolute right-0 top-1/2 -translate-y-1/2">
              {rightIsShield ? (
                <ShieldIcon
                  active={rightActive}
                  opening={false}
                  locked={rightLocked}
                  color={isDone ? "var(--green)" : "var(--text-tertiary)"}
                />
              ) : (
                <WalletIcon active={rightActive} color={isDone ? "var(--green)" : "var(--text-tertiary)"} />
              )}
            </div>

            {/* Moving coin */}
            <div
              className="absolute top-1/2 -translate-y-1/2 z-10"
              style={{
                left: coinLeft,
                transition: "left 800ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              <div className="w-11 h-11 rounded-full shadow-md flex items-center justify-center bg-[var(--bg)] border border-[var(--border)]">
                <img src={tokenLogo} alt={tokenName} className="w-8 h-8 rounded-full" />
              </div>
            </div>
          </div>
        )}

        {/* Step progress bar */}
        {!isTerminal && (
          <div className="flex items-center gap-1 w-full px-2">
            {steps.map((label, i) => {
              const isDoneStep = i < activeStep;
              const isCurrent = i === activeStep;
              return (
                <div key={label} className="flex-1 flex flex-col items-center gap-1.5">
                  <div
                    className={`h-1 w-full rounded-full transition-all duration-500 ${
                      isDoneStep
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
                        : isDoneStep
                          ? "text-[var(--green)]"
                          : "text-[var(--text-tertiary)]"
                    }`}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Success */}
        {phase === "success" && (
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-3">
              {/* Source icon */}
              <div className="w-12 h-12 rounded-full bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center shadow-sm swap-fade-in">
                {leftIsShield ? (
                  <svg width="24" height="28" viewBox="0 0 36 42" className="opacity-40">
                    <path d="M18 2 L32 8 L32 22 Q32 36 18 40 Q4 36 4 22 L4 8 Z" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" />
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 36 36" className="opacity-40">
                    <rect x="3" y="8" width="30" height="22" rx="3" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" />
                    <rect x="3" y="8" width="30" height="7" rx="3" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" />
                  </svg>
                )}
              </div>
              {/* Arrow + coin */}
              <div className="flex items-center gap-2 swap-fade-in" style={{ animationDelay: "0.15s" }}>
                <div className="w-9 h-9 rounded-full bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center shadow-sm">
                  <img src={tokenLogo} alt={tokenName} className="w-7 h-7 rounded-full" />
                </div>
                <svg width="20" height="20" viewBox="0 0 24 24" className="text-[var(--green)]">
                  <path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              {/* Destination icon */}
              <div className="w-12 h-12 rounded-full bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center shadow-sm swap-fade-in" style={{ animationDelay: "0.3s" }}>
                {rightIsShield ? (
                  <svg width="24" height="28" viewBox="0 0 36 42">
                    <path d="M18 2 L32 8 L32 22 Q32 36 18 40 Q4 36 4 22 L4 8 Z" fill="none" stroke="var(--green)" strokeWidth="1.5" />
                    <rect x="13" y="20" width="10" height="8" rx="1.5" fill="none" stroke="var(--green)" strokeWidth="1" />
                    <path d="M15 20 L15 16 Q15 12 18 12 Q21 12 21 16 L21 20" fill="none" stroke="var(--green)" strokeWidth="1" />
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 36 36">
                    <rect x="3" y="8" width="30" height="22" rx="3" fill="none" stroke="var(--green)" strokeWidth="1.5" />
                    <rect x="3" y="8" width="30" height="7" rx="3" fill="none" stroke="var(--green)" strokeWidth="1.5" />
                    <circle cx="25" cy="21" r="2" fill="var(--green)" opacity="0.5" />
                  </svg>
                )}
              </div>
            </div>
            <div className="w-10 h-10 animate-success-pop">
              <svg viewBox="0 0 48 48" className="w-10 h-10">
                <circle cx="24" cy="24" r="22" fill="var(--green-bg)" stroke="var(--green)" strokeWidth="1.5" />
                <path d="M15 24 L21 30 L33 18" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-check-draw" />
              </svg>
            </div>
          </div>
        )}

        {/* Error */}
        {phase === "error" && (
          <div className="w-12 h-12 animate-success-pop">
            <svg viewBox="0 0 48 48" className="w-12 h-12">
              <circle cx="24" cy="24" r="22" fill="var(--red-bg)" stroke="var(--red)" strokeWidth="1.5" />
              <path d="M17 17 L31 31 M31 17 L17 31" fill="none" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round" className="animate-check-draw" />
            </svg>
          </div>
        )}

        {/* Message */}
        <div className="text-center">
          <p className="text-sm font-semibold">{message}</p>
          {subMessage && (
            <p className="text-xs text-[var(--text-secondary)] mt-1">{subMessage}</p>
          )}
        </div>

        {/* Spinner for long-running phases */}
        {(phase === "compliance" ||
          phase === "proving" ||
          phase === "sending" ||
          phase === "confirming") && (
          <div className="w-5 h-5">
            <svg className="w-5 h-5 animate-spin" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="8" fill="none" stroke="var(--border)" strokeWidth="2" />
              <circle cx="10" cy="10" r="8" fill="none" stroke="var(--text)" strokeWidth="2" strokeDasharray="16 34" strokeLinecap="round" />
            </svg>
          </div>
        )}

        {/* Explorer link */}
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
