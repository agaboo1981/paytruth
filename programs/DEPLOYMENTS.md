# Paytruth deployments

Record cluster, program id, config PDA, USDC mint, deploy transaction, slot, and wall-clock time in Africa/Lagos (WAT).

## Local scaffold (not deployed)

| Field | Value |
|---|---|
| Cluster | localnet (not yet deployed) |
| Program ID | `D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H` (from local `target/deploy/paytruth-keypair.json`, gitignored) |
| Config PDA | — (not initialized) |
| USDC mint | — (localnet tests create a fresh 6-decimal mint) |
| Deploy tx | — |
| Slot / time | — |

The program keypair is kept only on the shared box at `target/deploy/paytruth-keypair.json` and is **never committed**. Devnet values will be filled in after the first deploy.
