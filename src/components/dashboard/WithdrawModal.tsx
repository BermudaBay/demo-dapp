"use client";

import Modal from "@/components/ui/Modal";
import { useStore } from "@/store/useStore";
import { getBermuda, parseToken, formatToken, formatTokenRaw, formatUSDC } from "@/lib/bermuda";
import { useState } from "react";
import toast from "react-hot-toast";
import TxFlowOverlay from "@/components/ui/TxFlowOverlay";
import type { TxFlowPhase } from "@/components/ui/TxFlowOverlay";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import type { TxHistoryItem, TokenSymbol } from "@/types";

interface WithdrawModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function WithdrawModal({
  open,
  onClose,
  onSuccess,
}: WithdrawModalProps) {
  const {
    shieldedAccount,
    balances,
    compliance,
    setLoading,
    addHistoryItem,
    updateHistoryItem,
  } = useStore();
  const [token, setToken] = useState<TokenSymbol>("USDC");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [txAnim, setTxAnim] = useState<{
    phase: TxFlowPhase;
    step: number;
    message: string;
    subMessage?: string;
    txHash?: string;
  } | null>(null);

  const available = token === "USDC" ? balances.shieldedUSDC : balances.shieldedWETH;

  async function handleWithdraw() {
    if (!shieldedAccount || !recipient || !amount) {
      toast.error("Fill in all fields");
      return;
    }

    const parsedAmount = parseToken(amount, token);
    if (parsedAmount <= 0n) {
      toast.error("Amount must be greater than 0");
      return;
    }

    if (parsedAmount > available) {
      toast.error("Insufficient shielded balance");
      return;
    }

    const txId = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const historyItem: TxHistoryItem = {
      id: txId,
      direction: "outgoing",
      type: "public-withdraw",
      token,
      amount: parsedAmount,
      counterparty: recipient,
      timestamp: Date.now(),
      status: "pending",
    };

    try {
      setSubmitting(true);
      addHistoryItem(historyItem);

      const bermuda = await getBermuda();
      const tokenAddr = token === "USDC" ? bermuda.config.USDC! : bermuda.config.WETH!;

      setTxAnim({
        phase: "compliance",
        step: 0,
        message: "Compliance & proof",
        subMessage: "Creating zk proof that your funds are compliant",
      });

      const payload = await bermuda.withdraw({
        spender: shieldedAccount,
        token: tokenAddr,
        to: recipient,
        amount: parsedAmount,
      });

      setTxAnim({
        phase: "sending",
        step: 1,
        message: "Relaying withdrawal",
        subMessage: "Sending the signed transaction via the relayer",
      });
      const txHash = (await bermuda.relay(payload)) as `0x${string}`;
      updateHistoryItem(txId, { txHash });

      setTxAnim({ phase: "confirming", step: 2, message: "Confirming on-chain..." });
      await bermuda.wait(txHash);

      updateHistoryItem(txId, { status: "confirmed" });
      setTxAnim({
        phase: "success",
        step: 3,
        message: "Withdrawal complete",
        subMessage: `${amount} ${token} withdrawn to public address`,
        txHash,
      });

      setRecipient("");
      setAmount("");
      onSuccess();
    } catch (err: unknown) {
      console.error("Withdraw failed:", err);
      updateHistoryItem(txId, { status: "failed" });
      const msg = err instanceof Error ? err.message : "Unknown error";
      setTxAnim({
        phase: "error",
        step: 0,
        message: "Withdrawal failed",
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
          flowType="withdraw"
          phase={txAnim.phase}
          steps={["Compliance", "Relay", "Confirm"]}
          activeStep={txAnim.step}
          tokenLogo={token === "USDC" ? "/usdc-logo.png" : "/weth-logo.svg"}
          tokenName={token}
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
      <Modal open={open} onClose={onClose} title="Withdraw">
        <div className="space-y-4">
          {/* Compliance status */}
          {compliance.checked && (
            <div
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-[var(--radius)] text-sm ${
                compliance.isFullyCompliant
                  ? "bg-[var(--green-bg)] text-[var(--green)]"
                  : "bg-[var(--amber-bg)] text-[var(--amber)]"
              }`}
            >
              {compliance.isFullyCompliant ? (
                <ShieldCheck size={16} />
              ) : (
                <ShieldAlert size={16} />
              )}
              <span className="font-medium">
                {compliance.isFullyCompliant
                  ? "Funds are compliant"
                  : `${formatUSDC(compliance.uncompliantAmount)} USDC flagged`}
              </span>
            </div>
          )}

          {/* Token selector */}
          <div className="flex p-0.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
            {(["USDC", "WETH"] as TokenSymbol[]).map((t) => (
              <button
                key={t}
                onClick={() => { setToken(t); setAmount(""); }}
                className={`flex-1 text-sm py-2 rounded-md font-medium transition-all flex items-center justify-center gap-1.5 ${
                  token === t
                    ? "bg-[var(--bg)] text-[var(--text)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                <img src={t === "USDC" ? "/usdc-logo.png" : "/weth-logo.svg"} alt={t} className="w-4 h-4 rounded-full" />
                {t}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">
              Recipient
            </label>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Public EVM address (0x...)"
              className="w-full h-11 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius)] px-3.5 text-sm font-mono placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--border-hover)] focus:ring-1 focus:ring-[var(--border-hover)] transition-all"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-[var(--text-tertiary)]">Amount</label>
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-[var(--text-tertiary)]">
                  Available: <span className="font-mono tabular-nums">{formatToken(available, token)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setAmount(formatTokenRaw(available, token))}
                  className="px-1.5 py-0.5 rounded text-[var(--primary)] font-semibold hover:bg-[var(--bg-hover)] transition-colors"
                >
                  Max
                </button>
              </div>
            </div>
            <div className="relative">
              <input
                type="text"
                value={amount}
                onChange={(e) =>
                  setAmount(e.target.value.replace(/[^0-9.]/g, ""))
                }
                placeholder="0.00"
                className="w-full h-11 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius)] px-3.5 pr-14 text-sm font-mono placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--border-hover)] focus:ring-1 focus:ring-[var(--border-hover)] transition-all"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-[var(--text-tertiary)] font-medium">
                {token}
              </span>
            </div>
          </div>

          <p className="text-xs text-[var(--text-tertiary)] leading-relaxed">
            Only shielded funds that pass compliance screening (not on the flagged-deposit list) can be withdrawn privately. The withdrawal amount and recipient are visible on-chain.
          </p>

          <button
            onClick={handleWithdraw}
            disabled={submitting || !recipient || !amount}
            className="w-full h-11 rounded-[var(--radius)] bg-[var(--primary)] text-[var(--on-primary)] text-sm font-medium flex items-center justify-center gap-2 hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 14 14">
                  <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="10 18" strokeLinecap="round" />
                </svg>
                Processing...
              </>
            ) : (
              "Withdraw"
            )}
          </button>
        </div>
      </Modal>
    </>
  );
}
