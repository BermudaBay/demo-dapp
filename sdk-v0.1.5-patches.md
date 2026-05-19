# Bermuda SDK v0.1.5 — Required Patches

All patches live in `scripts/postinstall.sh` and the helper Node scripts it
calls. The same four patches that applied to v0.1.4 still apply to v0.1.5 —
the upstream minified shapes for `prove.js`, `relay.js`, `strategy.js`, and
`find-utxos.js` are effectively unchanged. The three v0.1.3-era fixes remain
retired because they were already shipped upstream at v0.1.4 and are still
present in v0.1.5.

---

## Status of v0.1.3 patches under v0.1.5

| v0.1.3 patch                                  | v0.1.5 status |
|-----------------------------------------------|---------------|
| `utils.js` — EIP-7702 nonce off-by-one        | **Fixed upstream** (still `nonce: o ?? a`). Removed. |
| `stealth.js` — `unshield` excluded `reshield` | **Fixed upstream** (still separate `if` branches). Removed. |
| `core.js` — compliance `signMessage(hex(E))`  | **Fixed upstream** (signs raw bytes). Removed. |

---

## What's new in the v0.1.5 upgrade

- Pool address rotated on Base Sepolia
  (`0xFf65...7439` → `0x226b...4b87`); the SDK's `storagePrefix` includes the
  pool address so existing localStorage caches are naturally namespaced and
  do not need manual invalidation.
- Compliance contract rotated (`0x4656...8b1b` → `0x8286...F785`).
- `startBlock` advanced to `41412330`.
- New `depositExpiryTtlBlocks: 1800n` field surfaced in the chain config.
- `fetchComplianceBlackList` now accepts an optional `apiKey` second argument
  — the `find-utxos.js` patch threads `r.apiKey` through both call sites
  inside `findFlaggedUtxos` and `findUtxosUpTo` to stay forward-compatible.
- Circuits move to `…/artifacts/v0.1.5/` upstream. The `postinstall.sh`
  download step now records the SDK version in `public/circuits/84532/.version`
  and wipes the directory on a mismatch, so switching SDK versions
  re-downloads instead of silently serving stale proving keys.

---

## 1. `prove.js` — same-origin circuit loading (browser CORS workaround)

v0.1.5 fetches circuits from `${config.artifacts}/${name}.json`
(e.g. `https://api.tilapialabs.xyz/bermuda/v0/base-sepolia/artifacts/v0.1.5/...`).
That endpoint serves the JSON but **does not include
`Access-Control-Allow-Origin`**, so a browser fetch from the demo origin is
blocked.

We rewrite the loader to fetch from `/circuits/${chainId}/${name}.json`
(served by Next from `public/`), and provision those files at install time
from the same upstream URL the SDK would have used.

v0.1.5 also gained a small in-memory artifact cache and same-process fetch
deduplication on top of v0.1.4. Our same-origin rewrite drops the cache for
simplicity — Next's static file serving + the browser's HTTP cache cover the
re-fetch case in practice.

---

## 2. `relay.js` — surface response body in error messages

v0.1.5 still only includes `statusText` in the relay error, so 4xx/5xx
responses arrive as opaque "Bad Request". The patch wraps the throw with a
`response.text()` read so the actual body is visible:

```text
Relay failed (400): { "error": "..." }
```

---

## 3. `strategy.js` — preserve recipient `note` (memo) on transfer outputs

`buildTransferInputsOutputs` does not copy `recipient.note` onto the
generated `Utxo`s, so the recipient never sees the memo even though the
encrypted-output channel can carry it.

Three minified-source replacements (see `scripts/patch-bermuda-strategy-memo.mjs`):

1. Recipient spec push in `M()` — preserve `note` on each `h.push(...)`.
2. Allocation push loop in `P()` — carry the memo onto the first chunk per
   output spec.
3. `Utxo` constructor map in `M()` — pass `note` into `new v({...})`.

The minified shapes for all three patterns are identical in v0.1.4 and
v0.1.5.

---

## 4. `find-utxos.js` — incremental decrypt + parallel `isSpent`

Stock `findUtxos` in v0.1.5:

- queries chain from `snapshot.block` (the value populated from the GitHub
  chain-state snapshot), not from `utxoCache.block`, so it can re-download
  events we've already seen if the snapshot lags;
- re-decrypts every cached commitment event on every call (the loop runs
  `await F.decrypt(...)` per event, regardless of whether `f.utxos`
  already contains the decrypted output);
- checks `isSpent` for each cached UTXO sequentially.

Patched behavior (see `scripts/patch-bermuda-findutxos.mjs`):

- start the chain query from `max(snapshot.block, utxoCache.block)`;
- track `lastIndex` (highest commitment index processed) in localStorage so
  non-ours events aren't re-decrypted on the next call;
- parallelize `isSpent` checks via `Promise.all`;
- thread `r.apiKey` into both `fetchComplianceBlackList(complianceManager, apiKey)`
  calls (new in v0.1.5).
