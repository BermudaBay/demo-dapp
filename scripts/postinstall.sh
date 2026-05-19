#!/bin/bash
# Post-install hook for @bermuda/sdk v0.1.5 on Base Sepolia.
#
# Three categories of work happen here:
#   1. Source-level SDK patches that are still required at v0.1.5.
#   2. Stub for a deprecated transitive type-only package (@types/psl).
#   3. Provisioning circuit artifacts under public/circuits/84532/.
#
# Patches that existed for v0.1.3 and earlier are intentionally NOT
# carried forward — they have been verified fixed upstream and remain
# fixed at v0.1.5:
#   - utils.js  EIP-7702 nonce off-by-one (still `nonce: o ?? a`)
#   - stealth.js  unshield + reshield (still separate `if` branches)
#   - core.js  compliance signMessage signs raw bytes already
set -e

# ---------------------------------------------------------------------------
# 1a. prove.js — fetch circuits from a same-origin path (CORS workaround).
#
# v0.1.5 still fetches circuits from `${config.artifacts}/${name}.json`
# (https://api.tilapialabs.xyz/bermuda/v0/base-sepolia/artifacts/v0.1.5/...)
# but that endpoint does NOT send Access-Control-Allow-Origin headers, so a
# browser fetch from the demo origin is blocked. We rewrite the loader to
# pull from `/circuits/${chainId}/${name}.json`, served by Next from public/.
# ---------------------------------------------------------------------------
SDK_PROVE="node_modules/@bermuda/sdk/build/src/prove.js"
if [ -f "$SDK_PROVE" ]; then
  cat > "$SDK_PROVE" << 'PATCH'
