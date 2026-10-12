#!/usr/bin/env bash
# Point the whole repo at a program keypair you own, then rebuild and
# regenerate the SDK parity fixtures.
#
#   scripts/set-program-id.sh [target/deploy/liq-keypair.json]
set -euo pipefail
cd "$(dirname "$0")/.."
KEYPAIR="${1:-target/deploy/liq-keypair.json}"
if [ ! -f "$KEYPAIR" ]; then
  mkdir -p "$(dirname "$KEYPAIR")"
  solana-keygen new --no-bip39-passphrase -s -o "$KEYPAIR"
fi
NEW_ID="$(solana-keygen pubkey "$KEYPAIR")"
OLD_ID="$(grep -oP 'declare_id!\("\K[^"]+' programs/liq/src/lib.rs)"
[ "$OLD_ID" = "$NEW_ID" ] && { echo "Already using $NEW_ID"; exit 0; }
sed -i "s/$OLD_ID/$NEW_ID/g" programs/liq/src/lib.rs sdk/src/constants.ts
[ "$KEYPAIR" = "target/deploy/liq-keypair.json" ] || cp "$KEYPAIR" target/deploy/liq-keypair.json
(cd programs/liq && cargo build-sbf)
cargo run -q -p liq --example export_fixtures
echo "Program id: $OLD_ID -> $NEW_ID"
