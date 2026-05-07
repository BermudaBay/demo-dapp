"use client";

import Modal from "@/components/ui/Modal";
import { useStore } from "@/store/useStore";
import {
  getBermuda,
  makeBermudaSigner,
  parseToken,
  formatToken,
  formatETH,
  parseETH,
} from "@/lib/bermuda";
import { useState } from "react";
import toast from "react-hot-toast";
import TxFlowOverlay from "@/components/ui/TxFlowOverlay";
import type { TxFlowPhase } from "@/components/ui/TxFlowOverlay";
import type { TxHistoryItem, TokenSymbol } from "@/types";

type DepositAsset = "USDC" | "ETH" | "WETH";

interface ShieldModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ShieldModal({
  open,
  onClose,
  onSuccess,
}: ShieldModalProps) {
  const {
    walletClient,
    publicAddress,
    shieldedAccount,
    shieldedAddress,
    balances,
    setLoading,
    addHistoryItem,
    updateHistoryItem,
  } = useStore();
  const [depositAsset, setDepositAsset] = useState<DepositAsset>("USDC");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [txAnim, setTxAnim] = useState<{
    phase: TxFlowPhase;
    step: number;
    message: string;
    subMessage?: string;
    txHash?: string;
  } | null>(null);

  const isNativeETH = depositAsset === "ETH";
  const shieldedToken: TokenSymbol = depositAsset === "USDC" ? "USDC" : "WETH";
  const publicBalance = depositAsset === "USDC"
    ? balances.publicUSDC
    : depositAsset === "ETH"
      ? balances.publicETH
      : balances.publicWETH;

  async function handleShield() {
    if (!walletClient || !shieldedAccount || !shieldedAddress || !amount) {
      toast.error("Fill in the amount");
      return;
    }

    const parsedAmount = isNativeETH
      ? parseETH(amount)
      : parseToken(amount, shieldedToken);
    if (parsedAmount <= 0n) {
      toast.error("Amount must be greater than 0");
      return;
    }

    const txId = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const historyItem: TxHistoryItem = {
      id: txId,
      direction: "incoming",
      type: "shield",
      token: shieldedToken,
      amount: parsedAmount,
      timestamp: Date.now(),
      status: "pending",
    };

    try {
      setSubmitting(true);

      const { erc20Abi } = await import("viem");
      const { baseSepolia } = await import("wagmi/chains");
      const bermuda = await getBermuda();
      const tokenAddr = (shieldedToken === "USDC" ? bermuda.config.USDC! : bermuda.config.WETH!) as `0x${string}`;
      const userAddress = walletClient.account?.address ?? publicAddress;

      if (userAddress && !isNativeETH) {
        const onChainBalance = await walletClient.readContract({
          address: tokenAddr,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [userAddress as `0x${string}`],
        });
        if ((onChainBalance as bigint) < parsedAmount) {
          toast.error(
            `Insufficient ${depositAsset}. You have ${formatToken(onChainBalance as bigint, shieldedToken)} ${depositAsset}.`,
          );
          setSubmitting(false);
          return;
        }
      }

      addHistoryItem(historyItem);

      const poolAddress = (await bermuda.config.pool.getAddress()) as `0x${string}`;

      if (!isNativeETH) {
        setTxAnim({ phase: "approve", step: 0, message: "Checking approval..." });

        const MAX_UINT256 = 2n ** 256n - 1n;

        const { Contract } = await import("ethers");
        const sdkProvider = bermuda.config.provider;
        const tokenContract = new Contract(
          tokenAddr,
          ["function allowance(address,address) view returns (uint256)"],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { provider: sdkProvider as any },
        );
        const sdkAllowance: bigint = await tokenContract.allowance(
          userAddress,
          poolAddress,
        );

        if (sdkAllowance < parsedAmount) {
          setTxAnim({ phase: "approve", step: 0, message: `Approve ${shieldedToken}`, subMessage: "Confirm in your wallet" });
          const approveTx = await walletClient.writeContract({
            address: tokenAddr,
            abi: erc20Abi,
            functionName: "approve",
            args: [poolAddress, MAX_UINT256],
            chain: baseSepolia,
          });

          const { createPublicClient, http } = await import("viem");
          const pc = createPublicClient({
            chain: baseSepolia,
            transport: http(),
          });
          await pc.waitForTransactionReceipt({ hash: approveTx });

          setTxAnim({ phase: "approve", step: 0, message: "Waiting for approval..." });
          for (let i = 0; i < 15; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            const updated: bigint = await tokenContract.allowance(
              userAddress,
              poolAddress,
            );
            if (updated >= parsedAmount) break;
          }
        }
      }

      const complianceStep = isNativeETH ? 0 : 1;
      setTxAnim({
        phase: "compliance",
        step: complianceStep,
        message: "Compliance & proof",
        subMessage: "Checking origin of your funds to make sure they are compliant",
      });

      const payload = await bermuda.deposit({
        signer: makeBermudaSigner(walletClient),
        token: tokenAddr,
        to: shieldedAddress,
        amount: parsedAmount,
        ...(isNativeETH ? { wrap: true } : {}),
      });

      const sendStep = isNativeETH ? 1 : 2;
      setTxAnim({ phase: "sending", step: sendStep, message: "Sign deposit", subMessage: "Confirm in your wallet" });
      const txHash = await walletClient.sendTransaction({
        to: payload.to as `0x${string}`,
        data: payload.data as `0x${string}`,
        chain: baseSepolia,
        gas: 15_000_000n,
        ...(isNativeETH ? { value: parsedAmount } : {}),
      });
      updateHistoryItem(txId, { txHash });

      const confirmStep = isNativeETH ? 2 : 3;
      setTxAnim({ phase: "confirming", step: confirmStep, message: "Confirming on-chain..." });
      const viemImport = await import("viem");
      const publicClient2 = viemImport.createPublicClient({
        chain: baseSepolia,
        transport: viemImport.http(),
      });
      const receipt = await publicClient2.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status === "reverted") {
        updateHistoryItem(txId, { status: "failed" });
        setTxAnim({ phase: "error", step: confirmStep, message: "Transaction reverted", subMessage: "Check the block explorer for details" });
        return;
      }

      const successStep = isNativeETH ? 3 : 4;
      updateHistoryItem(txId, { status: "confirmed" });
      setTxAnim({ phase: "success", step: successStep, message: "Deposit complete", subMessage: `${amount} ${depositAsset} shielded`, txHash });
      setAmount("");
      onSuccess();
    } catch (err: unknown) {
      console.error("Shield failed:", err);
      updateHistoryItem(txId, { status: "failed" });
      const msg = err instanceof Error ? err.message : "Unknown error";
      setTxAnim({
        phase: "error",
        step: 0,
        message: "Deposit failed",
        subMessage: msg.length > 80 ? msg.slice(0, 80) + "..." : msg,
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
          steps={isNativeETH ? ["Compliance", "Sign", "Confirm"] : ["Approve", "Compliance", "Sign", "Confirm"]}
          activeStep={txAnim.step}
          tokenLogo={depositAsset === "USDC" ? "/usdc-logo.png" : "/weth-logo.svg"}
          tokenName={depositAsset}
          message={txAnim.message}
          subMessage={txAnim.subMessage}
          txHash={txAnim.txHash}
          onDone={() => {
            const wasSuccess = txAnim.phase === "success";
            setTxAnim(null);
            if (wasSuccess) onClose();
          }}
          autoDismiss={txAnim.phase === "success" ? 3500 : 0}
        />
      )}
      <Modal open={open} onClose={onClose} title="Deposit">
        <div className="space-y-4">
          {/* Token selector */}
          <div className="flex p-0.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
            {(["USDC", "ETH", "WETH"] as DepositAsset[]).map((t) => (
              <button
                key={t}
                onClick={() => { setDepositAsset(t); setAmount(""); }}
                className={`flex-1 text-sm py-2 rounded-md font-medium transition-all flex items-center justify-center gap-1.5 ${
                  depositAsset === t
                    ? "bg-[var(--bg)] text-[var(--text)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                <img
                  src={t === "USDC" ? "/usdc-logo.png" : "/weth-logo.svg"}
                  alt={t}
                  className="w-4 h-4 rounded-full"
                />
                {t}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between py-2">
            <span className="text-xs text-[var(--text-tertiary)]">Available balance</span>
            <span className="text-sm font-mono font-medium tabular-nums">
              {isNativeETH
                ? `${formatETH(publicBalance)} ETH`
                : `${formatToken(publicBalance, shieldedToken)} ${depositAsset}`}
            </span>
          </div>

          <div>
            <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">Amount</label>
            <div className="relative">
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
                className="w-full h-11 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius)] px-3.5 pr-14 text-sm font-mono placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--border-hover)] focus:ring-1 focus:ring-[var(--border-hover)] transition-all"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-[var(--text-tertiary)] font-medium">
                {depositAsset}
              </span>
            </div>
          </div>

          <p className="text-xs text-[var(--text-tertiary)] leading-relaxed">
            {isNativeETH
              ? "ETH is automatically wrapped to WETH by the contract. No approval needed."
              : "Deposits are visible on-chain."}{" "}
            We check the origin of your funds to make sure they are compliant.
          </p>

          <button
            onClick={handleShield}
            disabled={submitting || !amount}
            className="w-full h-11 rounded-[var(--radius)] bg-[var(--primary)] text-[var(--on-primary)] text-sm font-medium flex items-center justify-center gap-2 hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="10 18" strokeLinecap="round" /></svg>
                Processing...
              </>
            ) : (
              "Deposit"
            )}
          </button>
        </div>
      </Modal>
    </>
  );
}
