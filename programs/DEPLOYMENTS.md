# Paytruth deployments

Record cluster, program id, config PDA, USDC mint, deploy transaction, slot, and wall-clock time in Africa/Lagos (WAT).

The program keypair is kept only on the shared box at `target/deploy/paytruth-keypair.json` and is **never committed**.

| Cluster | Program ID | Config PDA (`[b"config"]`) | USDC mint | Deploy tx | Slot | Time (WAT) |
|---|---|---|---|---|---|---|
| localnet (LiteSVM test harness; loads `target/deploy/paytruth.so`, no validator deploy) | `D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H` | `C9nFHNFgdTZ27PTz4pvrjxgmkWVyng4RNVFcpc4xLEPx` | fresh 6-decimal classic SPL mint created per test | n/a | n/a | 2026-11-27 |
| devnet | `D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H` (planned, same keypair) | `C9nFHNFgdTZ27PTz4pvrjxgmkWVyng4RNVFcpc4xLEPx` (planned) | TBD: Circle devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` or fallback test mint | TBD — not deployed (scheduled Sat 28 Nov 08:00 WAT) | TBD | TBD |

Mainnet: not deployed, out of scope.
