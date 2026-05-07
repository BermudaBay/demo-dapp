"use client";

import Modal from "@/components/ui/Modal";
import { useStore } from "@/store/useStore";
import { getBermuda } from "@/lib/bermuda";
import {
  type VaultPosition,
  formatVaultAssets,
  erc4626Abi,
} from "@/lib/morpho";
import { useState } from "react";
import toast from "react-hot-toast";
import { encodeFunctionData, erc20Abi } from "viem";

interface EarnWithdrawModalProps {
  open: boolean;
  position: VaultPosition;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EarnWithdrawModal({
  open,
  position,
  onClose,
  onSuccess,
}: EarnWithdrawModalProps) {
  const { shieldedAccount, shieldedAddress, setLoading } = useStore();
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const displayShares = formatVaultAssets(
    position.shares,
    position.shareDecimals,
  );
  const displayAssets = formatVaultAssets(
    position.assets,
    position.assetDecimals,
  );

  async function handleWithdraw() {
    if (!shieldedAccount || !shieldedAddress) return;

    const bermuda = await getBermuda();
    const isUSDC =
      position.assetSymbol === "USDC" ||
      position.assetDecimals === 6;
    const underlyingAddr = isUSDC
      ? (bermuda.config.USDC! as `0x${string}`)
      : (bermuda.config.WETH! as `0x${string}`);
    const vaultAddr = position.vaultAddress as `0x${string}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poolAddress = (await (bermuda.config.pool as any).getAddress()) as `0x${string}`;

    // Minimum underlying to reshield (shares value with 1% slippage)
    const minUnderlying = (position.assets * 99n) / 100n;

    try {
      setSubmitting(true);
      setStatus("Generating ZK proofs...");

      // Stateless stealth multicall:
      // 1. Unshield vault shares from privacy pool to burner
      // 2. Burner: redeem shares for underlying → approve underlying for pool
      // 3. Reshield underlying (USDC/WETH) back into the privacy pool
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { payload } = await (bermuda as any).stealth(
        {
          spender: shieldedAccount,
          id: 0,
          unshield: {
            token: vaultAddr,
            amount: position.shares,
          },
          reshield: {
            token: underlyingAddr,
            amount: minUnderlying,
            to: shieldedAddress,
          },
        },
        async (burner: { address: () => Promise<string> }) => {
          const burnerAddr = (await burner.address()) as `0x${string}`;

          setStatus("Building withdrawal transaction...");

          const redeemCall = encodeFunctionData({
            abi: erc4626Abi,
            functionName: "redeem",
            args: [position.shares, burnerAddr, burnerAddr],
          });

          const approveUnderlyingForPool = encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [poolAddress, 2n ** 256n - 1n],
          });

          return [
            { to: vaultAddr, data: redeemCall },
            { to: underlyingAddr, data: approveUnderlyingForPool },
          ];
        },
      );

      setStatus("Sending transaction via relayer...");
      const txHash = (await bermuda.relay(payload)) as `0x${string}`;

      setStatus("Confirming on-chain...");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const receipt: any = await bermuda.wait(txHash);
      if (!receipt || receipt.status === 0)
        throw new Error("Withdrawal transaction reverted");

      toast.success(
        `Withdrew from ${position.vaultName} — ${position.assetSymbol} reshielded`,
      );
      setStatus(null);
      onSuccess();
    } catch (err: unknown) {
      console.error("[Morpho Withdraw] Failed:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error(msg.length > 80 ? msg.slice(0, 80) + "..." : msg);
      setStatus(null);
    } finally {
      setSubmitting(false);
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Withdraw from Vault">
      <div className="space-y-4">
        {/* Position info */}
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] p-4">
          <p className="text-sm font-medium mb-2">
            {position.vaultName}
          </p>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-tertiary)]">
                Vault shares
              </span>
              <span className="text-sm font-mono tabular-nums">
                {displayShares} {position.vaultSymbol}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-tertiary)]">
                Estimated value
              </span>
              <span className="text-sm font-mono font-semibold tabular-nums">
                ~{displayAssets} {position.assetSymbol}
              </span>
            </div>
          </div>
        </div>

        <p className="text-xs text-[var(--text-secondary)]">
          This will unshield your vault shares, redeem them for{" "}
          {position.assetSymbol} (including accrued yield), and reshield
          the {position.assetSymbol} back into your privacy pool.
        </p>

        {status && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
            <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 14 14">
              <circle
                cx="7"
                cy="7"
                r="5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="10 18"
                strokeLinecap="round"
              />
            </svg>
            {status}
          </div>
        )}

        <button
          onClick={handleWithdraw}
          disabled={submitting}
          className="w-full h-11 rounded-[var(--radius)] bg-[var(--primary)] text-[var(--on-primary)] text-sm font-medium flex items-center justify-center gap-2 hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 14 14">
                <circle
                  cx="7"
                  cy="7"
                  r="5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray="10 18"
                  strokeLinecap="round"
                />
              </svg>
              Processing...
            </>
          ) : (
            `Withdraw ~${displayAssets} ${position.assetSymbol}`
          )}
        </button>

        <p className="text-[10px] text-[var(--text-tertiary)] text-center">
          Powered by Morpho
        </p>
      </div>
    </Modal>
  );
}
