"use client";

import { useStore } from "@/store/useStore";
import { formatToken, shortenAddress } from "@/lib/bermuda";
import type { TxHistoryItem, TokenSymbol } from "@/types";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  ExternalLink,
  Clock,
  CheckCircle,
  XCircle,
} from "lucide-react";
import IndeterminateBar from "@/components/ui/IndeterminateBar";

const TOKEN_LOGOS: Record<TokenSymbol, string> = {
  USDC: "/usdc-logo.png",
  WETH: "/weth-logo.svg",
};

const typeLabels: Record<TxHistoryItem["type"], string> = {
  shield: "Deposit",
  "private-transfer": "Private Transfer",
  "public-withdraw": "Withdrawal",
  swap: "Swap",
};

const statusIcons: Record<TxHistoryItem["status"], typeof Clock> = {
  pending: Clock,
  confirmed: CheckCircle,
  failed: XCircle,
};

const statusColors: Record<TxHistoryItem["status"], string> = {
  pending: "text-[var(--amber)]",
  confirmed: "text-[var(--green)]",
  failed: "text-[var(--red)]",
};

function groupByDate(items: TxHistoryItem[]) {
  const groups: Record<string, TxHistoryItem[]> = {};
  for (const item of items) {
    const date = new Date(item.timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    if (!groups[date]) groups[date] = [];
    groups[date].push(item);
  }
  return groups;
}

function SwapRow({ tx }: { tx: TxHistoryItem }) {
  const StatusIcon = statusIcons[tx.status];
  const fromToken = tx.token;
  const toToken = tx.toToken ?? (fromToken === "USDC" ? "WETH" : "USDC");

  return (
    <div className="flex items-center gap-3.5 px-4 py-3.5 bg-[var(--bg)] hover:bg-[var(--bg-secondary)] transition-colors">
      {/* Swap icon: two overlapping token logos */}
      <div className="w-9 h-9 shrink-0 relative">
        <img
          src={TOKEN_LOGOS[fromToken]}
          alt={fromToken}
          className="w-6 h-6 rounded-full absolute top-0 left-0 ring-2 ring-[var(--bg)]"
        />
        <img
          src={TOKEN_LOGOS[toToken]}
          alt={toToken}
          className="w-6 h-6 rounded-full absolute bottom-0 right-0 ring-2 ring-[var(--bg)]"
        />
      </div>

      {/* Label */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Swap</span>
          <StatusIcon size={12} className={statusColors[tx.status]} />
        </div>
        <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
          {fromToken} → {toToken} · {new Date(tx.timestamp).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>

      {/* Amounts */}
      <div className="shrink-0 flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm font-mono tabular-nums">
          <span className="text-[var(--text-secondary)]">{formatToken(tx.amount, fromToken)}</span>
          <img src={TOKEN_LOGOS[fromToken]} alt="" className="w-3.5 h-3.5 rounded-full" />
          <ArrowRight size={12} className="text-[var(--text-tertiary)] mx-0.5" />
          <span className="text-[var(--text)]">{tx.toAmount ? formatToken(tx.toAmount, toToken) : "~"}</span>
          <img src={TOKEN_LOGOS[toToken]} alt="" className="w-3.5 h-3.5 rounded-full" />
        </div>

        {tx.txHash && (
          <a
            href={`https://base-sepolia.blockscout.com/tx/${tx.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded hover:bg-[var(--bg-hover)] transition-colors"
            title="View on Blockscout"
          >
            <ExternalLink size={12} className="text-[var(--text-tertiary)]" />
          </a>
        )}
      </div>
    </div>
  );
}

function RegularRow({ tx }: { tx: TxHistoryItem }) {
  const StatusIcon = statusIcons[tx.status];

  return (
    <div className="flex items-center gap-3.5 px-4 py-3 bg-[var(--bg)] hover:bg-[var(--bg-secondary)] transition-colors">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
        tx.direction === "incoming" ? "bg-[var(--green-bg)]" : "bg-[var(--bg-hover)]"
      }`}>
        {tx.direction === "incoming" ? (
          <ArrowDownLeft size={15} className="text-[var(--green)]" />
        ) : (
          <ArrowUpRight size={15} className="text-[var(--text-secondary)]" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{typeLabels[tx.type]}</span>
          <StatusIcon size={12} className={statusColors[tx.status]} />
        </div>
        {tx.note && (
          <p
            className="mt-1.5 text-[13px] leading-snug text-[var(--text-secondary)] line-clamp-2 rounded-md px-2.5 py-1.5 bg-[var(--bg-hover)] border border-[var(--border)]/60"
            title={tx.note}
          >
            {tx.note}
          </p>
        )}
        {tx.counterparty ? (
          <p
            className={`text-xs text-[var(--text-tertiary)] font-mono truncate ${tx.note ? "mt-1.5" : "mt-0.5"}`}
          >
            {shortenAddress(tx.counterparty)}
          </p>
        ) : !tx.note ? (
          <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
            {new Date(tx.timestamp).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        ) : null}
      </div>

      <div className="text-right shrink-0 flex items-center gap-2">
        <span
          className={`text-sm font-mono font-medium tabular-nums ${
            tx.direction === "incoming" ? "text-[var(--green)]" : "text-[var(--text)]"
          }`}
        >
          {tx.direction === "incoming" ? "+" : "-"}
          {formatToken(tx.amount, tx.token)} {tx.token}
        </span>

        {tx.txHash && (
          <a
            href={`https://base-sepolia.blockscout.com/tx/${tx.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded hover:bg-[var(--bg-hover)] transition-colors"
            title="View on Blockscout"
          >
            <ExternalLink size={12} className="text-[var(--text-tertiary)]" />
          </a>
        )}
      </div>
    </div>
  );
}

export default function TransactionHistory({ loading = false }: { loading?: boolean }) {
  const { history } = useStore();

  if (loading) {
    return (
      <div className="py-10" aria-busy="true">
        <h2 className="text-sm font-medium text-[var(--text-secondary)] mb-4 text-left">Transactions</h2>
        <IndeterminateBar className="max-w-md mb-3" label="Loading transactions" />
        <p className="text-xs text-[var(--text-tertiary)]">Loading transaction history…</p>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="py-12 text-center">
        <h2 className="text-sm font-medium text-[var(--text-secondary)] mb-4 text-left">Transactions</h2>
        <p className="text-[var(--text-tertiary)] text-sm">
          No transactions yet
        </p>
      </div>
    );
  }

  const grouped = groupByDate(history);

  return (
    <div>
      <h2 className="text-sm font-medium text-[var(--text-secondary)] mb-4">Transactions</h2>

      {Object.entries(grouped).map(([date, items]) => (
        <div key={date} className="mb-6">
          <p className="text-xs text-[var(--text-tertiary)] mb-2">{date}</p>
          <div className="border border-[var(--border)] rounded-[var(--radius-lg)] divide-y divide-[var(--border)] overflow-hidden">
            {items.map((tx) =>
              tx.type === "swap" ? (
                <SwapRow key={tx.id} tx={tx} />
              ) : (
                <RegularRow key={tx.id} tx={tx} />
              )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
