"use client";

import type { AnySignerLike, ISdk } from "@bermuda/sdk";
import type { TxHistoryItem, TxType, ComplianceStatus, TokenSymbol } from "@/types";

let bermudaInstance: ISdk | null = null;
let initPromise: Promise<ISdk> | null = null;

export async function getBermuda(): Promise<ISdk> {
  if (bermudaInstance) return bermudaInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const sdkModule = await import("@bermuda/sdk");
    const sdk = sdkModule.default;
    const instance = sdk("base-sepolia", {
      complianceManager: "/api/compliance",
    });
    bermudaInstance = instance;
    return instance;
  })();

  return initPromise;
}

/**
 * Build a signer for the Bermuda SDK (`bermuda.account({ signer })`) that
 * never goes through viem's `signMessage` action.
 *
 * Why we need this:
 *   v0.1.4 of `@bermuda/sdk` calls `signer.signMessage(<Uint8Array>)` (via
 *   `toAnySigner`), which under viem 2.47.10 ends up on
 *   `walletClient.request({ method: "personal_sign", params: [hex, address] })`.
 *   With certain providers (Privy embedded wallets, in particular) the
 *   message ends up serialized as `[object Object]` somewhere on the wire and
 *   the signing endpoint rejects the request with:
 *     "Invalid message \"data\": [object Object] must be a valid string."
 *
 *   By eagerly converting the bytes to a 0x-prefixed hex string in the demo
 *   app's own bundle (where the `Uint8Array` constructor is shared with viem),
 *   and bypassing `walletClient.signMessage` in favour of a direct
 *   `walletClient.request({ method: "personal_sign", ... })`, we sidestep the
 *   transformation and the resulting validation error.
 *
 *   Anysigner picks the right branch based on which keys are present:
 *     - "authorize" in signer  → ethers Wallet path   (passes Uint8Array as-is)
 *     - "address"  in signer   → wraps as `{message: {raw: t}}`           ← we use this
 *     - else (viem walletClient) → uses `client.signMessage` action
 *   By exposing a top-level `address` we guarantee the second branch and own
 *   the call to `signMessage` ourselves.
 */
