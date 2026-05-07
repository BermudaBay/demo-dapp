"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/store/useStore";
import {
  getBermuda,
  loadShieldedHistory,
  checkComplianceStatus,
  resolveUnspentByToken,
  formatUSDC,
  formatETH,
  formatWETH,
  shortenAddress,
} from "@/lib/bermuda";
import {
  type MorphoVault,
  type VaultPosition,
  fetchMorphoVaults,
  computeVaultPositions,
  SEPOLIA_VAULT_ADDRESSES,
} from "@/lib/morpho";
import { loadTxMeta } from "@/lib/txMeta";
import type { TxHistoryItem } from "@/types";
import TransactionHistory from "@/components/dashboard/TransactionHistory";
import ReceiveModal from "@/components/dashboard/ReceiveModal";
import TransferModal from "@/components/dashboard/TransferModal";
import WithdrawModal from "@/components/dashboard/WithdrawModal";
import ShieldModal from "@/components/dashboard/ShieldModal";
import SwapModal from "@/components/dashboard/SwapModal";
import LoadingOverlay from "@/components/ui/LoadingOverlay";
import IndeterminateBar from "@/components/ui/IndeterminateBar";
import NetworkGuard from "@/components/ui/NetworkGuard";
import BermudaLogo from "@/components/ui/BermudaLogo";
import ThemeToggle from "@/components/ui/ThemeToggle";
import EarnTab from "@/components/dashboard/EarnTab";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  RefreshCw,
  LogOut,
  Copy,
  ArrowDown,
  ArrowLeftRight,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import toast from "react-hot-toast";
import { createPublicClient, http, erc20Abi } from "viem";
import { baseSepolia } from "viem/chains";

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});

