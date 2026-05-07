# Bermuda SDK v0.1.4 — Required Patches

All patches live in `scripts/postinstall.sh` and the helper Node scripts it
calls. Three v0.1.3-era fixes have been retired because v0.1.4 ships them
upstream.

---

## Status of v0.1.3 patches under v0.1.4

| v0.1.3 patch                                  | v0.1.4 status |
|-----------------------------------------------|---------------|
| `utils.js` — EIP-7702 nonce off-by-one        | **Fixed upstream** (`nonce: o ?? a`). Removed. |
| `stealth.js` — `unshield` excluded `reshield` | **Fixed upstream** (`if/if`, no longer `else if`). Removed. |
| `core.js` — compliance `signMessage(hex(E))`  | **Fixed upstream** (signs raw bytes). Removed. |

---

## 1. `prove.js` — same-origin circuit loading (browser CORS workaround)

v0.1.4 fetches circuits from `${config.artifacts}/${name}.json`
(e.g. `https://api.tilapialabs.xyz/bermuda/v0/base-sepolia/artifacts/v0.1.4/...`).
That endpoint serves the JSON but **does not include
`Access-Control-Allow-Origin`**, so a browser fetch from the demo origin is
blocked.

We rewrite the loader to fetch from `/circuits/${chainId}/${name}.json`
(served by Next from `public/`), and provision those files at install time
from the same upstream URL the SDK would have used.

---

## 2. `relay.js` — surface response body in error messages

Default v0.1.4 only includes `statusText` in the relay error, so 4xx/5xx
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

---

## 4. `find-utxos.js` — incremental decrypt + parallel `isSpent`

Stock `findUtxos`:

- queries chain from `snapshot.block` (overwritten by GitHub fetch), not
  from `utxoCache.block`, so it re-downloads events we've already seen;
- re-decrypts every cached commitment event on every call;
- checks `isSpent` for each cached UTXO sequentially.

Patched behavior (see `scripts/patch-bermuda-findutxos.mjs`):

- start the chain query from `max(snapshot.block, utxoCache.block)`;
- track `lastIndex` (highest commitment index processed) in localStorage so
  non-ours events aren't re-decrypted;
- parallelize `isSpent` checks via `Promise.all`.
