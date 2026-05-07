"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

type TxStatus = "loading" | "success" | "error";

interface TxStatusOverlayProps {
  status: TxStatus;
  message: string;
  subMessage?: string;
  txHash?: string;
  onDone?: () => void;
  autoDismiss?: number;
}

export default function TxStatusOverlay({
  status,
  message,
  subMessage,
  txHash,
  onDone,
  autoDismiss = 2500,
}: TxStatusOverlayProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (status === "success" && autoDismiss > 0) {
      const timer = setTimeout(() => {
        setVisible(false);
        onDone?.();
      }, autoDismiss);
      return () => clearTimeout(timer);
    }
  }, [status, autoDismiss, onDone]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-sm">
      <div
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-8 flex flex-col items-center gap-4 max-w-xs mx-4 animate-in"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) return;
          if (status === "success" || status === "error") {
            setVisible(false);
            onDone?.();
          }
        }}
      >
        {status === "loading" && (
          <div className="w-10 h-10">
            <svg className="w-10 h-10 animate-spin" viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="16" fill="none" stroke="var(--border)" strokeWidth="2.5" />
              <circle cx="20" cy="20" r="16" fill="none" stroke="var(--text)" strokeWidth="2.5" strokeDasharray="35 66" strokeLinecap="round" />
            </svg>
          </div>
        )}

        {status === "success" && (
          <div className="w-12 h-12 animate-success-pop">
            <svg viewBox="0 0 48 48" className="w-12 h-12">
              <circle cx="24" cy="24" r="22" fill="var(--green-bg)" stroke="var(--green)" strokeWidth="1.5" />
              <path d="M15 24 L21 30 L33 18" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-check-draw" />
            </svg>
          </div>
        )}

        {status === "error" && (
          <div className="w-12 h-12 animate-success-pop">
            <svg viewBox="0 0 48 48" className="w-12 h-12">
              <circle cx="24" cy="24" r="22" fill="var(--red-bg)" stroke="var(--red)" strokeWidth="1.5" />
              <path d="M17 17 L31 31 M31 17 L17 31" fill="none" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round" className="animate-check-draw" />
            </svg>
          </div>
        )}

        <div className="text-center animate-fade-up">
          <p className="text-sm font-semibold">{message}</p>
          {subMessage && (
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              {subMessage}
            </p>
          )}
        </div>

        {status === "success" && txHash && (
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
