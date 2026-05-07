"use client";

import { useStore } from "@/store/useStore";

export default function LoadingOverlay() {
  const { loading, loadingMessage } = useStore();

  if (!loading) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-sm">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-7 flex flex-col items-center gap-3.5 max-w-xs mx-4 animate-in">
        <svg className="w-8 h-8 animate-spin" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="13" fill="none" stroke="var(--border)" strokeWidth="2" />
          <circle cx="16" cy="16" r="13" fill="none" stroke="var(--text)" strokeWidth="2" strokeDasharray="28 54" strokeLinecap="round" />
        </svg>
        {loadingMessage && (
          <p className="text-sm text-[var(--text-secondary)] text-center">
            {loadingMessage}
          </p>
        )}
      </div>
    </div>
  );
}
