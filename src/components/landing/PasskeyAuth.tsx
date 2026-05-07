"use client";

import { Fingerprint, AlertTriangle } from "lucide-react";
import { useState } from "react";
import dynamic from "next/dynamic";

const PRIVY_CONFIGURED = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

const PasskeyFlow = dynamic(() => import("./PasskeyFlow"), { ssr: false });

export default function PasskeyAuth() {
  const [active, setActive] = useState(false);

  if (active) {
    if (!PRIVY_CONFIGURED) {
      return (
        <div className="space-y-3">
          <div className="rounded-[var(--radius)] border border-[var(--amber)]/20 bg-[var(--amber-bg)] p-3.5 flex items-start gap-3">
            <AlertTriangle size={15} className="text-[var(--amber)] mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium">Privy not configured</p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1 leading-relaxed">
                Set <code className="font-mono text-[var(--text)]">NEXT_PUBLIC_PRIVY_APP_ID</code> in <code className="font-mono text-[var(--text)]">.env.local</code>.
              </p>
            </div>
          </div>
          <button
            onClick={() => setActive(false)}
            className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors py-1.5 w-full text-center"
          >
            Back
          </button>
        </div>
      );
    }

    return <PasskeyFlow onBack={() => setActive(false)} />;
  }

  return (
    <button
      onClick={() => setActive(true)}
      className="w-full h-12 rounded-[var(--radius)] bg-[var(--primary)] text-[var(--on-primary)] text-sm font-medium flex items-center justify-center gap-2.5 hover:bg-[var(--primary-hover)] transition-colors"
    >
      <Fingerprint size={16} />
      Continue with Passkey
    </button>
  );
}