function toHexString(value: Uint8Array | string): `0x${string}` {
  if (value instanceof Uint8Array) {
    let s = "";
    for (let i = 0; i < value.length; i++) {
      s += value[i].toString(16).padStart(2, "0");
    }
    return `0x${s}`;
  }
  if (typeof value === "string" && value.startsWith("0x")) {
    return value as `0x${string}`;
  }
  const bytes = new TextEncoder().encode(String(value));
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return `0x${s}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeBermudaSigner(walletClient: any): AnySignerLike {
  const address: `0x${string}` =
    typeof walletClient.account === "string"
      ? walletClient.account
      : walletClient.account?.address;
  if (!address) {
    throw new Error("walletClient must have an account address");
  }
  return {
    address,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async signMessage(args: any): Promise<`0x${string}`> {
      // anysigner branch 2 always invokes us as `signMessage({message:{raw:t}})`
      // where `t` is whatever the SDK passed (a Uint8Array in v0.1.4).
      const message = args?.message ?? args;
      const raw = message?.raw ?? message;
      const hex = toHexString(raw);
      return walletClient.request({
        method: "personal_sign",
        params: [hex, address],
      });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async signTypedData(...callArgs: any[]): Promise<`0x${string}`> {
      // Privy walletClients implement signTypedData; defer to viem actions
      // which handle these correctly. The SDK only exercises this path for
      // x402/permit-style flows that are not the breaking case.
      return walletClient.signTypedData(...callArgs);
    },
    // anysigner.chainId() falls through to `signer.getChainId()` and wraps the
    // result in BigInt. viem's walletClient.getChainId returns a number.
    async getChainId(): Promise<number> {
      if (typeof walletClient.getChainId === "function") {
        return walletClient.getChainId();
      }
      const hex: string = await walletClient.request({ method: "eth_chainId" });
      return Number.parseInt(hex, 16);
    },
    // anysigner.readContract delegates here for permit (deposit) and safe paths.
    // Our walletClients are extended with publicActions, so this is just a
    // pass-through to viem's `readContract` action.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async readContract(args: any): Promise<unknown> {
      if (typeof walletClient.readContract !== "function") {
        throw new Error("walletClient is missing readContract action");
      }
      return walletClient.readContract(args);
    },
    // The shape above isn't structurally identical to any single AnySignerLike
    // member, but it's duck-typed correctly: at runtime the SDK's toAnySigner
    // dispatches on `"address" in signer` and treats us as a viem-Account-like
    // signer. The cast here is the cost of v0.1.4's stricter union type.
  } as unknown as AnySignerLike;
}

/**
 * Query pool events with automatic chunking on failure.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function queryFilterSafe(pool: any, filter: any, startBlock: any, currentBlock: any) {
  try {
    return await pool.queryFilter(filter, startBlock, currentBlock);
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events: any[] = [];
    const chunkSize = 50000n;
    const start = BigInt(startBlock);
    const end = BigInt(currentBlock);
    for (let from = start; from <= end; from += chunkSize) {
      const to = from + chunkSize - 1n > end ? end : from + chunkSize - 1n;
      try {
        const chunk = await pool.queryFilter(filter, from, to);
        events.push(...chunk);
      } catch {
        /* skip chunk */
      }
    }
    return events;
  }
}

function bigintToBytes32Hex(n: bigint): string {
  return "0x" + n.toString(16).padStart(64, "0").toLowerCase();
}

/**
 * From a `findUtxos({ excludeSpent: false })` result, compute per-token
 * shielded totals AND return the unspent UTXO subsets — so callers can reuse
 * the (already paid-for) isSpent checks instead of doing them again later
 * (e.g. compliance check, vault position computation).
 */
export async function resolveUnspentByToken(
  bermuda: ISdk,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  utxosByToken: Record<string, any[] | undefined>,
  usdcKey: string,
  wethKey: string,
): Promise<{
  shieldedUSDC: bigint;
  shieldedWETH: bigint;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unspentUSDC: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unspentWETH: any[];
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pool = bermuda.config.pool as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function partition(list: any[] | undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!list?.length) return { total: 0n, unspent: [] as any[] };
    const checks = await Promise.all(
      list.map(async (u) => {
        const nf: bigint = await u.getNullifier();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const spent = await pool.isSpent(bigintToBytes32Hex(nf) as any);
        return { utxo: u, spent };
      }),
    );
    const unspent = checks.filter((c) => !c.spent).map((c) => c.utxo);
    const total = unspent.reduce((s, u) => s + (u.amount as bigint), 0n);
    return { total, unspent };
  }

  const [usdc, weth] = await Promise.all([
    partition(utxosByToken[usdcKey]),
    partition(utxosByToken[wethKey]),
  ]);

  return {
    shieldedUSDC: usdc.total,
    shieldedWETH: weth.total,
    unspentUSDC: usdc.unspent,
    unspentWETH: weth.unspent,
  };
}


/**
 * The SDK dropped `utxo.type` so we can no longer classify history items from
 * UTXO metadata. Instead, decode the pool's `transact(_args, _extData, ...)`
 * call from each tx and read `_extData.extAmount`:
 *
 *   extAmount > 0 → deposit (shield)
 *   extAmount = 0 → transfer
 *   extAmount < 0 → withdraw
 *
 * Tx kind is immutable per tx hash, so we cache it in localStorage forever.
 */
type TxKind = "shield" | "transfer" | "withdraw";

const TX_KIND_CACHE_KEY = "bermuda:txkind";

function loadTxKindCache(): Record<string, TxKind> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(TX_KIND_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveTxKindCache(cache: Record<string, TxKind>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TX_KIND_CACHE_KEY, JSON.stringify(cache));
  } catch { /* quota */ }
}

const TRANSACT_FN_SELECTOR = "0xe1458315"; // transact(_args, _extData, _permit, _attestation)
const TRANSACT_PARAM_TYPES = [
  "(bytes,bytes32[],bytes32,bytes32[],bytes32[],uint256,bytes32)",
  "(address,int256,address,uint256,uint256,bytes[],bool,address,address)",
  "uint256",
  "uint8",
  "bytes32",
  "bytes32",
];

async function classifyTxKinds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  provider: any,
  txHashes: string[],
): Promise<Record<string, TxKind>> {
  const cache = loadTxKindCache();
  const missing = txHashes.filter((h) => !cache[h]);
  if (missing.length === 0) return cache;

  const { AbiCoder } = await import("ethers");
  const coder = AbiCoder.defaultAbiCoder();

  await Promise.all(
    missing.map(async (hash) => {
      try {
        const tx = await provider.getTransaction(hash);
        if (!tx?.data || !tx.data.startsWith(TRANSACT_FN_SELECTOR)) return;
        const decoded = coder.decode(TRANSACT_PARAM_TYPES, "0x" + tx.data.slice(10));
        const extAmount = decoded[1][1] as bigint;
        cache[hash] = extAmount > 0n ? "shield" : extAmount < 0n ? "withdraw" : "transfer";
      } catch { /* tx may have been pruned or not a transact call */ }
    }),
  );

  saveTxKindCache(cache);
  return cache;
}

export type LoadShieldedHistoryOptions = {
  /** Reuse an initialized SDK instance (skips getBermuda). */
  bermuda?: ISdk;
  /**
   * UTXOs from a single `findUtxos({ excludeSpent: false, tokens })` call.
   * When set, skips an extra findUtxos inside history loading.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  utxos?: any[];
};

/**
 * Load shielded transaction history from on-chain data.
 *
 * Reconstructs both incoming AND outgoing transactions by:
 * 1. Decrypting all NewCommitment events to find our UTXOs.
 * 2. Querying NewNullifier events to detect which of our UTXOs were spent.
 * 3. For each spending tx, computing the net outgoing amount
 *    (spent inputs minus change received in the same tx).
 * 4. Filtering out "change" UTXOs so they don't appear as false incoming items.
 */
export async function loadShieldedHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shieldedAccount: any,
  opts?: LoadShieldedHistoryOptions,
): Promise<TxHistoryItem[]> {
  const bermuda = opts?.bermuda ?? (await getBermuda());
  const usdcAddress = bermuda.config.USDC!;
  const wethAddress = bermuda.config.WETH!;

  const usdcKey = usdcAddress.toLowerCase();
  const wethKey = wethAddress.toLowerCase();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let utxos: any[];
  if (opts?.utxos) {
    utxos = opts.utxos;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allUtxos: Record<string, any[]> = await bermuda.findUtxos({
      keypair: shieldedAccount,
      tokens: [usdcAddress, wethAddress],
      excludeSpent: false,
    });
    utxos = [
      ...(allUtxos[usdcKey] || []),
      ...(allUtxos[wethKey] || []),
    ];
  }
  if (utxos.length === 0) return [];

  // Resolve UTXO token field (Uint8Array) to a symbol
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function utxoTokenSymbol(utxo: any): TokenSymbol {
    try {
      const addr = "0x" + Array.from(utxo.token as Uint8Array)
        .map((b: number) => b.toString(16).padStart(2, "0"))
        .join("");
      if (addr.toLowerCase() === wethKey) return "WETH";
    } catch { /* default USDC */ }
    return "USDC";
  }

  // Extract human-readable note from UTXO (bytes → string)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function utxoNote(utxo: any): string | undefined {
    try {
      const raw = utxo?.note;
      if (raw == null) return undefined;
      const bytes =
        raw instanceof Uint8Array
          ? raw
          : ArrayBuffer.isView(raw)
            ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
            : null;
      if (!bytes || bytes.length === 0) return undefined;
      // A single zero byte is the SDK's default empty note
      if (bytes.length === 1 && bytes[0] === 0) return undefined;
      const text = new TextDecoder().decode(bytes).trim();
      return text.length > 0 ? text : undefined;
    } catch {
      return undefined;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pool = bermuda.config.pool as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provider = bermuda.config.provider as any;
  const startBlock = bermuda.config.startBlock;
  const currentBlock = await provider.getBlockNumber();

  // Query NewCommitment and NewNullifier events in parallel
  const [commitmentEvents, nullifierEvents] = await Promise.all([
    queryFilterSafe(pool, pool.filters.NewCommitment(), startBlock, currentBlock),
    queryFilterSafe(pool, pool.filters.NewNullifier(), startBlock, currentBlock),
  ]);

  // Map UTXO index -> creation info (from commitments)
  const indexToCreation: Record<string, { blockNumber: number; txHash: string }> = {};
  for (const ev of commitmentEvents) {
    indexToCreation[ev.args.index.toString()] = {
      blockNumber: ev.blockNumber,
      txHash: ev.transactionHash,
    };
  }

  // Map nullifier hex -> spending info
  const nullifierToSpend: Record<string, { blockNumber: number; txHash: string }> = {};
  for (const ev of nullifierEvents) {
    const key = (typeof ev.args.nullifier === "bigint"
      ? bigintToBytes32Hex(ev.args.nullifier)
      : ev.args.nullifier.toString().toLowerCase()
    );
    nullifierToSpend[key] = {
      blockNumber: ev.blockNumber,
      txHash: ev.transactionHash,
    };
  }

  // For each UTXO, compute nullifier and determine if/when it was spent
  interface UtxoInfo {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    utxo: any;
    creationTxHash?: string;
    creationBlock?: number;
    spentTxHash?: string;
    spentBlock?: number;
  }

  const utxoInfos: UtxoInfo[] = await Promise.all(
    utxos.map(async (utxo) => {
      const nullifierBigInt: bigint = await utxo.getNullifier();
      const nullifierHex = bigintToBytes32Hex(nullifierBigInt);
      const creation = indexToCreation[utxo.index.toString()];
      const spend = nullifierToSpend[nullifierHex];
      return {
        utxo,
        creationTxHash: creation?.txHash,
        creationBlock: creation?.blockNumber,
        spentTxHash: spend?.txHash,
        spentBlock: spend?.blockNumber,
      };
    }),
  );

  // Group UTXOs by creation tx
  const creationTxGroups: Record<string, UtxoInfo[]> = {};
  for (const info of utxoInfos) {
    if (!info.creationTxHash) continue;
    (creationTxGroups[info.creationTxHash] ??= []).push(info);
  }

  // Group spent UTXOs by the tx that spent them
  const spendingTxGroups: Record<string, UtxoInfo[]> = {};
  for (const info of utxoInfos) {
    if (!info.spentTxHash) continue;
    (spendingTxGroups[info.spentTxHash] ??= []).push(info);
  }

  // UTXOs created in a spending tx are either change or withdrawal outputs —
  // they should not be listed as standalone incoming items.
  const changeUtxoIndices = new Set<string>();
  for (const txHash of Object.keys(spendingTxGroups)) {
    for (const info of creationTxGroups[txHash] || []) {
      changeUtxoIndices.add(info.utxo.index.toString());
    }
  }

  // Batch-fetch unique block timestamps
  const allBlockNums = new Set<number>();
  for (const info of utxoInfos) {
    if (info.creationBlock) allBlockNums.add(info.creationBlock);
    if (info.spentBlock) allBlockNums.add(info.spentBlock);
  }
  const blockTimestamps: Record<number, number> = {};
  const blockArr = [...allBlockNums];
  const BATCH = 24;
  for (let i = 0; i < blockArr.length; i += BATCH) {
    await Promise.all(
      blockArr.slice(i, i + BATCH).map(async (bn) => {
        try {
          const block = await provider.getBlock(bn);
          if (block) blockTimestamps[bn] = Number(block.timestamp) * 1000;
        } catch {
          /* skip */
        }
      }),
    );
  }

  // Classify every involved tx by decoding pool.transact() calldata.
  const involvedTxHashes = new Set<string>();
  for (const info of utxoInfos) {
    if (info.creationTxHash) involvedTxHashes.add(info.creationTxHash);
    if (info.spentTxHash) involvedTxHashes.add(info.spentTxHash);
  }
  const txKinds = await classifyTxKinds(provider, [...involvedTxHashes]);

  const items: TxHistoryItem[] = [];

  // --- Incoming items: non-change UTXOs created for us ---
  for (const info of utxoInfos) {
    const idxKey = info.utxo.index.toString();
    if (changeUtxoIndices.has(idxKey)) continue;

    const kind = info.creationTxHash ? txKinds[info.creationTxHash] : undefined;
    let type: TxType;
    if (kind === "shield") type = "shield";
    else if (kind === "transfer") type = "private-transfer";
    else continue; // unknown / withdraw outputs are not standalone incoming items

    const timestamp = info.creationBlock
      ? blockTimestamps[info.creationBlock] || Date.now()
      : Date.now();

    items.push({
      id: `utxo-${idxKey}`,
      direction: "incoming",
      type,
      token: utxoTokenSymbol(info.utxo),
      amount: info.utxo.amount,
      note: utxoNote(info.utxo),
      txHash: info.creationTxHash,
      timestamp,
      status: "confirmed",
    });
  }

  // --- Outgoing items: reconstructed from spending transactions ---
  for (const [txHash, spentInfos] of Object.entries(spendingTxGroups)) {
    const spentAmount = spentInfos.reduce((s, i) => s + (i.utxo.amount as bigint), 0n);

    // UTXOs we received back in this same tx — for transfers these are change,
    // for withdrawals they're remainder UTXOs from the change outputs.
    const receivedInTx = creationTxGroups[txHash] || [];
    let changeAmount = 0n;
    let txNote: string | undefined;
    for (const info of receivedInTx) {
      changeAmount += info.utxo.amount as bigint;
      if (!txNote) txNote = utxoNote(info.utxo);
    }
    if (!txNote) {
      for (const info of spentInfos) {
        txNote = utxoNote(info.utxo);
        if (txNote) break;
      }
    }

    const netOutgoing = spentAmount - changeAmount;
    if (netOutgoing <= 0n) continue;

    const kind = txKinds[txHash];
    const type: TxType =
      kind === "withdraw" ? "public-withdraw" : "private-transfer";

    const spentBlock = spentInfos[0]?.spentBlock;
    const timestamp = spentBlock
      ? blockTimestamps[spentBlock] || Date.now()
      : Date.now();

    items.push({
      id: `spend-${txHash.slice(0, 18)}`,
      direction: "outgoing",
      type,
      token: utxoTokenSymbol(spentInfos[0].utxo),
      amount: netOutgoing,
      note: txNote,
      txHash,
      timestamp,
      status: "confirmed",
    });
  }

  items.sort((a, b) => b.timestamp - a.timestamp);
  return items;
}

/**
 * Check the compliance status of the user's shielded balance.
 *
 * v0.1.4 changed `findUtxosUpTo({targetCompliant: false})` semantics: it now
 * throws "insufficient UTXOs" / "cannot cover amount" when the target can't
 * be covered from uncompliant funds — which is the common case (no flagged
 * funds at all). The SDK's `findFlaggedUtxos` does the right thing but isn't
 * exposed on the root ISdk, so we replicate its logic: list unspent UTXOs,
 * fetch the compliance blacklist, and sum amounts of UTXOs that contain any
 * blacklisted sub-deposit ID.
 */
export type CheckComplianceOptions = {
  bermuda?: ISdk;
  /** When set, skips an extra bermuda.balance() (duplicate findUtxos). */
  shieldedUSDC?: bigint;
  /**
   * Pre-fetched USDC UTXOs (unspent). When provided, skips the extra findUtxos
   * call entirely — caller already has the result from the dashboard's combined
   * findUtxos. Pass UTXOs that have been verified as unspent.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unspentUsdcUtxos?: any[];
};

export async function checkComplianceStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shieldedAccount: any,
  options?: CheckComplianceOptions,
): Promise<ComplianceStatus> {
  const bermuda = options?.bermuda ?? (await getBermuda());
  const usdcAddress = bermuda.config.USDC!;
  const usdcKey = usdcAddress.toLowerCase();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let usdcUtxos: any[];
    if (options?.unspentUsdcUtxos) {
      usdcUtxos = options.unspentUsdcUtxos;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const utxosByToken: Record<string, any[] | undefined> = await bermuda.findUtxos({
        keypair: shieldedAccount,
        tokens: [usdcAddress],
        excludeSpent: true,
      });
      usdcUtxos = utxosByToken[usdcKey] || [];
    }

    if (usdcUtxos.length === 0) {
      return { isFullyCompliant: true, compliantAmount: 0n, uncompliantAmount: 0n, checked: true };
    }

    const complianceManager = (bermuda.config.complianceManager || "").replace(/\/$/, "");
    let blacklistSet = new Set<bigint>();
    if (complianceManager) {
      const res = await fetch(`${complianceManager}/blacklist`);
      if (res.ok) {
        const { blacklist } = (await res.json()) as { blacklist?: string[] };
        blacklistSet = new Set((blacklist || []).map((b) => BigInt(b)));
      }
    }

    let uncompliantAmount = 0n;
    if (blacklistSet.size > 0) {
      for (const utxo of usdcUtxos) {
        const ids: bigint[] = utxo.subDepositIds || [];
        const amounts: bigint[] = utxo.subDepositAmounts || [];
        for (let i = 0; i < ids.length; i++) {
          if (amounts[i] === 0n) continue;
          if (blacklistSet.has(ids[i])) {
            uncompliantAmount += utxo.amount as bigint;
            break;
          }
        }
      }
    }

    const total =
      options?.shieldedUSDC !== undefined
        ? options.shieldedUSDC
        : usdcUtxos.reduce((s, u) => s + (u.amount as bigint), 0n);
    const compliantAmount = total > uncompliantAmount ? total - uncompliantAmount : 0n;

    return {
      isFullyCompliant: uncompliantAmount === 0n,
      compliantAmount,
      uncompliantAmount,
      checked: true,
    };
  } catch (err) {
    console.error("Compliance check failed:", err);
    return {
      isFullyCompliant: true,
      compliantAmount: 0n,
      uncompliantAmount: 0n,
      checked: false,
    };
  }
}

export function formatUSDC(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const frac = amount % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  if (fracStr === "") return whole.toLocaleString();
  return `${whole.toLocaleString()}.${fracStr}`;
}

/** Plain decimal string without locale formatting — suitable for input fields. */
export function formatUSDCRaw(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const frac = amount % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  if (fracStr === "") return whole.toString();
  return `${whole}.${fracStr}`;
}

export function parseUSDC(amount: string): bigint {
  const parts = amount.split(".");
  const whole = BigInt(parts[0] || "0") * 1_000_000n;
  if (parts.length === 1) return whole;
  const fracStr = (parts[1] || "0").padEnd(6, "0").slice(0, 6);
  return whole + BigInt(fracStr);
}

const ETH_DECIMALS = 18n;
const ETH_UNIT = 10n ** ETH_DECIMALS;

export function formatETH(amount: bigint): string {
  const whole = amount / ETH_UNIT;
  const frac = amount % ETH_UNIT;
  const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "").slice(0, 6);
  if (fracStr === "") return whole.toLocaleString();
  return `${whole.toLocaleString()}.${fracStr}`;
}

export function formatETHRaw(amount: bigint): string {
  const whole = amount / ETH_UNIT;
  const frac = amount % ETH_UNIT;
  const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "").slice(0, 6);
  if (fracStr === "") return whole.toString();
  return `${whole}.${fracStr}`;
}

export function parseETH(amount: string): bigint {
  const parts = amount.split(".");
  const whole = BigInt(parts[0] || "0") * ETH_UNIT;
  if (parts.length === 1) return whole;
  const fracStr = (parts[1] || "0").padEnd(18, "0").slice(0, 18);
  return whole + BigInt(fracStr);
}

const WETH_DECIMALS = 18n;
const WETH_UNIT = 10n ** WETH_DECIMALS;

export function formatWETH(amount: bigint): string {
  const whole = amount / WETH_UNIT;
  const frac = amount % WETH_UNIT;
  const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "").slice(0, 6);
  if (fracStr === "") return whole.toLocaleString();
  return `${whole.toLocaleString()}.${fracStr}`;
}

export function formatWETHRaw(amount: bigint): string {
  const whole = amount / WETH_UNIT;
  const frac = amount % WETH_UNIT;
  const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "").slice(0, 6);
  if (fracStr === "") return whole.toString();
  return `${whole}.${fracStr}`;
}

export function parseWETH(amount: string): bigint {
  const parts = amount.split(".");
  const whole = BigInt(parts[0] || "0") * WETH_UNIT;
  if (parts.length === 1) return whole;
  const fracStr = (parts[1] || "0").padEnd(18, "0").slice(0, 18);
  return whole + BigInt(fracStr);
}

export function formatToken(amount: bigint, token: TokenSymbol): string {
  return token === "USDC" ? formatUSDC(amount) : formatWETH(amount);
}

export function formatTokenRaw(amount: bigint, token: TokenSymbol): string {
  return token === "USDC" ? formatUSDCRaw(amount) : formatWETHRaw(amount);
}

export function parseToken(amount: string, token: TokenSymbol): bigint {
  return token === "USDC" ? parseUSDC(amount) : parseWETH(amount);
}

export function shortenAddress(addr: string, chars = 6): string {
  if (!addr) return "";
  if (addr.length <= chars * 2 + 2) return addr;
  return `${addr.slice(0, chars + 2)}...${addr.slice(-chars)}`;
}
