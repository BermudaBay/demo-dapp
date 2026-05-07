# Private Uniswap Swap via Bermuda SDK

## Concept

A "private swap" is an atomic operation that:

1. **Unshields** token A from the Bermuda shielded pool to an ephemeral burner wallet
2. **Executes** arbitrary public DeFi calls (approve + swap) from that burner
3. **Reshields** the swapped token B back into the shielded pool

The user's real address never touches the public DEX. The SDK's `stealth()` function orchestrates all of this — ZK proof generation, burner derivation, EIP-7702 delegation, multicall assembly — so you only need to provide the three middle calls.

## Prerequisites

```typescript
import { encodeFunctionData, erc20Abi } from "viem";

const bermuda = sdk("base-sepolia", {
  complianceManager: "/api/compliance",
});
await bermuda._.initBbSync();
```

You need a logged-in `shieldedAccount` (keypair) and `shieldedAddress` from the SDK.

## Step 1: Get a Quote (optional, for UX)

Standard Uniswap V3 QuoterV2 call — nothing Bermuda-specific:

```typescript
const QUOTER_V2 = "0xC5290058841028F1614F3A6F0F5816cAd0df5E27";
const POOL_FEE = 3000; // 0.3%

const result = await publicClient.simulateContract({
  address: QUOTER_V2,
  abi: quoterAbi,
  functionName: "quoteExactInputSingle",
  args: [{
    tokenIn: tokenInAddr,
    tokenOut: tokenOutAddr,
    amountIn: parsedAmount,
    fee: POOL_FEE,
    sqrtPriceLimitX96: 0n,
  }],
});
const expectedOut = result.result[0];
const minOut = (expectedOut * 99n) / 100n; // 1% slippage
```

## Step 2: Build & Execute the Stealth Swap

This is the core. One call to `bermuda.stealth()`:

```typescript
const SWAP_ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";

const poolAddress = await bermuda.config.pool.getAddress();

const { payload } = await bermuda.stealth(
  {
    spender: shieldedAccount,       // the user's keypair
    id: 0,                          // key index
    unshield: {
      token: tokenInAddr,           // e.g. USDC address
      amount: parsedAmount,         // amount to unshield (bigint)
    },
    reshield: {
      token: tokenOutAddr,          // e.g. WETH address
      amount: minOut,               // minimum amount to reshield (bigint)
      to: shieldedAddress,          // recipient shielded address (yourself)
    },
  },
  // Callback: receives the burner wallet, returns the public calls to execute
  async (burner) => {
    const burnerAddr = await burner.getAddress();

    // 1. Approve the swap router to spend tokenIn
    const approveIn = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [SWAP_ROUTER, parsedAmount],
    });

    // 2. Execute the Uniswap V3 exactInputSingle swap
    const swapCall = encodeFunctionData({
      abi: swapRouterAbi,
      functionName: "exactInputSingle",
      args: [{
        tokenIn: tokenInAddr,
        tokenOut: tokenOutAddr,
        fee: POOL_FEE,
        recipient: burnerAddr,       // output goes to burner
        amountIn: parsedAmount,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      }],
    });

    // 3. Approve the Bermuda pool to pull tokenOut for reshielding
    const approveOut = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [poolAddress, 2n ** 256n - 1n],
    });

    // Return the calls as {to, data} tuples
    return [
      { to: tokenInAddr,  data: approveIn },
      { to: SWAP_ROUTER,  data: swapCall },
      { to: tokenOutAddr, data: approveOut },
    ];
  },
);
```

## Step 3: Relay & Confirm

```typescript
// Submit via Bermuda relayer (abstracts gas, hides sender)
const txHash = await bermuda.relay(payload);

// Wait for on-chain confirmation
const receipt = await bermuda.wait(txHash);
if (!receipt || receipt.status === 0) {
  throw new Error("Swap transaction reverted");
}
```

## Deep Dive: The Burner Account

### What is the burner?

The burner is a **regular Ethereum EOA** (externally owned account) — just a standard private key / address pair. It is **not** a smart contract wallet. The SDK derives it deterministically from your shielded keypair so there's no key management burden.

