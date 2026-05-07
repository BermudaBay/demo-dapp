"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { useStore } from "@/store/useStore";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

export default function NetworkGuard() {
  const { chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { authMethod } = useStore();
  const [switching, setSwitching] = useState(false);

  if (authMethod === "passkey") return null;
  if (!isConnected) return null;
  if (chainId === baseSepolia.id) return null;

  async function handleSwitch() {
    try {
      setSwitching(true);
      await switchChainAsync({ chainId: baseSepolia.id });
      toast.success("Switched to Base Sepolia");
    } catch (err: unknown) {
      console.error("Chain switch failed:", err);
      toast.error(
        `Switch failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="mb-4 flex items-center gap-3 p-3 rounded-[var(--radius)] border border-[var(--amber)]/30 bg-[var(--amber-bg)]">
      <AlertTriangle size={15} className="text-[var(--amber)] shrink-0" />
      <p className="text-sm flex-1">Wrong network. Switch to Base Sepolia.</p>
      <button
        onClick={handleSwitch}
        disabled={switching}
        className="h-8 px-3 rounded-lg bg-[var(--primary)] text-[var(--on-primary)] text-xs font-medium hover:bg-[var(--primary-hover)] transition-colors shrink-0 disabled:opacity-40"
      >
        {switching ? "Switching..." : "Switch"}
      </button>
    </div>
  );
}
