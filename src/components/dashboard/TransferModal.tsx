"use client";

import Modal from "@/components/ui/Modal";
import { useStore } from "@/store/useStore";
import { getBermuda, parseToken, formatToken, formatTokenRaw } from "@/lib/bermuda";
import { saveTxMetaEntry } from "@/lib/txMeta";
import { useState } from "react";
import toast from "react-hot-toast";
import TxFlowOverlay from "@/components/ui/TxFlowOverlay";
import type { TxFlowPhase } from "@/components/ui/TxFlowOverlay";
import type { TxHistoryItem, TokenSymbol } from "@/types";

interface TransferModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function TransferModal({
  open,
  onClose,
  onSuccess,
}: TransferModalProps) {
  const { shieldedAccount, balances, setLoading, addHistoryItem, updateHistoryItem } =
    useStore();
  const [token, setToken] = useState<TokenSymbol>("USDC");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [txAnim, setTxAnim] = useState<{
    phase: TxFlowPhase;
    step: number;
    message: string;
    subMessage?: string;
    txHash?: string;
  } | null>(null);

  const available = token === "USDC" ? balances.shieldedUSDC : balances.shieldedWETH;

  async function handleSubmit() {
    if (!shieldedAccount || !recipient || !amount) {
      toast.error("Fill in all fields");
      return;
    }

    const parsedAmount = parseToken(amount, token);
    if (parsedAmount <= 0n) {
      toast.error("Amount must be greater than 0");
      return;
    }

    const memoTrimmed = memo.trim();
    const txId = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const historyItem: TxHistoryItem = {
      id: txId,
      direction: "outgoing",
      type: "private-transfer",
      token,
      amount: parsedAmount,
      counterparty: recipient,
      note: memoTrimmed || undefined,
      timestamp: Date.now(),
      status: "pending",
    };

    try {
      setSubmitting(true);
      addHistoryItem(historyItem);

      const bermuda = await getBermuda();
      const tokenAddr = token === "USDC" ? bermuda.config.USDC! : bermuda.config.WETH!;

      setTxAnim({
        phase: "proving",
        step: 0,
        message: "Generating proof...",
        subMessage: "Creating zero-knowledge proof",
      });

      const payload = await bermuda.transfer({
        spender: shieldedAccount,
        token: tokenAddr,
        to: recipient,
        amount: parsedAmount,
        note: memoTrimmed || undefined,
      });

      setTxAnim({ phase: "sending", step: 1, message: "Submitting..." });
      const txHash = (await bermuda.relay(payload)) as `0x${string}`;
      updateHistoryItem(txId, { txHash });
      saveTxMetaEntry(txHash, {
        counterparty: recipient,
        ...(memoTrimmed ? { note: memoTrimmed } : {}),
      });

      setTxAnim({ phase: "confirming", step: 2, message: "Confirming..." });
      await bermuda.wait(txHash);

      updateHistoryItem(txId, { status: "confirmed" });
      setTxAnim({
        phase: "success",
        step: 3,
        message: "Transfer sent",
        subMessage: `${amount} ${token} transferred privately`,
        txHash,
      });

      setRecipient("");
      setAmount("");
      setMemo("");
      onSuccess();
    } catch (err: unknown) {
      console.error("Transfer failed:", err);
      updateHistoryItem(txId, { status: "failed" });
      const msg = err instanceof Error ? err.message : "Unknown error";
      setTxAnim({
        phase: "error",
        step: 0,
        message: "Transaction failed",
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
          flowType="transfer"
          phase={txAnim.phase}
          steps={["Prove", "Send", "Confirm"]}
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
      <Modal open={open} onClose={onClose} title="Send">
        <div className="space-y-4">
          <p className="text-xs text-[var(--text-tertiary)] leading-relaxed">
            Send privately to another shielded address using ZK proofs.
          </p>

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
            <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">Recipient</label>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Shielded address (0x...)"
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
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
                className="w-full h-11 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius)] px-3.5 pr-14 text-sm font-mono placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--border-hover)] focus:ring-1 focus:ring-[var(--border-hover)] transition-all"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-[var(--text-tertiary)] font-medium">{token}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">Memo <span className="text-[var(--text-tertiary)]">(optional)</span></label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="What's it for?"
              maxLength={100}
              className="w-full h-11 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius)] px-3.5 text-sm placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--border-hover)] focus:ring-1 focus:ring-[var(--border-hover)] transition-all"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting || !recipient || !amount}
            className="w-full h-11 rounded-[var(--radius)] bg-[var(--primary)] text-[var(--on-primary)] text-sm font-medium flex items-center justify-center gap-2 hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="10 18" strokeLinecap="round" /></svg>
                Processing...
              </>
            ) : (
              "Send"
            )}
          </button>
        </div>
      </Modal>
    </>
  );
}