### How is the burner derived?

```
seed = blake2s( UTF8("BERMUDA_V0_BURNER_ACCOUNT {id}") || bigint2bytes(spender.privkey) )
burnerWallet = new ethers.Wallet(seed)
```

- `id` is the nonce you pass (typically `0`). Using a different `id` gives a different burner.
- `spender.privkey` is the private key of the Bermuda shielded keypair.
- The result is a 32-byte blake2s hash used directly as a secp256k1 private key.
- The SDK validates the derived key is non-zero and below the secp256k1 curve order.

Because the derivation is deterministic, the **same burner address** is produced every time for the same keypair + id. This means:
- No need to store the burner key — it can always be re-derived.
- The burner address can be checked on-chain for existing code (important for the EIP-7702 step).

### EIP-7702: Turning the EOA into a multicall-capable account

A normal EOA can only execute one call per transaction. To run 5 calls atomically (unshield → approve → swap → approve → reshield), the burner needs multicall capability.

**EIP-7702** allows an EOA to temporarily delegate its execution to a contract implementation. The SDK does this by:

1. Checking if the burner already has delegated code: `provider.getCode(burnerAddress)`
2. If no code exists, signing an **EIP-7702 authorization** that points to the Bermuda `multiCall` contract:

```typescript
const auth = await burnerWallet.authorize({
  address: config.multiCall,   // the multicall implementation contract
  nonce: currentNonce,
  chainId: config.chainId,
});
```

3. This authorization is attached to the setup transaction as an `authorizationList`:

```json
{
  "chainId": 84532,
  "to": "0x0000000000000000000000000000000000000000",
  "data": "0x",
  "authorizationList": [
    {
      "address": "0x<multicall-implementation>",
      "nonce": 0,
      "chainId": 84532,
      "r": "0x...",
      "s": "0x...",
      "yParity": 0
    }
  ]
}
```

4. This setup payload is relayed first (`bermuda.relay(payload).then(bermuda.wait)`). After confirmation, the burner EOA now has the multicall contract's code at its address.

**After this, calling `burnerAddress.multicall(calls)` executes all calls sequentially in a single transaction.**

The authorization only needs to happen once per burner. On subsequent uses, the SDK detects `getCode() !== '0x'` and skips the delegation step.

## Deep Dive: How the Multicall Is Built

### The Multicall Contract ABI

```json
{
  "name": "multicall",
  "inputs": [{
    "name": "calls",
    "type": "tuple[]",
    "components": [
      { "name": "to",    "type": "address" },
      { "name": "data",  "type": "bytes"   },
      { "name": "value", "type": "uint256" }
    ]
  }],
  "outputs": [{ "name": "returnData", "type": "bytes[]" }],
  "stateMutability": "payable"
}
```

Each call in the array is a `{to, data, value}` tuple. The contract loops through them in order, calling each target with the given calldata.

### Step-by-step: How `stealth()` assembles the calls array

Here is exactly what the SDK builds, in order:

```
calls = []

// ── 1. Unshield (ZK withdrawal from shielded pool → burner) ──
if (params.unshield) {
  unshieldPayload = await bermuda.withdraw({
    spender: keypair,
    token:   tokenInAddr,
    amount:  parsedAmount,
    to:      burnerAddress,
  })
  calls.push({ to: poolAddress, data: unshieldPayload.data, value: 0n })
}

// ── 2. Your DeFi calls (from the callback) ──
userCalls = await action(burnerWallet)
// Returns: [
//   { to: USDC,        data: approve(SWAP_ROUTER, amount) },
//   { to: SWAP_ROUTER, data: exactInputSingle(...)        },
//   { to: WETH,        data: approve(poolAddress, MAX)     },
// ]
for (call of userCalls) {
  calls.push({ to: call.to, data: call.data, value: 0n })
}

// ── 3. Reshield (deposit swapped tokens back into shielded pool) ──
if (params.reshield) {
  reshieldPayload = await bermuda.deposit({
    signer: burnerWallet,
    token:  tokenOutAddr,
    amount: minOut,
    to:     shieldedAddress,
  })
  calls.push({ to: poolAddress, data: reshieldPayload.data, value: 0n })
}
```

