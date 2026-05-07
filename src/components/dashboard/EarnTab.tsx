"use client";

import { useState } from "react";
import {
  type MorphoVault,
  type VaultPosition,
  formatVaultApy,
  formatVaultTvl,
  formatVaultAssets,
} from "@/lib/morpho";
import {
  TrendingUp,
  Vault,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  DollarSign,
} from "lucide-react";
import DepositModal from "./DepositModal";
import EarnWithdrawModal from "./EarnWithdrawModal";

interface EarnTabProps {
  vaults: MorphoVault[];
  positions: VaultPosition[];
  vaultsLoading: boolean;
  positionsLoading: boolean;
  vaultsError: string | null;
  onRetryVaults: () => void;
  onAfterMutation: () => void;
}

export default function EarnTab({
  vaults,
  positions,
  vaultsLoading,
  positionsLoading,
  vaultsError,
  onRetryVaults,
  onAfterMutation,
}: EarnTabProps) {
  const [expandedVault, setExpandedVault] = useState<string | null>(null);
  const [depositVault, setDepositVault] = useState<MorphoVault | null>(null);
  const [withdrawPosition, setWithdrawPosition] =
    useState<VaultPosition | null>(null);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <DollarSign size={20} />
          Earn
        </h2>
        <p className="text-sm text-[var(--text-tertiary)] mt-0.5">
          Deposit into Morpho Vaults to earn yield
        </p>
      </div>

      {/* Active Positions */}
      <section>
        <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 flex items-center gap-2">
          <Vault size={14} />
          My Active Positions
        </h3>

        {positionsLoading ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-14 rounded-lg bg-[var(--bg-hover)] animate-pulse"
                />
              ))}
            </div>
          </div>
        ) : positions.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-secondary)] p-8 text-center">
            <Vault
              size={28}
              className="mx-auto text-[var(--text-tertiary)] mb-2"
            />
            <p className="text-sm text-[var(--text-tertiary)]">
              No active positions
            </p>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              Deposit into a vault below to start earning yield
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {positions.map((pos) => (
              <div
                key={pos.vaultAddress}
                className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-secondary)] p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[var(--green-bg)] flex items-center justify-center shrink-0">
                      <TrendingUp
                        size={14}
                        className="text-[var(--green)]"
                      />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{pos.vaultName}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-[var(--text-tertiary)] font-mono tabular-nums">
                          {formatVaultAssets(pos.shares, pos.shareDecimals)}{" "}
                          shares
                        </p>
                        <span className="text-xs text-[var(--green)] font-medium">
                          {formatVaultApy(pos.netApy)} APY
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setWithdrawPosition(pos)}
                    className="h-8 px-3 rounded-lg border border-[var(--border)] text-xs font-medium hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    Withdraw
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Available Vaults */}
      <section>
        <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 flex items-center gap-2">
          <TrendingUp size={14} />
          Available Morpho Vaults
        </h3>

        {vaultsLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-secondary)] p-4"
              >
                <div className="h-14 rounded-lg bg-[var(--bg-hover)] animate-pulse" />
              </div>
            ))}
          </div>
        ) : vaultsError ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--red-bg)] bg-[var(--red-bg)] p-6 text-center">
            <p className="text-sm text-[var(--red)]">{vaultsError}</p>
            <button
              onClick={onRetryVaults}
              className="mt-2 text-xs text-[var(--text-tertiary)] underline hover:text-[var(--text-secondary)]"
            >
              Retry
            </button>
          </div>
        ) : vaults.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-secondary)] p-8 text-center">
            <p className="text-sm text-[var(--text-tertiary)]">
              No vaults available
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Table header */}
            <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs text-[var(--text-tertiary)] font-medium">
              <div className="col-span-4">Vault</div>
              <div className="col-span-2 text-right">Net APY</div>
              <div className="col-span-2 text-right">Deposits</div>
              <div className="col-span-2 text-right">Asset</div>
              <div className="col-span-2 text-right">Action</div>
            </div>

            {vaults.map((vault) => {
              const isExpanded = expandedVault === vault.address;
              return (
                <div
                  key={vault.address}
                  className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden transition-colors hover:border-[var(--border-hover)]"
                >
                  {/* Row */}
                  <div
                    className="grid grid-cols-12 gap-2 items-center px-4 py-3 cursor-pointer"
                    onClick={() =>
                      setExpandedVault(isExpanded ? null : vault.address)
                    }
                  >
                    <div className="col-span-4 flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-[var(--bg-hover)] flex items-center justify-center shrink-0 text-xs font-bold text-[var(--text-tertiary)]">
                        {vault.asset.symbol.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {vault.name}
                        </p>
                        <p className="text-[10px] text-[var(--text-tertiary)] truncate">
                          {vault.symbol}
                        </p>
                      </div>
                    </div>

                    <div className="col-span-2 text-right">
                      <span
                        className={`text-sm font-mono font-semibold tabular-nums ${vault.netApy > 0 ? "text-[var(--green)]" : ""}`}
                      >
                        {formatVaultApy(vault.netApy)}
                      </span>
                    </div>

                    <div className="col-span-2 text-right">
                      <span className="text-sm font-mono tabular-nums text-[var(--text-secondary)]">
                        {vault.totalAssetsUsd > 0
                          ? formatVaultTvl(vault.totalAssetsUsd)
                          : `${formatVaultAssets(vault.totalAssets, vault.asset.decimals)} ${vault.asset.symbol}`}
                      </span>
                    </div>

                    <div className="col-span-2 text-right">
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--bg-hover)]">
                        {vault.asset.symbol}
                      </span>
                    </div>

                    <div className="col-span-2 flex items-center justify-end gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDepositVault(vault);
                        }}
                        className="h-7 px-3 rounded-lg bg-[var(--primary)] text-[var(--on-primary)] text-xs font-medium hover:bg-[var(--primary-hover)] transition-colors"
                      >
                        Deposit
                      </button>
                      {isExpanded ? (
                        <ChevronUp
                          size={14}
                          className="text-[var(--text-tertiary)]"
                        />
                      ) : (
                        <ChevronDown
                          size={14}
                          className="text-[var(--text-tertiary)]"
                        />
                      )}
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 border-t border-[var(--border)]">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                        <div>
                          <p className="text-[var(--text-tertiary)] mb-0.5">
                            Gross APY
                          </p>
                          <p className="font-mono tabular-nums font-medium">
                            {formatVaultApy(vault.apy)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[var(--text-tertiary)] mb-0.5">
                            Performance Fee
                          </p>
                          <p className="font-mono tabular-nums font-medium">
                            {(vault.fee * 100).toFixed(0)}%
                          </p>
                        </div>
                        <div>
                          <p className="text-[var(--text-tertiary)] mb-0.5">
                            Total Deposits
                          </p>
                          <p className="font-mono tabular-nums font-medium">
                            {formatVaultAssets(
                              vault.totalAssets,
                              vault.asset.decimals,
                            )}{" "}
                            {vault.asset.symbol}
                          </p>
                        </div>
                        <div>
                          <p className="text-[var(--text-tertiary)] mb-0.5">
                            Vault Address
                          </p>
                          <a
                            href={`https://base-sepolia.blockscout.com/address/${vault.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[var(--primary)] hover:underline flex items-center gap-1"
                          >
                            {vault.address.slice(0, 6)}...
                            {vault.address.slice(-4)}
                            <ExternalLink size={10} />
                          </a>
                        </div>
                        {vault.curator && (
                          <div>
                            <p className="text-[var(--text-tertiary)] mb-0.5">
                              Curator
                            </p>
                            <p className="font-mono tabular-nums">
                              {vault.curator.slice(0, 6)}...
                              {vault.curator.slice(-4)}
                            </p>
                          </div>
                        )}
                        <div>
                          <p className="text-[var(--text-tertiary)] mb-0.5">
                            Asset Token
                          </p>
                          <p className="font-mono tabular-nums">
                            {vault.asset.address.slice(0, 6)}...
                            {vault.asset.address.slice(-4)}
                          </p>
                        </div>
                      </div>
                      <p className="text-[10px] text-[var(--text-tertiary)] mt-3">
                        Powered by Morpho · Base Sepolia testnet
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {depositVault && (
        <DepositModal
          open={!!depositVault}
          vault={depositVault}
          onClose={() => setDepositVault(null)}
          onSuccess={() => {
            setDepositVault(null);
            onAfterMutation();
          }}
        />
      )}

      {withdrawPosition && (
        <EarnWithdrawModal
          open={!!withdrawPosition}
          position={withdrawPosition}
          onClose={() => setWithdrawPosition(null)}
          onSuccess={() => {
            setWithdrawPosition(null);
            onAfterMutation();
          }}
        />
      )}
    </div>
  );
}
