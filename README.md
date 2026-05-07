# Bermuda Demo App

Reference web app for the [Bermuda Bay](https://docs.bermudabay.xyz) privacy
protocol on Base Sepolia. Demonstrates the full lifecycle of a shielded
account: deposit, private transfer, withdraw, swap (via stealth burner), and
yield via Morpho vaults — all proofs generated client-side in the browser.

> Testnet only. No real funds are involved.

## Features

| Action | What happens |
| --- | --- |
| **Deposit** | Public USDC / WETH / native ETH → shielded UTXO. Generates a deposit proof + compliance attestation. |
| **Send** | Private transfer between two shielded addresses. Optional UTF-8 memo carried in the encrypted output. |
| **Withdraw** | Shielded balance → any public EVM address. Includes the indexed-merkle-tree exclusion proof. |
| **Swap** | Stateless stealth multicall: unshield → Uniswap V3 → reshield. The funds never appear on a publicly-linked address. |
| **Earn** | Deposit / withdraw shielded funds into [Morpho](https://morpho.org) ERC-4626 vaults via the same stealth burner pattern. |
| **Receive** | QR code for your shielded address. |

Other niceties: theme toggle, network guard, transaction history with on-chain
reconstruction (incoming + outgoing inferred from `NewCommitment` / `NewNullifier`
events), and a compliance status badge.

## Quick start

```bash
nvm use 22                  # Node.js >= 20.9 required (22 in .nvmrc)
npm install                 # runs postinstall — patches SDK, downloads circuits
cp .env.example .env.local  # then add your Privy App ID
npm run dev                 # http://localhost:3000
```

### Environment

Only one variable is required:

| Variable | Source | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | [dashboard.privy.io](https://dashboard.privy.io) | Passkey login. Create an app, enable **Passkey**, copy the App ID. |

A connected browser wallet (MetaMask, Rabby, etc.) also works as an alternative
to Privy passkeys.

### Testnet funds

- **ETH**: [Alchemy Base Sepolia faucet](https://www.alchemy.com/faucets/base-sepolia)
- **USDC**: [Circle faucet](https://faucet.circle.com/)

## How it works

### Auth flow

```
landing  → setup     → dashboard
(connect) (derive    (refresh balances,
           shielded   render history,
           account)   open actions)
```

The shielded account is derived deterministically from the user's signer.
Same wallet → same shielded address, every time. Privy passkeys and injected
wallets both produce a viem `walletClient`; we wrap it with a small adapter
([`makeBermudaSigner`](src/lib/bermuda.ts)) so the SDK's `personal_sign` path
works regardless of provider quirks.

### Stealth burner pattern (swap, vault deposit/withdraw)

`bermuda.stealth()` derives a one-shot EOA from the user's shielded keypair,
upgrades it to an EIP-7702 multicall implementation, and orchestrates:

1. **Unshield** the input token from the privacy pool to the burner.
2. Run the user-supplied callback that returns multicall steps (e.g. `approve →
   swap → approve` for a Uniswap swap, or `approve → vault.deposit → approve`
   for a Morpho deposit).
3. **Reshield** the output token back into the pool.

The whole thing is a single relayed transaction — no signing prompts.

## Project structure

```
src/
├── app/
│   ├── api/compliance/[...path]/    Same-origin proxy to the compliance engine
│   ├── api/morpho/vaults/           Proxy to Morpho's GraphQL (Base mainnet APY)
│   ├── dashboard/page.tsx           Main app: balance, actions, history, earn
│   ├── setup/page.tsx               Derive shielded account from signer
│   └── page.tsx                     Landing + auth
├── components/
│   ├── dashboard/                   ShieldModal, TransferModal, WithdrawModal,
│   │                                SwapModal, DepositModal, EarnWithdrawModal,
│   │                                EarnTab, TransactionHistory, ReceiveModal
│   ├── landing/                     PasskeyAuth, PasskeyFlow
│   └── ui/                          Modal, NetworkGuard, LoadingOverlay,
│                                    SwapAnimationOverlay, TxFlowOverlay, ...
├── lib/
│   ├── bermuda.ts                   SDK init, signer adapter, history loader,
│   │                                compliance check, formatters
│   ├── morpho.ts                    Vault metadata + positions
│   └── txMeta.ts                    localStorage metadata for outgoing notes
├── store/useStore.ts                Zustand store (auth, balances, history)
├── hooks/useTheme.ts
└── types/index.ts
public/circuits/84532/               Noir circuit JSONs (downloaded by postinstall)
scripts/
├── postinstall.sh                   SDK patches + circuit provisioning
├── patch-bermuda-strategy-memo.mjs  Preserve recipient memo on transfer outputs
└── patch-bermuda-findutxos.mjs      Incremental UTXO scan, parallel isSpent
```

## SDK patches

The `postinstall` script applies a few patches to `node_modules/@bermuda/sdk`
that are still required at v0.1.4. All patches are idempotent and live next
to the script that invokes them — see [`sdk-v0.1.4-patches.md`](sdk-v0.1.4-patches.md)
for the per-patch rationale and the patches that have been retired since v0.1.3.

Summary:

- **`prove.js`** — circuit JSONs are loaded from `/circuits/<chainId>/<name>.json`
  served by Next from `public/`, working around the missing CORS header on the
  upstream artifacts endpoint.
- **`relay.js`** — surfaces the relayer's response body in error messages so
  4xx/5xx errors aren't reduced to a generic "Bad Request".
- **`strategy.js`** — preserves the recipient `note` (memo) on transfer output
  UTXOs so the receiver can read it from the encrypted output channel.
- **`find-utxos.js`** — incremental decryption (only events past `lastIndex`
  in localStorage) and `isSpent` checks parallelized via `Promise.all`. Big
  speed win for accounts with thousands of cached events.

The same script also downloads the v0.1.4 circuit JSONs into `public/circuits/84532/`
since the SDK no longer ships Base Sepolia circuits in its bundle.

## Scripts

```bash
npm run dev          # next dev (webpack)
npm run dev:lan      # dev server bound to 0.0.0.0 (LAN access)
npm run build        # production build
npm start            # serve production build
npm run lint         # eslint
```

## Tech stack

- **Next.js 16** (webpack) + **React 19** + **TypeScript**
- **[@bermuda/sdk](https://docs.bermudabay.xyz)** v0.1.4 — privacy pool + ZK proofs in the browser
- **viem 2.47** + **wagmi 3** for wallet handling
- **@privy-io/react-auth 3** for passkey authentication
- **Zustand 5** for state, **TanStack Query 5** for async data
- **Tailwind v4**, **lucide-react**, **qrcode.react**
- **ethers 6** (transitively via the SDK)

## Notes

- **Browser-only.** All ZK proofs are generated client-side via Noir +
  Barretenberg. There is no server-side rendering of any account state.
- **Base Sepolia only.** The SDK config uses chain ID `84532` and the only
  configured ERC-4626 vault is the testnet MetaMorpho USDC vault.
- **Node.js ≥ 20.9** required for Next.js 16. `.nvmrc` pins 22.
- The `@bermuda/sdk` package is fetched directly from
  `https://api.tilapialabs.xyz/bermuda/v0/sdk/v0.1.4` rather than from npm.
  `legacy-peer-deps=true` is set in `.npmrc` to keep peer-dep checks loose
  during install.