So the final `calls` array looks like:

| Index | Target | Action |
|-------|--------|--------|
| 0 | Bermuda Pool | `transact(...)` — ZK withdrawal proof, moves tokenIn from pool to burner |
| 1 | Token In (e.g. USDC) | `approve(SWAP_ROUTER, amount)` — let Uniswap pull tokens |
| 2 | Uniswap SwapRouter | `exactInputSingle(...)` — execute the swap, output to burner |
| 3 | Token Out (e.g. WETH) | `approve(poolAddress, MAX_UINT256)` — let Bermuda pool pull swapped tokens |
| 4 | Bermuda Pool | `transact(...)` — ZK deposit proof, moves tokenOut from burner into shielded pool |

### Encoding the multicall

The SDK encodes the entire calls array into a single `multicall(calls)` calldata:

```typescript
const data = Interface.from(MULTICALL_ABI).encodeFunctionData('multicall', [calls]);
```

### The final payload

```typescript
payload = {
  chainId: 84532,              // Base Sepolia
  to:      burnerAddress,      // the call goes TO the burner itself
  data:    multicallCalldata,  // the encoded multicall
}
```

**Key insight:** The transaction's `to` field is the burner's own address. Because the burner has the multicall contract's code delegated via EIP-7702, calling the burner with `multicall(calls)` executes the multicall logic. Each sub-call in the array is then executed by the burner as `msg.sender`.

## Deep Dive: How the Relayer Submits the Transaction

### What is the relayer?

The Bermuda relayer is an off-chain HTTP service that:
- Receives transaction payloads from clients
- Submits them on-chain using its own ETH for gas
- Hides the user's IP / origin from the chain

### The relay call

```typescript
const txHash = await bermuda.relay(payload);
```

Under the hood, this is a simple POST:

```
POST {relayerUrl}/relay
Content-Type: application/json

{
  "chainId": 84532,
  "to": "0x<burner-address>",
  "data": "0x<multicall-encoded-calldata>"
}
```

If the burner hasn't been set up yet (first time use), the SDK sends the EIP-7702 setup transaction first, which includes the `authorizationList`. That request looks like:

```
POST {relayerUrl}/relay

{
  "chainId": 84532,
  "to": "0x0000000000000000000000000000000000000000",
  "data": "0x",
  "authorizationList": [{
    "address": "0x<multicall-contract>",
    "nonce": 0,
    "chainId": 84532,
    "r": "0x...",
    "s": "0x...",
    "yParity": 0
  }]
}
```

The relayer wraps this into a proper Ethereum transaction (type 0x04 for EIP-7702), signs it with its own key, and broadcasts it.

### Transaction confirmation

```typescript
const receipt = await bermuda.wait(txHash);
```

This calls `provider.waitForTransaction(txHash)` — standard ethers.js receipt polling.

## Complete Execution Timeline

Here's the full sequence from user click to confirmed swap:

```
1. bermuda.stealth() called
   │
   ├─ 2. Derive burner wallet from blake2s(prefix || privkey)
   │
   ├─ 3. Check: does burner have code?
   │     ├─ NO  → Sign EIP-7702 auth → relay setup tx → wait for confirmation
   │     └─ YES → Skip (burner already multicall-capable)
   │
   ├─ 4. Generate ZK unshield proof (withdraw tokenIn → burner)
   │
   ├─ 5. Run your callback(burnerWallet)
   │     └─ Returns: [approveIn, swap, approveOut]
   │
   ├─ 6. Generate ZK reshield proof (deposit tokenOut → shielded pool)
   │
   ├─ 7. Assemble calls array:
   │     [unshield, approveIn, swap, approveOut, reshield]
   │
   └─ 8. Encode as multicall(calls), return { payload, signer }

9. bermuda.relay(payload)
   └─ POST to relayer → relayer submits tx on-chain

10. bermuda.wait(txHash)
    └─ Poll for receipt → confirmed
```

