/**
 * Persist outgoing transfer memo / counterparty by tx hash.
 * On-chain history reconstruction cannot read the recipient's encrypted note,
 * so we keep client-side metadata for the sender's view.
 */
const STORAGE_KEY = "bermuda-demo-tx-meta";
const MAX_ENTRIES = 200;

export type TxMeta = { note?: string; counterparty?: string };

export function loadTxMeta(): Record<string, TxMeta> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TxMeta>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveTxMetaEntry(txHash: string, meta: TxMeta) {
  if (typeof window === "undefined" || !txHash) return;
  try {
    const map = loadTxMeta();
    map[txHash] = { ...map[txHash], ...meta };
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) {
        delete map[k];
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / private mode */
  }
}
