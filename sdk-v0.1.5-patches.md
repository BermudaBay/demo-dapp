# Bermuda SDK v0.1.5 — Required Patches

All patches live in `scripts/postinstall.sh` and the helper Node scripts it
calls. Four patches are applied to `node_modules/@bermuda/sdk/build/src/`
after install; all are idempotent.

---

## 1. `prove.js` — same-origin circuit loading (browser CORS workaround)

The SDK fetches circuits from `${config.artifacts}/${name}.json`
(`https://api.tilapialabs.xyz/bermuda/v0/base-sepolia/artifacts/v0.1.5/...`).
That endpoint serves the JSON but **does not include
`Access-Control-Allow-Origin`**, so a browser fetch from the demo origin is
blocked.

We rewrite the loader to fetch from `/circuits/${chainId}/${name}.json`,
served by Next from `public/`, and provision those files at install time
from the same upstream URL the SDK would have used. A `.version` sentinel
under `public/circuits/84532/` records which SDK version produced the
current artifacts and triggers a re-download on mismatch, so stale proving
keys never linger across SDK upgrades.

---

## 2. `relay.js` — surface response body in error messages

Upstream only includes `statusText` in the relay error, so 4xx/5xx
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

- queries chain from `snapshot.block` (the value populated from the GitHub
  chain-state snapshot), not from `utxoCache.block`, so it can re-download
  events we've already seen if the snapshot lags;
- re-decrypts every cached commitment event on every call (the loop runs
  `await Utxo.decrypt(...)` per event, regardless of whether the UTXO cache
  already contains the decrypted output);
- checks `isSpent` for each cached UTXO sequentially.

Patched behavior (see `scripts/patch-bermuda-findutxos.mjs`):

- start the chain query from `max(snapshot.block, utxoCache.block)`;
- track `lastIndex` (highest commitment index processed) in localStorage so
  non-ours events aren't re-decrypted on the next call;
- parallelize `isSpent` checks via `Promise.all`;
- thread `config.apiKey` into both
  `fetchComplianceBlackList(complianceManager, apiKey)` calls.