export default function DashboardPage() {
  const router = useRouter();
  const {
    publicAddress,
    shieldedAccount,
    balances,
    compliance,
    setBalances,
    setHistory,
    setCompliance,
    reset,
  } = useStore();

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [shieldOpen, setShieldOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [shieldedDataReady, setShieldedDataReady] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Earn state — lifted up so we can share the dashboard's findUtxos result
  // and avoid a duplicate scan inside EarnTab.
  const [vaults, setVaults] = useState<MorphoVault[]>([]);
  const [positions, setPositions] = useState<VaultPosition[]>([]);
  const [vaultsLoading, setVaultsLoading] = useState(true);
  const [positionsLoading, setPositionsLoading] = useState(true);
  const [vaultsError, setVaultsError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicAddress || !shieldedAccount) {
      router.push(publicAddress ? "/setup" : "/");
    }
  }, [publicAddress, shieldedAccount, router]);

  const refreshBalances = useCallback(async () => {
    if (!publicAddress || !shieldedAccount) return;
    setRefreshing(true);
    setShieldedDataReady(false);
    setHistoryLoading(true);
    setVaultsLoading(true);
    setPositionsLoading(true);
    setVaultsError(null);

    // Kick off Morpho metadata fetch independently. The Morpho GraphQL API can
    // take 10–15s; we MUST NOT block the balance UI on it. Vaults render with
    // their own loading state and resolve on their own timeline.
    const morphoPromise = fetchMorphoVaults().catch((err) => {
      console.error("Morpho vaults fetch failed:", err);
      return null;
    });

    try {
      const bermuda = await getBermuda();
      const usdcAddress = bermuda.config.USDC!;
      const wethAddress = bermuda.config.WETH!;
      const usdcKey = (usdcAddress as string).toLowerCase();
      const wethKey = (wethAddress as string).toLowerCase();

      // Tokens to scan in a single findUtxos call: USDC + WETH + every Sepolia
      // vault share token. One scan, one event-decryption pass for everything.
      const scanTokens = [
        usdcAddress,
        wethAddress,
        ...SEPOLIA_VAULT_ADDRESSES,
      ];

      // Critical path: public balances + UTXO scan ONLY. As soon as these
      // resolve we paint the shielded balance — independent of Morpho.
      const [
        publicUSDC,
        publicETH,
        publicWETH,
        allUtxosRecord,
      ] = await Promise.all([
        publicClient.readContract({
          address: usdcAddress as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [publicAddress as `0x${string}`],
        }),
        publicClient.getBalance({ address: publicAddress as `0x${string}` }),
        publicClient.readContract({
          address: wethAddress as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [publicAddress as `0x${string}`],
        }),
        bermuda.findUtxos({
          keypair: shieldedAccount,
          tokens: scanTokens,
          excludeSpent: false,
        }),
      ]);

      // Resolve unspent UTXOs per token. This pays for the isSpent checks
      // exactly once, then we reuse the unspent USDC list for compliance and
      // the vault-token UTXOs (still raw) for vault position computation.
      const unspent = await resolveUnspentByToken(
        bermuda,
        allUtxosRecord,
        usdcKey,
        wethKey,
      );

      setBalances({
        publicUSDC: publicUSDC as bigint,
        publicETH: publicETH as bigint,
        publicWETH: publicWETH as bigint,
        shieldedUSDC: unspent.shieldedUSDC,
        shieldedWETH: unspent.shieldedWETH,
      });
      setShieldedDataReady(true);

      // Vault metadata + positions resolve when Morpho returns. Both keep
      // their own loading skeletons in the UI so the balance card paints
      // immediately and the Earn section fills in later.
      morphoPromise
        .then(async (fetched) => {
          if (!fetched) {
            setVaultsError("Failed to load vaults from Morpho");
            setPositions([]);
            return;
          }
          setVaults(fetched);
          try {
            const pos = await computeVaultPositions(
              bermuda,
              allUtxosRecord,
              fetched,
            );
            setPositions(pos);
          } catch (err) {
            console.error("Vault positions failed:", err);
            setPositions([]);
          }
        })
        .finally(() => {
          setVaultsLoading(false);
          setPositionsLoading(false);
        });

      // History reuses the already-decrypted UTXOs (USDC + WETH only).
      const flatUtxos = [
        ...(allUtxosRecord[usdcKey] || []),
        ...(allUtxosRecord[wethKey] || []),
      ];
      loadShieldedHistory(shieldedAccount, { bermuda, utxos: flatUtxos })
        .then((onChainItems) => {
          // Outgoing rows from chain don't include the recipient's memo —
          // merge from the in-memory store + localStorage so locally-known
          // memos and pending/failed/swap rows survive the refresh.
          const { history: current } = useStore.getState();
          const txMeta = loadTxMeta();
          const enriched: TxHistoryItem[] = onChainItems.map((item) => {
            if (!item.txHash) return item;
            const fromStore = current.find((h) => h.txHash === item.txHash);
            const stored = txMeta[item.txHash];
            const note = item.note || fromStore?.note || stored?.note;
            const counterparty =
              item.counterparty || fromStore?.counterparty || stored?.counterparty;
            if (note === item.note && counterparty === item.counterparty) return item;
            return {
              ...item,
              ...(note ? { note } : {}),
              ...(counterparty ? { counterparty } : {}),
            };
          });
          const onChainTxHashes = new Set(
            enriched.filter((h) => h.txHash).map((h) => h.txHash),
          );
          const cutoff = Date.now() - 30 * 60 * 1000;
          const localKeep = current.filter((h) => {
            if (h.txHash && onChainTxHashes.has(h.txHash)) return false;
            if (h.status === "pending") return true;
            if (h.status === "failed" && h.timestamp > cutoff) return true;
            if (h.type === "swap" && h.status === "confirmed") return true;
            return false;
          });
          const merged = [...localKeep, ...enriched];
          merged.sort((a, b) => b.timestamp - a.timestamp);
          setHistory(merged);
        })
        .catch((err) => {
          console.error("History load failed:", err);
        })
        .finally(() => setHistoryLoading(false));

      // Compliance reuses the unspent USDC subset — no extra findUtxos.
      checkComplianceStatus(shieldedAccount, {
        bermuda,
        shieldedUSDC: unspent.shieldedUSDC,
        unspentUsdcUtxos: unspent.unspentUSDC,
      })
        .then(setCompliance)
        .catch((err) => {
          console.error("Compliance check failed:", err);
        });
    } catch (err) {
      console.error("Balance refresh failed:", err);
      setHistoryLoading(false);
      setVaultsLoading(false);
      setPositionsLoading(false);
      setShieldedDataReady(true);
    } finally {
      setRefreshing(false);
    }
  }, [publicAddress, shieldedAccount, setBalances, setHistory, setCompliance]);

  // Silent balance poll — updates numbers without triggering loading skeletons.
  // Intentionally narrower than refreshBalances: only refetches public + shielded
  // balances and vault positions. Skips history, compliance, vault metadata.
  const silentPollRef = useRef(false);
  const silentRefreshBalances = useCallback(async () => {
    if (!publicAddress || !shieldedAccount) return;
    if (silentPollRef.current) return;
    silentPollRef.current = true;
    try {
      const bermuda = await getBermuda();
      const usdcAddress = bermuda.config.USDC!;
      const wethAddress = bermuda.config.WETH!;
      const usdcKey = (usdcAddress as string).toLowerCase();
      const wethKey = (wethAddress as string).toLowerCase();

      const scanTokens = [
        usdcAddress,
        wethAddress,
        ...SEPOLIA_VAULT_ADDRESSES,
      ];

      const [publicUSDC, publicETH, publicWETH, allUtxosRecord] =
        await Promise.all([
          publicClient.readContract({
            address: usdcAddress as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [publicAddress as `0x${string}`],
          }),
          publicClient.getBalance({ address: publicAddress as `0x${string}` }),
          publicClient.readContract({
            address: wethAddress as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [publicAddress as `0x${string}`],
          }),
          bermuda.findUtxos({
            keypair: shieldedAccount,
            tokens: scanTokens,
            excludeSpent: false,
          }),
        ]);

      const unspent = await resolveUnspentByToken(
        bermuda,
        allUtxosRecord,
        usdcKey,
        wethKey,
      );

      setBalances({
        publicUSDC: publicUSDC as bigint,
        publicETH: publicETH as bigint,
        publicWETH: publicWETH as bigint,
        shieldedUSDC: unspent.shieldedUSDC,
        shieldedWETH: unspent.shieldedWETH,
      });

      // Refresh vault positions if we already have vault metadata.
      if (vaults.length > 0) {
        try {
          const pos = await computeVaultPositions(
            bermuda,
            allUtxosRecord,
            vaults,
          );
          setPositions(pos);
        } catch {
          /* silent */
        }
      }
    } catch {
      /* silent — don't surface poll errors */
    } finally {
      silentPollRef.current = false;
    }
  }, [publicAddress, shieldedAccount, setBalances, vaults]);

  // Initial full refresh.
  useEffect(() => {
    refreshBalances();
  }, [refreshBalances]);

  // Silent balance poll. Findutxos re-decrypts every cached commitment event
  // and re-checks isSpent for each UTXO; keep cadence relaxed.
  useEffect(() => {
    if (!shieldedDataReady) return;
    const id = setInterval(silentRefreshBalances, 15000);
    return () => clearInterval(id);
  }, [shieldedDataReady, silentRefreshBalances]);

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  }

  async function retryVaults() {
    setVaultsLoading(true);
    setVaultsError(null);
    try {
      const data = await fetchMorphoVaults();
      setVaults(data);
    } catch (err) {
      console.error("Morpho vaults fetch failed:", err);
      setVaultsError("Failed to load vaults from Morpho");
    } finally {
      setVaultsLoading(false);
    }
  }

  if (!publicAddress || !shieldedAccount) return null;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      <LoadingOverlay />

      {/* Navbar */}
      <nav className="h-14 border-b border-[var(--border)] flex items-center px-5 lg:px-8 sticky top-0 z-20 bg-[var(--bg)]">
        <BermudaLogo height={18} color="var(--text)" />
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          <button
            onClick={() => {
              reset();
              router.push("/");
            }}
            className="h-8 px-3 rounded-lg text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-1.5"
          >
            <LogOut size={13} />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </nav>

      <main className="flex-1 max-w-3xl mx-auto w-full px-5 lg:px-8 py-8 space-y-12">
        <NetworkGuard />

        {/* Balance section */}
        <div aria-busy={!shieldedDataReady}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <p className="text-sm text-[var(--text-tertiary)]">Shielded balances</p>
              {compliance.checked && (
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                    compliance.isFullyCompliant
                      ? "bg-[var(--green-bg)] text-[var(--green)]"
                      : "bg-[var(--amber-bg)] text-[var(--amber)]"
                  }`}
                >
                  {compliance.isFullyCompliant ? (
                    <ShieldCheck size={11} />
                  ) : (
                    <ShieldAlert size={11} />
                  )}
                  {compliance.isFullyCompliant ? "Compliant" : "Partially compliant"}
                </span>
              )}
            </div>
            <button
              onClick={refreshBalances}
              disabled={refreshing}
              className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40"
              title="Refresh balances"
            >
              <RefreshCw
                size={14}
                className={`text-[var(--text-tertiary)] ${refreshing ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          <div className="flex flex-col gap-3 mt-3">
            {!shieldedDataReady ? (
              <>
                <BalanceSkeleton />
                <BalanceSkeleton />
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/usdc-logo.png" alt="USDC" className="w-9 h-9 rounded-full shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold tracking-tight tabular-nums">
                        {formatUSDC(balances.shieldedUSDC)}
                      </span>
                      <span className="text-sm text-[var(--text-tertiary)] font-medium">USDC</span>
                    </div>
                    <p className="text-xs text-[var(--text-tertiary)] font-mono tabular-nums mt-0.5">
                      Public: {formatUSDC(balances.publicUSDC)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/weth-logo.svg" alt="WETH" className="w-9 h-9 rounded-full shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold tracking-tight tabular-nums">
                        {formatWETH(balances.shieldedWETH)}
                      </span>
                      <span className="text-sm text-[var(--text-tertiary)] font-medium">WETH</span>
                    </div>
                    <p className="text-xs text-[var(--text-tertiary)] font-mono tabular-nums mt-0.5">
                      Public: {formatETH(balances.publicETH)} ETH · {formatWETH(balances.publicWETH)} WETH
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => copy(publicAddress || "", "Address")}
              className="flex items-center gap-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors text-xs"
            >
              <span className="font-mono">{shortenAddress(publicAddress || "")}</span>
              <Copy size={12} />
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShieldOpen(true)}
            className="h-9 px-4 rounded-lg bg-[var(--primary)] text-[var(--on-primary)] text-sm font-medium flex items-center gap-2 hover:bg-[var(--primary-hover)] transition-colors"
          >
            <Plus size={15} />
            Deposit
          </button>
          <button
            onClick={() => setTransferOpen(true)}
            className="h-9 px-4 rounded-lg border border-[var(--border)] text-sm font-medium flex items-center gap-2 hover:bg-[var(--bg-hover)] transition-colors"
          >
            <ArrowUpRight size={15} />
            Send
          </button>
          <button
            onClick={() => setWithdrawOpen(true)}
            className="h-9 px-4 rounded-lg border border-[var(--border)] text-sm font-medium flex items-center gap-2 hover:bg-[var(--bg-hover)] transition-colors"
          >
            <ArrowDown size={15} />
            Withdraw
          </button>
          <button
            onClick={() => setSwapOpen(true)}
            className="h-9 px-4 rounded-lg border border-[var(--border)] text-sm font-medium flex items-center gap-2 hover:bg-[var(--bg-hover)] transition-colors"
          >
            <ArrowLeftRight size={15} />
            Swap
          </button>
          <button
            onClick={() => setReceiveOpen(true)}
            className="h-9 px-4 rounded-lg border border-[var(--border)] text-sm font-medium flex items-center gap-2 hover:bg-[var(--bg-hover)] transition-colors"
          >
            <ArrowDownLeft size={15} />
            Receive
          </button>
        </div>

        {/* Transaction history */}
        <TransactionHistory loading={historyLoading} />

        {/* Earn (Morpho vaults) — inline section */}
        <EarnTab
          vaults={vaults}
          positions={positions}
          vaultsLoading={vaultsLoading}
          positionsLoading={positionsLoading}
          vaultsError={vaultsError}
          onRetryVaults={retryVaults}
          onAfterMutation={refreshBalances}
        />
      </main>

      <ReceiveModal open={receiveOpen} onClose={() => setReceiveOpen(false)} />
      <TransferModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        onSuccess={refreshBalances}
      />
      <WithdrawModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        onSuccess={refreshBalances}
      />
      <ShieldModal
        open={shieldOpen}
        onClose={() => setShieldOpen(false)}
        onSuccess={refreshBalances}
      />
      <SwapModal
        open={swapOpen}
        onClose={() => setSwapOpen(false)}
        onSuccess={refreshBalances}
      />
    </div>
  );
}

function BalanceSkeleton() {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-[var(--bg-hover)] animate-pulse shrink-0" aria-hidden />
      <div className="flex-1 min-w-0 space-y-2">
        <IndeterminateBar className="max-w-[160px]" label="Loading balances" />
        <div className="h-8 w-36 max-w-full rounded-md bg-[var(--bg-hover)] animate-pulse" />
        <div className="h-3.5 w-28 max-w-full rounded bg-[var(--bg-hover)] animate-pulse opacity-80" />
      </div>
    </div>
  );
}