All 5 operations in the multicall execute atomically — if any single call reverts, the entire transaction reverts. No partial state.

## Contract Addresses (Base Sepolia)

| Contract | Address |
|----------|---------|
| Uniswap V3 SwapRouter | `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4` |
| Uniswap V3 QuoterV2 | `0xC5290058841028F1614F3A6F0F5816cAd0df5E27` |
| Pool fee | `3000` (0.3%) |
| Bermuda Pool | `bermuda.config.pool.getAddress()` |
| Multicall impl | `bermuda.config.multiCall` |
| USDC | `bermuda.config.USDC` |
| WETH | `bermuda.config.WETH` |

## Key Points for Integration

1. **The callback is flexible** — you can put any DeFi calls in there (lending, staking, etc.), not just Uniswap. The pattern is always: approve-in → do stuff → approve-out.

2. **The `reshield.amount` is a minimum** — if the swap returns more than `minOut`, the excess stays on the burner. Set slippage tolerance accordingly.

3. **You never touch the burner's private key** — the SDK derives it, uses it internally, and it's deterministic from the shielded keypair.

4. **Gas is abstracted** — `bermuda.relay()` submits through the Bermuda relayer, so the user doesn't need ETH for gas.

5. **The pool approval (step 3 in the callback)** is needed so the reshield can pull the swapped tokens back into the shielded pool. Using `MaxUint256` avoids needing to know the exact output amount.

6. **EIP-7702 setup is a one-time cost** — the first stealth action for a given burner `id` requires an extra relay round-trip to delegate code. Subsequent calls skip this.

7. **The multicall `to` is the burner itself** — because EIP-7702 places the multicall code at the burner's address, the transaction calls the burner, which then loops through each sub-call as `msg.sender = burnerAddress`.

## Troubleshooting: Common Issues

### "Uniswap call reverts"
The swap call's `recipient` must be the **burner address**, not the user's EOA or shielded address. The reshield step handles moving tokens back to the shielded pool.

### "Insufficient allowance" on reshield
Make sure your callback includes the `approve(poolAddress, MAX_UINT256)` for the output token. The reshield's `deposit()` calls `transferFrom` on the burner.

### "Call to multicall fails"
Verify the EIP-7702 delegation happened. Check `provider.getCode(burnerAddress)` — it should not be `'0x'`. If it is, the setup relay may have failed silently.

### "Relayer returns 4xx"
The relayer expects `{ chainId, to, data }` (and optionally `authorizationList`). Ensure `chainId` is a `number`, not a `bigint`.

## ABI References

### QuoterV2 ABI (quoteExactInputSingle)

```json
[
  {
    "inputs": [
      {
        "components": [
          { "name": "tokenIn", "type": "address" },
          { "name": "tokenOut", "type": "address" },
          { "name": "amountIn", "type": "uint256" },
          { "name": "fee", "type": "uint24" },
          { "name": "sqrtPriceLimitX96", "type": "uint160" }
        ],
        "name": "params",
        "type": "tuple"
      }
    ],
    "name": "quoteExactInputSingle",
    "outputs": [
      { "name": "amountOut", "type": "uint256" },
      { "name": "sqrtPriceX96After", "type": "uint160" },
      { "name": "initializedTicksCrossed", "type": "uint32" },
      { "name": "gasEstimate", "type": "uint256" }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
]
```

### SwapRouter ABI (exactInputSingle)

```json
[
  {
    "inputs": [
      {
        "components": [
          { "name": "tokenIn", "type": "address" },
          { "name": "tokenOut", "type": "address" },
          { "name": "fee", "type": "uint24" },
          { "name": "recipient", "type": "address" },
          { "name": "amountIn", "type": "uint256" },
          { "name": "amountOutMinimum", "type": "uint256" },
          { "name": "sqrtPriceLimitX96", "type": "uint160" }
        ],
        "name": "params",
        "type": "tuple"
      }
    ],
    "name": "exactInputSingle",
    "outputs": [{ "name": "amountOut", "type": "uint256" }],
    "stateMutability": "payable",
    "type": "function"
  }
]
```
