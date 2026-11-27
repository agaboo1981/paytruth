#!/usr/bin/env bash
# Deploy Paytruth to Solana devnet and immediately run initialize_config.
# Never prints keypair / secret material. Refuses mainnet.
set -euo pipefail

export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$HOME/.cargo/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

CLUSTER_URL="${CLUSTER_URL:-https://api.devnet.solana.com}"
DEPLOYER="${DEPLOYER:-$HOME/.config/solana/paytruth-devnet-deployer.json}"
PROGRAM_KEYPAIR="${PROGRAM_KEYPAIR:-$REPO_ROOT/target/deploy/paytruth-keypair.json}"
PROGRAM_SO="${PROGRAM_SO:-$REPO_ROOT/target/deploy/paytruth.so}"
PROGRAM_ID="${PROGRAM_ID:-D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H}"
CONFIG_PDA="${CONFIG_PDA:-C9nFHNFgdTZ27PTz4pvrjxgmkWVyng4RNVFcpc4xLEPx}"
USDC_MINT="${USDC_MINT:-4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU}"
SKIP_DEPLOY="${SKIP_DEPLOY:-0}"

refuse_mainnet() {
  local value="$1"
  local label="$2"
  if [[ "${value,,}" == *mainnet* ]]; then
    echo "Refusing ${label} because it points at mainnet: ${value}" >&2
    exit 1
  fi
}

refuse_mainnet "$CLUSTER_URL" "CLUSTER_URL"
if [[ "$CLUSTER_URL" != *devnet* && "$CLUSTER_URL" != "devnet" ]]; then
  echo "CLUSTER_URL must be a devnet URL (got: $CLUSTER_URL)" >&2
  exit 1
fi

echo "=== solana config (must already be devnet; deploy still passes --url explicitly) ==="
solana config get
cfg_url="$(solana config get | awk -F': ' '/^RPC URL/ {print $2}')"
refuse_mainnet "$cfg_url" "solana config RPC URL"

if [[ ! -f "$DEPLOYER" ]]; then
  echo "Deployer keypair not found at $DEPLOYER" >&2
  exit 1
fi
if [[ ! -f "$PROGRAM_KEYPAIR" ]]; then
  echo "Program keypair not found at $PROGRAM_KEYPAIR" >&2
  exit 1
fi
if [[ ! -f "$PROGRAM_SO" ]]; then
  echo "Program .so not found at $PROGRAM_SO (run anchor build first)" >&2
  exit 1
fi

deployer_pk="$(solana address -k "$DEPLOYER")"
program_pk="$(solana address -k "$PROGRAM_KEYPAIR")"
if [[ "$program_pk" != "$PROGRAM_ID" ]]; then
  echo "Program keypair pubkey $program_pk != expected $PROGRAM_ID" >&2
  exit 1
fi

echo "Cluster: $CLUSTER_URL"
echo "Deployer pubkey: $deployer_pk"
echo "Program ID: $program_pk"
echo "USDC mint: $USDC_MINT"
echo "Config PDA: $CONFIG_PDA"
echo "Binary: $PROGRAM_SO ($(wc -c < "$PROGRAM_SO") bytes)"
echo "Balance:"
solana balance "$deployer_pk" --url "$CLUSTER_URL"

if [[ "$SKIP_DEPLOY" != "1" ]]; then
  echo "=== solana program deploy (devnet only) ==="
  deploy_out="$(mktemp)"
  # --use-rpc: more reliable from cloud hosts than TPU. --output json for the signature.
  if ! solana program deploy \
      --url "$CLUSTER_URL" \
      --keypair "$DEPLOYER" \
      --program-id "$PROGRAM_KEYPAIR" \
      --upgrade-authority "$DEPLOYER" \
      --commitment confirmed \
      --use-rpc \
      --output json \
      "$PROGRAM_SO" | tee "$deploy_out"; then
    echo "Deploy failed. Full CLI output is above (no key material is included)." >&2
    exit 1
  fi
  echo "=== deploy json parsed ==="
  python3 - "$deploy_out" <<'PY'
import json,sys
path=sys.argv[1]
text=open(path).read()
# solana may print logs then JSON; take the last JSON object
obj=None
buf=[]
for line in text.splitlines():
    s=line.strip()
    if s.startswith('{') or buf:
        buf.append(s)
        try:
            obj=json.loads('\n'.join(buf))
        except Exception:
            pass
if obj is None:
    # maybe the whole file is JSON
    try:
        obj=json.loads(text)
    except Exception:
        print('WARN: could not parse deploy JSON; raw output was printed above')
        sys.exit(0)
prog=obj.get('programId') or obj.get('program_id') or obj.get('ProgramId')
sig=obj.get('signature') or obj.get('transaction') or obj.get('Signature')
# some versions use {programId, signatures?}
if not sig and isinstance(obj.get('signatures'), list) and obj['signatures']:
    sig=obj['signatures'][0]
print('programId:', prog or '(missing)')
print('deploy signature:', sig or '(missing)')
if sig:
    print('deploy explorer: https://explorer.solana.com/tx/%s?cluster=devnet' % sig)
if prog:
    print('program explorer: https://explorer.solana.com/address/%s?cluster=devnet' % prog)
open(path + '.sig','w').write(str(sig or ''))
PY
fi

echo "=== initialize_config (immediately after deploy) ==="
# Resolve @solana/web3.js without printing install paths that include secrets.
if [[ -z "${WEB3JS_PATH:-}" ]]; then
  for c in \
      "$REPO_ROOT/sdk/node_modules/@solana/web3.js" \
      "$REPO_ROOT/node_modules/@solana/web3.js"
  do
    if [[ -f "$c/package.json" ]]; then
      export WEB3JS_PATH="$c"
      break
    fi
  done
fi
if [[ -z "${WEB3JS_PATH:-}" ]]; then
  echo "WEB3JS_PATH is not set and @solana/web3.js was not found under the repo. Set WEB3JS_PATH." >&2
  exit 1
fi

node "$SCRIPT_DIR/initialize-config.mjs" \
  --url "$CLUSTER_URL" \
  --wallet "$DEPLOYER" \
  --mint "$USDC_MINT" \
  --program-id "$PROGRAM_ID" \
  --config-pda "$CONFIG_PDA"

echo "=== solana program show ==="
solana program show "$PROGRAM_ID" --url "$CLUSTER_URL"
echo "=== remaining balance ==="
solana balance "$deployer_pk" --url "$CLUSTER_URL"
echo "Deploy + initialize_config finished."
