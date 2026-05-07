import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import type { ISdk } from "@bermuda/sdk";

export const morphoPublicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});

type SepoliaVaultInfo = {
  address: `0x${string}`;
  name: string;
  symbol: string;
  shareDecimals: number;
  assetSymbol: string;
  assetDecimals: number;
  assetAddress: string;
};

const SEPOLIA_VAULTS: SepoliaVaultInfo[] = [
  {
    address: "0x99067e5d73b1d6f1b5856e59209e12f5a0f86ded",
    name: "MetaMorpho USDC Vault",
    symbol: "mmUSDC",
    shareDecimals: 18,
    assetSymbol: "USDC",
    assetDecimals: 6,
    assetAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
];

const SEPOLIA_USDC_VAULT = SEPOLIA_VAULTS[0].address;

export function getSepoliaVaultAddress(vault: MorphoVault): `0x${string}` {
  if (vault.asset.symbol === "USDC" || vault.asset.decimals === 6) {
    return SEPOLIA_USDC_VAULT;
  }
  return vault.address as `0x${string}`;
}

export const SEPOLIA_VAULT_ADDRESSES: string[] = SEPOLIA_VAULTS.map(
  (v) => v.address,
);

export function getSepoliaVaultShareDecimals(vault: MorphoVault): number {
  const addr = getSepoliaVaultAddress(vault).toLowerCase();
  const sv = SEPOLIA_VAULTS.find((v) => v.address.toLowerCase() === addr);
  return sv?.shareDecimals ?? 18;
}

export const erc4626Abi = [
  {
    name: "deposit",
    type: "function",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    name: "withdraw",
    type: "function",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    name: "redeem",
    type: "function",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "assets", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    name: "balanceOf",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "totalAssets",
    type: "function",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "totalSupply",
    type: "function",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "convertToAssets",
    type: "function",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "convertToShares",
    type: "function",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "previewDeposit",
    type: "function",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "previewRedeem",
    type: "function",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "asset",
    type: "function",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    name: "name",
    type: "function",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
  {
    name: "symbol",
    type: "function",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
] as const;

export type MorphoVault = {
  address: string;
  name: string;
  symbol: string;
  asset: {
    address: string;
    symbol: string;
    decimals: number;
  };
  totalAssetsUsd: number;
  totalAssets: string;
  apy: number;
  netApy: number;
  fee: number;
  curator?: string;
};

export type VaultPosition = {
  vaultAddress: string;
  vaultName: string;
  vaultSymbol: string;
  assetSymbol: string;
  assetDecimals: number;
  shareDecimals: number;
  assetAddress: string;
  shares: bigint;
  assets: bigint;
  netApy: number;
};

/**
 * Return testnet vaults that exist on Base Sepolia. Two slow data sources are
 * fetched in parallel:
 *   - the Morpho mainnet GraphQL API for cosmetic APY (~10–15s tail latency)
 *   - on-chain totalAssets per vault on Sepolia (~few hundred ms each)
 *
 * If the Morpho API is slow or fails the function still returns vaults with
 * the on-chain totalAssets and APY=0, so the UI can render quickly. Callers
 * are expected to tolerate APY=0 as a "loading" placeholder.
 */
export async function fetchMorphoVaults(): Promise<MorphoVault[]> {
  type ApyData = { apy: number; netApy: number; fee: number };
  const defaultApy: ApyData = { apy: 0, netApy: 0, fee: 0 };

  const apyPromise: Promise<ApyData> = fetch("/api/morpho/vaults")
    .then(async (res) => {
      if (!res.ok) return defaultApy;
      const items = await res.json();
      if (!Array.isArray(items) || items.length === 0) return defaultApy;
      const usdcVault = items.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (v: any) => v.asset?.symbol === "USDC",
      );
      if (!usdcVault?.state) return defaultApy;
      return {
        apy: usdcVault.state.apy ?? 0,
        netApy: usdcVault.state.netApy ?? 0,
        fee: usdcVault.state.fee ?? 0,
      };
    })
    .catch(() => defaultApy);

  const totalAssetsPromises = SEPOLIA_VAULTS.map((sv) =>
    morphoPublicClient
      .readContract({
        address: sv.address,
        abi: erc4626Abi,
        functionName: "totalAssets",
      })
      .then((raw) => raw.toString())
      .catch(() => "0"),
  );

  const [apy, ...totalsArr] = await Promise.all([
    apyPromise,
    ...totalAssetsPromises,
  ]);

  return SEPOLIA_VAULTS.map((sv, i) => ({
    address: sv.address,
    name: sv.name,
    symbol: sv.symbol,
    asset: {
      address: sv.assetAddress,
      symbol: sv.assetSymbol,
      decimals: sv.assetDecimals,
    },
    totalAssetsUsd: 0,
    totalAssets: totalsArr[i],
    apy: apy.apy,
    netApy: apy.netApy,
    fee: apy.fee,
  }));
}

/**
 * Compute shielded vault positions from a *pre-fetched* utxosByToken map.
 * Pass the result of a `bermuda.findUtxos({ tokens: [...vaults] })` call so we
 * don't issue a second findUtxos (which re-decrypts cached events).
 *
 * Per vault: parallelize the `pool.isSpent` checks for each candidate UTXO,
 * then a single `vault.convertToAssets(totalShares)` for the assets value.
 */
export async function computeVaultPositions(
  bermuda: ISdk,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  utxosByToken: Record<string, any[] | undefined>,
  vaults: MorphoVault[],
): Promise<VaultPosition[]> {
  if (!SEPOLIA_VAULTS.length) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pool = bermuda.config.pool as any;
  const bigintToBytes32Hex = (n: bigint) =>
    "0x" + n.toString(16).padStart(64, "0").toLowerCase();

  const positions: (VaultPosition | null)[] = await Promise.all(
    SEPOLIA_VAULTS.map(async (sv): Promise<VaultPosition | null> => {
      const key = sv.address.toLowerCase();
      const utxos = utxosByToken[key];
      if (!utxos?.length) return null;

      const checks = await Promise.all(
        utxos.map(async (u) => {
          const nf: bigint = await u.getNullifier();
          const spent = await pool.isSpent(bigintToBytes32Hex(nf));
          return { amount: u.amount as bigint, spent };
        }),
      );
      const shieldedShares = checks.reduce(
        (s, c) => (c.spent ? s : s + c.amount),
        0n,
      );
      if (shieldedShares <= 0n) return null;

      let estimatedAssets: bigint = shieldedShares;
      try {
        estimatedAssets = (await morphoPublicClient.readContract({
          address: sv.address,
          abi: erc4626Abi,
          functionName: "convertToAssets",
          args: [shieldedShares],
        })) as bigint;
      } catch {
        /* fall back to raw shares */
      }

      const mainnetVault = vaults.find(
        (v) => getSepoliaVaultAddress(v).toLowerCase() === key,
      );

      return {
        vaultAddress: sv.address,
        vaultName: sv.name,
        vaultSymbol: sv.symbol,
        assetSymbol: sv.assetSymbol,
        assetDecimals: sv.assetDecimals,
        shareDecimals: sv.shareDecimals,
        assetAddress: sv.assetAddress,
        shares: shieldedShares,
        assets: estimatedAssets,
        netApy: mainnetVault?.netApy ?? 0,
      };
    }),
  );

  return positions.filter((p): p is VaultPosition => p !== null);
}

export function formatVaultApy(apy: number): string {
  return (apy * 100).toFixed(2) + "%";
}

export function formatVaultTvl(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${usd.toFixed(2)}`;
}

export function formatVaultAssets(
  amount: bigint | string,
  decimals: number,
): string {
  const raw = typeof amount === "string" ? BigInt(amount) : amount;
  const unit = 10n ** BigInt(decimals);
  const whole = raw / unit;
  const frac = raw % unit;
  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "")
    .slice(0, 4);
  if (fracStr === "") return whole.toLocaleString();
  return `${whole.toLocaleString()}.${fracStr}`;
}
