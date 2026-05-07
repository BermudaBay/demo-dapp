"use client";

import Modal from "@/components/ui/Modal";
import { useStore } from "@/store/useStore";
import {
  getBermuda,
  formatToken,
  formatTokenRaw,
  parseToken,
} from "@/lib/bermuda";
import { useState, useCallback, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import SwapAnimationOverlay from "@/components/ui/SwapAnimationOverlay";
import type { SwapAnimPhase } from "@/components/ui/SwapAnimationOverlay";
import { ArrowDownUp } from "lucide-react";
import type { TxHistoryItem, TokenSymbol } from "@/types";
import { createPublicClient, http, encodeFunctionData, erc20Abi } from "viem";
import { baseSepolia } from "viem/chains";

const SWAP_ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4" as const;
const QUOTER_V2 = "0xC5290058841028F1614F3A6F0F5816cAd0df5E27" as const;
const POOL_FEE = 3000;

const quoterAbi = [
  {
    inputs: [
      {
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
        name: "params",
        type: "tuple",
      },
    ],
    name: "quoteExactInputSingle",
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const swapRouterAbi = [
  {
    inputs: [
      {
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
        name: "params",
        type: "tuple",
      },
    ],
    name: "exactInputSingle",
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
] as const;

const TOKEN_LOGOS: Record<TokenSymbol, string> = {
  USDC: "/usdc-logo.png",
  WETH: "/weth-logo.svg",
};

const pc = createPublicClient({ chain: baseSepolia, transport: http() });

interface SwapModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SwapModal({ open, onClose, onSuccess }: SwapModalProps) {
  const {
    shieldedAccount,
    shieldedAddress,
    balances,
    addHistoryItem,
    updateHistoryItem,
    setLoading,
  } = useStore();
  const [fromToken, setFromToken] = useState<TokenSymbol>("USDC");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<bigint | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [swapAnim, setSwapAnim] = useState<{
    phase: SwapAnimPhase;
    message: string;
    subMessage?: string;
    txHash?: string;
  } | null>(null);
  const quoteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toToken: TokenSymbol = fromToken === "USDC" ? "WETH" : "USDC";

  const availableBalance = fromToken === "USDC" ? balances.shieldedUSDC : balances.shieldedWETH;

  function flipTokens() {
    setFromToken(toToken);
    setAmount("");
    setQuote(null);
  }

  const fetchQuote = useCallback(
    async (val: string) => {
      if (!val || parseFloat(val) <= 0) {
        setQuote(null);
        return;
      }
      setQuoting(true);
      try {
        const bermuda = await getBermuda();
        const tokenIn = fromToken === "USDC" ? bermuda.config.USDC! : bermuda.config.WETH!;
        const tokenOut = fromToken === "USDC" ? bermuda.config.WETH! : bermuda.config.USDC!;
        const amountIn = parseToken(val, fromToken);

        const result = await pc.simulateContract({
          address: QUOTER_V2,
          abi: quoterAbi,
          functionName: "quoteExactInputSingle",
          args: [
            {
              tokenIn: tokenIn as `0x${string}`,
              tokenOut: tokenOut as `0x${string}`,
              amountIn,
              fee: POOL_FEE,
              sqrtPriceLimitX96: 0n,
            },
          ],
        });
        setQuote(result.result[0]);
      } catch (err) {
        console.error("Quote failed:", err);
        setQuote(null);
      } finally {
        setQuoting(false);
      }
    },
    [fromToken],
  );

  useEffect(() => {
    clearTimeout(quoteTimer.current);
    if (!amount || parseFloat(amount) <= 0) {
      setQuote(null);
      return;
    }
    quoteTimer.current = setTimeout(() => fetchQuote(amount), 400);
    return () => clearTimeout(quoteTimer.current);
  }, [amount, fetchQuote]);

  async function handleSwap() {
    if (!shieldedAccount || !shieldedAddress || !amount || !quote) return;

    const parsedAmount = parseToken(amount, fromToken);
    if (parsedAmount <= 0n) return toast.error("Amount must be greater than 0");
    if (parsedAmount > availableBalance) return toast.error("Insufficient balance");

    const bermuda = await getBermuda();
    const tokenInAddr = (fromToken === "USDC" ? bermuda.config.USDC! : bermuda.config.WETH!) as `0x${string}`;
    const tokenOutAddr = (fromToken === "USDC" ? bermuda.config.WETH! : bermuda.config.USDC!) as `0x${string}`;
    const minOut = (quote * 99n) / 100n;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poolAddress = (await (bermuda.config.pool as any).getAddress()) as `0x${string}`;

    const txId = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const historyItem: TxHistoryItem = {
      id: txId,
      direction: "outgoing",
      type: "swap",
      token: fromToken,
      amount: parsedAmount,
      toToken: toToken,
      toAmount: minOut,
      timestamp: Date.now(),
      status: "pending",
    };

    try {
      setSubmitting(true);
      addHistoryItem(historyItem);

      setSwapAnim({
        phase: "unshield",
        message: "Generating ZK proofs...",
        subMessage: "Preparing stealth swap",
      });

      // bermuda.stealth() handles: burner derivation, EIP-7702 delegation,
      // unshield proof, reshield proof, and multicall assembly.
      // We only provide the middle calls: approve → swap → approve.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { payload } = await (bermuda as any).stealth(
        {
          spender: shieldedAccount,
          id: 0,
          unshield: { token: tokenInAddr, amount: parsedAmount },
          reshield: { token: tokenOutAddr, amount: minOut, to: shieldedAddress },
        },
        async (burner: { address: () => Promise<string> }) => {
          const burnerAddr = (await burner.address()) as `0x${string}`;

          setSwapAnim({
            phase: "swap",
            message: "Building swap...",
            subMessage: `${fromToken} → ${toToken}`,
          });

          const approveIn = encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [SWAP_ROUTER, parsedAmount],
          });

          const swapCall = encodeFunctionData({
            abi: swapRouterAbi,
            functionName: "exactInputSingle",
            args: [
              {
                tokenIn: tokenInAddr,
                tokenOut: tokenOutAddr,
                fee: POOL_FEE,
                recipient: burnerAddr,
                amountIn: parsedAmount,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0n,
              },
            ],
          });

          const approveOut = encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [poolAddress, 2n ** 256n - 1n],
          });

          return [
            { to: tokenInAddr, data: approveIn },
            { to: SWAP_ROUTER as `0x${string}`, data: swapCall },
            { to: tokenOutAddr, data: approveOut },
          ];
        },
      );

      setSwapAnim({
        phase: "reshield",
        message: "Sending transaction...",
        subMessage: "Relaying via stealth burner",
      });

      const txHash = (await bermuda.relay(payload)) as `0x${string}`;
      updateHistoryItem(txId, { txHash });

      setSwapAnim({
        phase: "confirming",
        message: "Confirming swap...",
        subMessage: "Waiting for on-chain confirmation",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const receipt: any = await bermuda.wait(txHash);
      if (!receipt || receipt.status === 0) throw new Error("Swap transaction reverted");

      updateHistoryItem(txId, { status: "confirmed", txHash });
      setSwapAnim({
        phase: "success",
        message: "Swap complete",
        subMessage: `${amount} ${fromToken} → ~${formatToken(minOut, toToken)} ${toToken}`,
        txHash,
      });

      setAmount("");
      setQuote(null);
      onSuccess();
    } catch (err: unknown) {
      console.error("[Swap] Failed:", err);
      updateHistoryItem(txId, { status: "failed" });
      const msg = err instanceof Error ? err.message : "Unknown error";
      setSwapAnim({
        phase: "error",
        message: "Swap failed",
        subMessage: msg.length > 80 ? msg.slice(0, 80) + "..." : msg,
      });
    } finally {
      setSubmitting(false);
      setLoading(false);
    }
  }

  return (
    <>
      {swapAnim && (
        <SwapAnimationOverlay
          phase={swapAnim.phase}
          fromToken={fromToken}
          toToken={toToken}
          fromLogo={TOKEN_LOGOS[fromToken]}
          toLogo={TOKEN_LOGOS[toToken]}
          message={swapAnim.message}
          subMessage={swapAnim.subMessage}
          txHash={swapAnim.txHash}
          onDone={() => {
            const wasSuccess = swapAnim.phase === "success";
            setSwapAnim(null);
            if (wasSuccess) onClose();
          }}
          autoDismiss={swapAnim.phase === "success" ? 3500 : 0}
        />
      )}
      <Modal open={open} onClose={onClose} title="Swap">
        <div className="space-y-4">
          {/* From token */}
          <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[var(--text-tertiary)]">You pay</span>
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-[var(--text-tertiary)]">
                  Available: <span className="font-mono tabular-nums">{formatToken(availableBalance, fromToken)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setAmount(formatTokenRaw(availableBalance, fromToken))}
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
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
                className="flex-1 min-w-0 bg-transparent text-xl font-mono font-semibold placeholder:text-[var(--text-tertiary)] focus:outline-none"
              />
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg)] border border-[var(--border)] shrink-0">
                <img src={TOKEN_LOGOS[fromToken]} alt={fromToken} className="w-5 h-5 rounded-full" />
                <span className="text-sm font-medium">{fromToken}</span>
              </div>
            </div>
          </div>

          {/* Flip button */}
          <div className="flex justify-center -my-2 relative z-10">
            <button
              onClick={flipTokens}
              className="w-9 h-9 rounded-full bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center hover:bg-[var(--bg-hover)] transition-colors shadow-sm"
            >
              <ArrowDownUp size={15} className="text-[var(--text-secondary)]" />
            </button>
          </div>

          {/* To token */}
          <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[var(--text-tertiary)]">You receive</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex-1 min-w-0 text-xl font-mono font-semibold text-[var(--text-secondary)]">
                {quoting ? "..." : quote ? formatToken(quote, toToken) : "0.00"}
              </span>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg)] border border-[var(--border)] shrink-0">
                <img src={TOKEN_LOGOS[toToken]} alt={toToken} className="w-5 h-5 rounded-full" />
                <span className="text-sm font-medium">{toToken}</span>
              </div>
            </div>
          </div>

          {quote && (
            <p className="text-xs text-[var(--text-tertiary)]">
              Uniswap V3 · 0.3% fee · 1% slippage · Stealth via burner
            </p>
          )}

          <button
            onClick={handleSwap}
            disabled={submitting || !amount || !quote}
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
              "Swap"
            )}
          </button>
        </div>
      </Modal>
    </>
  );
}
