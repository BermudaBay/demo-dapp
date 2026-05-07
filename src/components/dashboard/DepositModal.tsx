"use client";

import Modal from "@/components/ui/Modal";
import TxFlowOverlay from "@/components/ui/TxFlowOverlay";
import type { TxFlowPhase } from "@/components/ui/TxFlowOverlay";
import { useStore } from "@/store/useStore";
import { getBermuda, formatUSDC, formatUSDCRaw, parseUSDC } from "@/lib/bermuda";
import {
  type MorphoVault,
  formatVaultApy,
  formatVaultAssets,
  erc4626Abi,
  morphoPublicClient,
  getSepoliaVaultAddress,
  getSepoliaVaultShareDecimals,
} from "@/lib/morpho";
import { useState, useEffect, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import { encodeFunctionData, erc20Abi, type Address } from "viem";

interface DepositModalProps {
  open: boolean;
  vault: MorphoVault;
  onClose: () => void;
  onSuccess: () => void;
}

export default function DepositModal({
  open,
  vault,
  onClose,
  onSuccess,
}: DepositModalProps) {
  const { shieldedAccount, shieldedAddress, balances, setLoading } =
    useStore();
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [previewShares, setPreviewShares] = useState<bigint | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const successRef = useRef(false);
  const [txAnim, setTxAnim] = useState<{
    phase: TxFlowPhase;
    step: number;
    message: string;
    subMessage?: string;
    txHash?: string;
  } | null>(null);

  const isUSDC =
    vault.asset.symbol === "USDC" || vault.asset.decimals === 6;
  const availableBalance = isUSDC
    ? balances.shieldedUSDC
    : balances.shieldedWETH;

  function parseAmount(val: string): bigint {
    if (isUSDC) return parseUSDC(val);
    const parts = val.split(".");
    const whole = BigInt(parts[0] || "0") * 10n ** 18n;
    if (parts.length === 1) return whole;
    const fracStr = (parts[1] || "0").padEnd(18, "0").slice(0, 18);
    return whole + BigInt(fracStr);
  }

  function formatBalance(bal: bigint): string {
    if (isUSDC) return formatUSDC(bal);
    const unit = 10n ** 18n;
    const whole = bal / unit;
    const frac = bal % unit;
    const fracStr = frac
      .toString()
      .padStart(18, "0")
      .replace(/0+$/, "")
      .slice(0, 6);
    if (fracStr === "") return whole.toLocaleString();
    return `${whole.toLocaleString()}.${fracStr}`;
  }

  function formatRaw(bal: bigint): string {
    if (isUSDC) return formatUSDCRaw(bal);
    const unit = 10n ** 18n;
    const whole = bal / unit;
    const frac = bal % unit;
    const fracStr = frac
      .toString()
      .padStart(18, "0")
      .replace(/0+$/, "")
      .slice(0, 6);
    if (fracStr === "") return whole.toString();
    return `${whole}.${fracStr}`;
  }

  const sepoliaVaultAddr = getSepoliaVaultAddress(vault);

  const fetchPreview = useCallback(
    async (val: string) => {
      if (!val || parseFloat(val) <= 0) {
        setPreviewShares(null);
        return;
      }
      setPreviewing(true);
      try {
        const parsed = parseAmount(val);
        const shares = await morphoPublicClient.readContract({
          address: sepoliaVaultAddr as Address,
          abi: erc4626Abi,
          functionName: "previewDeposit",
          args: [parsed],
        });
        setPreviewShares(shares);
      } catch {
        setPreviewShares(null);
      } finally {
        setPreviewing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sepoliaVaultAddr, isUSDC],
  );

  useEffect(() => {
    clearTimeout(previewTimer.current);
    if (!amount || parseFloat(amount) <= 0) {
      setPreviewShares(null);
      return;
    }
    previewTimer.current = setTimeout(() => fetchPreview(amount), 400);
    return () => clearTimeout(previewTimer.current);
  }, [amount, fetchPreview]);

  async function handleDeposit() {
    if (!shieldedAccount || !shieldedAddress || !amount) return;

    const parsedAmount = parseAmount(amount);
    if (parsedAmount <= 0n)
      return toast.error("Amount must be greater than 0");
    if (parsedAmount > availableBalance)
      return toast.error("Insufficient shielded balance");

    const bermuda = await getBermuda();
    const tokenAddr = isUSDC
      ? (bermuda.config.USDC! as `0x${string}`)
      : (bermuda.config.WETH! as `0x${string}`);
    const vaultAddr = getSepoliaVaultAddress(vault);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poolAddress = (await (bermuda.config.pool as any).getAddress()) as `0x${string}`;

    // Use preview shares with 1% slippage tolerance as minimum
    const minShares = previewShares
      ? (previewShares * 99n) / 100n
      : parsedAmount;

    try {
      setSubmitting(true);
      setStatus("Generating ZK proofs...");
      setTxAnim({ phase: "proving", step: 0, message: "Generating ZK proofs…", subMessage: "This may take a moment" });

      // Stateless stealth multicall:
      // 1. Unshield USDC from privacy pool to burner
      // 2. Burner: approve USDC → deposit into vault → approve vault shares for pool
      // 3. Reshield vault shares back into the privacy pool
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { payload } = await (bermuda as any).stealth(
        {
          spender: shieldedAccount,
          id: 0,
          unshield: { token: tokenAddr, amount: parsedAmount },
          reshield: {
            token: vaultAddr,
            amount: minShares,
            to: shieldedAddress,
          },
        },
        async (burner: { address: () => Promise<string> }) => {
          const burnerAddr = (await burner.address()) as `0x${string}`;

          setStatus("Building deposit transaction...");
          setTxAnim({ phase: "proving", step: 0, message: "Building deposit transaction…" });

          const approveUnderlying = encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [vaultAddr, parsedAmount],
          });

          const depositCall = encodeFunctionData({
            abi: erc4626Abi,
            functionName: "deposit",
            args: [parsedAmount, burnerAddr],
          });

          const approveSharesForPool = encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [poolAddress, 2n ** 256n - 1n],
          });

          return [
            { to: tokenAddr, data: approveUnderlying },
            { to: vaultAddr, data: depositCall },
            { to: vaultAddr, data: approveSharesForPool },
          ];
        },
      );

      setStatus("Sending transaction via relayer...");
      setTxAnim({ phase: "sending", step: 1, message: "Sending via relayer…", subMessage: "Broadcasting transaction" });
      const txHash = (await bermuda.relay(payload)) as `0x${string}`;

      setStatus("Confirming on-chain...");
      setTxAnim({ phase: "confirming", step: 2, message: "Confirming on-chain…", subMessage: "Waiting for block confirmation" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const receipt: any = await bermuda.wait(txHash);
      if (!receipt || receipt.status === 0)
        throw new Error("Deposit transaction reverted");

      const depositedAmount = amount;
      setStatus(null);
      setAmount("");
      setPreviewShares(null);
      successRef.current = true;
      setTxAnim({
        phase: "success",
        step: 3,
        message: "Vault deposit complete",
        subMessage: `${depositedAmount} ${vault.asset.symbol} deposited into ${vault.name}`,
        txHash,
      });
    } catch (err: unknown) {
      console.error("[Morpho Deposit] Failed:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setStatus(null);
      setTxAnim({
        phase: "error",
        step: 0,
        message: "Deposit failed",
        subMessage: msg.length > 80 ? msg.slice(0, 80) + "…" : msg,
      });
    } finally {
      setSubmitting(false);
      setLoading(false);
    }
  }

  return (
    <>
      {txAnim && (
        <TxFlowOverlay
          flowType="deposit"
          phase={txAnim.phase}
          steps={["ZK Proofs", "Relay", "Confirm"]}
          activeStep={txAnim.step}
          tokenLogo={isUSDC ? "/usdc-logo.png" : "/weth-logo.svg"}
          tokenName={vault.asset.symbol}
          message={txAnim.message}
          subMessage={txAnim.subMessage}
          txHash={txAnim.txHash}
          onDone={() => {
            const wasSuccess = successRef.current;
            setTxAnim(null);
            if (wasSuccess) {
              successRef.current = false;
              onSuccess();
            }
          }}
          autoDismiss={txAnim.phase === "success" ? 5000 : 0}
        />
      )}
      <Modal open={open} onClose={onClose} title="Deposit to Vault">
      <div className="space-y-4">
        {/* Vault info */}
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{vault.name}</p>
              <p className="text-xs text-[var(--text-tertiary)]">
                {vault.symbol}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-mono font-semibold text-[var(--green)]">
                {formatVaultApy(vault.netApy)}
              </p>
              <p className="text-[10px] text-[var(--text-tertiary)]">
                Net APY
              </p>
            </div>
          </div>
        </div>

        {/* Amount input */}
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--text-tertiary)]">
              Amount to deposit
            </span>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-[var(--text-tertiary)]">
                Shielded:{" "}
                <span className="font-mono tabular-nums">
                  {formatBalance(availableBalance)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setAmount(formatRaw(availableBalance))}
                className="px-1.5 py-0.5 rounded text-[var(--primary)] font-semibold hover:bg-[var(--bg-hover)] transition-colors"
              >
                Max
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={amount}
              onChange={(e) =>
                setAmount(e.target.value.replace(/[^0-9.]/g, ""))
              }
              placeholder="0.00"
              className="flex-1 min-w-0 bg-transparent text-xl font-mono font-semibold placeholder:text-[var(--text-tertiary)] focus:outline-none"
            />
            <span className="text-sm font-medium px-3 py-1.5 rounded-full bg-[var(--bg)] border border-[var(--border)] shrink-0">
              {vault.asset.symbol}
            </span>
          </div>
        </div>

        {/* Preview: expected vault shares */}
        {(previewing || previewShares !== null) && (
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] p-3">
            <p className="text-xs text-[var(--text-tertiary)] mb-1">
              You will receive (vault shares)
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-mono font-semibold tabular-nums">
                {previewing
                  ? "..."
                  : previewShares !== null
                    ? formatVaultAssets(previewShares, getSepoliaVaultShareDecimals(vault))
                    : "—"}
              </span>
              <span className="text-xs text-[var(--text-tertiary)]">
                {vault.symbol}
              </span>
            </div>
          </div>
        )}

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
          onClick={handleDeposit}
          disabled={submitting || !amount || parseFloat(amount) <= 0}
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
            "Deposit"
          )}
        </button>

        <p className="text-[10px] text-[var(--text-tertiary)] text-center">
          Unshields {vault.asset.symbol} → deposits into vault → reshields
          vault shares back into your privacy pool. Powered by Morpho.
        </p>
      </div>
    </Modal>
    </>
  );
}