import { Barretenberg, UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
async function getCircuitArtifacts(chainId, circuitName, bb) {
    const res = await fetch(`/circuits/${chainId}/${circuitName}.json`);
    const circuitJson = await res.json();
    const noir = new Noir(circuitJson);
    const backend = new UltraHonkBackend(circuitJson.bytecode, bb);
    return { noir, backend };
}
export default function init(config) {
    const browserNavigator = globalThis.navigator;
    const threads = config.proverThreads ||
        (browserNavigator?.hardwareConcurrency && browserNavigator.hardwareConcurrency > 1
            ? browserNavigator.hardwareConcurrency - 1
            : 0) ||
        1;
    const chainId = config.chainId.toString();
    let bbPromise;
    const getBb = () => (bbPromise ??= Barretenberg.new({ threads }));
    async function prove(circuitBaseName, inputs) {
        const bb = await getBb();
        const { noir, backend } = await getCircuitArtifacts(chainId, circuitBaseName, bb);
        const { witness } = await noir.execute(inputs);
        return backend.generateProof(witness, { keccakZK: true });
    }
    return {
        async prove2x4(inputs) {
            return prove('transact2x4', inputs);
        },
        async prove4x4(inputs) {
            return prove('transact4x4', inputs);
        },
        async prove2x16(inputs) {
            return prove('transact2x16', inputs);
        },
        async prove16x2(inputs) {
            return prove('transact16x2', inputs);
        },
        async withdraw2x4(inputs) {
            return prove('withdraw2x4', inputs);
        },
        async withdraw4x4(inputs) {
            return prove('withdraw4x4', inputs);
        },
        async withdraw2x16(inputs) {
            return prove('withdraw2x16', inputs);
        },
        async withdraw16x2(inputs) {
            return prove('withdraw16x2', inputs);
        },
        async withdrawDox2x4(inputs) {
            return prove('withdrawDox2x4', inputs);
        },
        async withdrawDox4x4(inputs) {
            return prove('withdrawDox4x4', inputs);
        },
        async withdrawDox2x16(inputs) {
            return prove('withdrawDox2x16', inputs);
        },
        async withdrawDox16x2(inputs) {
            return prove('withdrawDox16x2', inputs);
        }
    };
}
PATCH
  echo "✓ Patched prove.js to load circuits from /circuits/<chainId>/<name>.json"
fi

# ---------------------------------------------------------------------------
# 1b. relay.js — surface response body in error messages.
#
# Default v0.1.5 still only emits `statusText`, so 4xx/5xx errors from the
# relayer arrive as opaque "Bad Request". Replace it with a message that
# includes the response status code and body when available.
# ---------------------------------------------------------------------------
SDK_RELAY="node_modules/@bermuda/sdk/build/src/relay.js"
if [ -f "$SDK_RELAY" ]; then
  if grep -q 'Relay request failed with response status' "$SDK_RELAY"; then
    # Match minified `if(!X.ok)throw new Error(`Relay request failed with response status ${X.statusText}`)`
    # where X is a short response variable (name varies between minify runs).
    perl -i -pe 's{if\(!(\w+)\.ok\)throw new Error\(`Relay request failed with response status \$\{\1\.statusText\}`\)}{if(!$1.ok){let __d="";try{__d=await $1.text()}catch{}throw new Error(`Relay failed (\${$1.status}): \${__d||$1.statusText}`)}}g' "$SDK_RELAY"
    echo "✓ Patched relay.js for better error messages"
  fi
fi

# ---------------------------------------------------------------------------
# 1c. strategy.js — preserve recipient `note` (memo) on transfer outputs.
# (idempotent; no-ops if pattern shape changes upstream)
# ---------------------------------------------------------------------------
node scripts/patch-bermuda-strategy-memo.mjs

# ---------------------------------------------------------------------------
# 1d. find-utxos.js — incremental scan, parallel isSpent.
# (idempotent; rewrites the file in full when not yet patched)
# ---------------------------------------------------------------------------
node scripts/patch-bermuda-findutxos.mjs

# ---------------------------------------------------------------------------
# 2. Stub the deprecated @types/psl package (it ships with main:"" and no
# index.d.ts, which trips TS's auto-loaded type lookup). The real psl
# package provides its own types, so an empty stub is enough.
# ---------------------------------------------------------------------------
PSL_TYPES_DIR="node_modules/@types/psl"
if [ -d "$PSL_TYPES_DIR" ] && [ ! -f "$PSL_TYPES_DIR/index.d.ts" ]; then
  echo "// Stub: @types/psl is a deprecated empty package; psl provides its own types." > "$PSL_TYPES_DIR/index.d.ts"
  echo "✓ Stubbed @types/psl/index.d.ts"
fi

# ---------------------------------------------------------------------------
# 3. Provision circuit artifacts under public/circuits/84532/.
#
# Starting with v0.1.4, the SDK no longer bundles base-sepolia circuits
# (only chainId 31337 ships in build/src/circuits/). We download the v0.1.5
# artifacts from the same URL the SDK would otherwise fetch them from at
# runtime, so the prove.js patch above can serve them same-origin.
#
# Circuits change between SDK versions (the proving keys are baked in). A
# `.version` sentinel records which SDK version provisioned the current
# directory; if it doesn't match, we wipe and re-download.
# ---------------------------------------------------------------------------
SDK_VERSION="v0.1.5"
ARTIFACTS_URL="https://api.tilapialabs.xyz/bermuda/v0/base-sepolia/artifacts/${SDK_VERSION}"
CIRCUITS_DST="public/circuits/84532"
CIRCUITS_VERSION_FILE="$CIRCUITS_DST/.version"
CIRCUIT_NAMES=(
  transact2x4 transact4x4 transact2x16 transact16x2
  withdraw2x4 withdraw4x4 withdraw2x16 withdraw16x2
  withdrawDox2x4 withdrawDox4x4 withdrawDox2x16 withdrawDox16x2
)

if [ -d "$CIRCUITS_DST" ] && [ "$(cat "$CIRCUITS_VERSION_FILE" 2>/dev/null)" != "$SDK_VERSION" ]; then
  echo "Circuits in $CIRCUITS_DST are not from $SDK_VERSION — invalidating."
  rm -f "$CIRCUITS_DST"/*.json
fi

mkdir -p "$CIRCUITS_DST"
downloaded=0
skipped=0
for name in "${CIRCUIT_NAMES[@]}"; do
  dest="$CIRCUITS_DST/$name.json"
  if [ -s "$dest" ]; then
    skipped=$((skipped+1))
    continue
  fi
  if curl -fsSL "$ARTIFACTS_URL/$name.json" -o "$dest"; then
    downloaded=$((downloaded+1))
  else
    echo "✗ Failed to download $name.json from $ARTIFACTS_URL" >&2
    rm -f "$dest"
    exit 1
  fi
done
echo "$SDK_VERSION" > "$CIRCUITS_VERSION_FILE"
echo "✓ Circuits ready in $CIRCUITS_DST ($SDK_VERSION, downloaded=$downloaded, cached=$skipped)"
