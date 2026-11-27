# Paytruth deployments

Record cluster, program id, config PDA, USDC mint, deploy transaction, slot, and wall-clock time in Africa/Lagos (WAT).

The program keypair is kept only on the shared box at `target/deploy/paytruth-keypair.json` and is **never committed**. The devnet deployer keypair is kept outside the repo at `~/.config/solana/paytruth-devnet-deployer.json` (gitignored path, pubkey only below) and is **never committed**.

| Cluster | Program ID | Config PDA (`[b"config"]`) | USDC mint | Deploy tx | Slot | Time (WAT) |
|---|---|---|---|---|---|---|
| localnet (LiteSVM test harness; loads `target/deploy/paytruth.so`, no validator deploy) | `D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H` | `C9nFHNFgdTZ27PTz4pvrjxgmkWVyng4RNVFcpc4xLEPx` | fresh 6-decimal classic SPL mint created per test | n/a | n/a | 2026-11-27 |
| devnet | `D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H` | `C9nFHNFgdTZ27PTz4pvrjxgmkWVyng4RNVFcpc4xLEPx` | Circle devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | `eBEBE9R4Z3JmVGvUxCNRfnPzZweAoBkxCjra8C6CuyYJqJfchx8TKbKb5rYRgmR4Zgd1TTC5DrFsAf7u9CVVsJb` | 526845320 | 2026-11-27 11:58 WAT |

Mainnet: not deployed, out of scope.

## Devnet record (2026-11-27 11:58 WAT, Africa/Lagos)

Deployed from worktree `/workspace/paytruth-wip/wt-devnet` on branch `feat/program-devnet` at commit `f50f8bd4fb70b97ae088a19913ee6c2388a757aa` (`origin/main`). Program source and bytecode are unchanged from `237152f` (the program merge); `anchor build` produced `paytruth.so` at 269728 bytes. `cargo test -p paytruth -- --test-threads=4` at this commit: 60 passed, 0 failed, 0 ignored.

Deploy was performed with `programs/paytruth/scripts/deploy-devnet.sh`, which always calls `programs/paytruth/scripts/initialize-config.mjs` immediately afterwards. Both scripts refuse mainnet URLs.

| Field | Value |
|---|---|
| Commit | `f50f8bd4fb70b97ae088a19913ee6c2388a757aa` |
| Program ID | `D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H` |
| Config PDA (`[b"config"]`) | `C9nFHNFgdTZ27PTz4pvrjxgmkWVyng4RNVFcpc4xLEPx` |
| USDC mint | Circle devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Deployer / Config authority / upgrade authority (pubkey only) | `8w3kGAyCZy2uHVHbvtxQvTRzjVHQF8fPh1YshkE4H3xB` |
| Deploy transaction | `eBEBE9R4Z3JmVGvUxCNRfnPzZweAoBkxCjra8C6CuyYJqJfchx8TKbKb5rYRgmR4Zgd1TTC5DrFsAf7u9CVVsJb` (finalized) |
| `initialize_config` transaction | `DM7KkNQkhxdtBooNA8UPyu6T82MUoaee5f6wABNgE2GN1rMo4vKhg5XRftHCULRbBd5toY5hyNvLHMofSLCAWSJ` (finalized) |
| ProgramData address | `t7u7WGfXC3Toqx4z9nkdj5D45HCJXCFFx57stin1SA9` |
| Last deployed slot | 526845320 |
| Data length | 269728 (0x41da0) bytes |
| Loader | BPFLoaderUpgradeab1e11111111111111111111111 |
| Time | 2026-11-27 11:58 WAT (Africa/Lagos) |

### Explorer links (devnet)

- Program: https://explorer.solana.com/address/D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H?cluster=devnet
- Config PDA: https://explorer.solana.com/address/C9nFHNFgdTZ27PTz4pvrjxgmkWVyng4RNVFcpc4xLEPx?cluster=devnet
- Upgrade authority: https://explorer.solana.com/address/8w3kGAyCZy2uHVHbvtxQvTRzjVHQF8fPh1YshkE4H3xB?cluster=devnet
- ProgramData: https://explorer.solana.com/address/t7u7WGfXC3Toqx4z9nkdj5D45HCJXCFFx57stin1SA9?cluster=devnet
- Deploy tx: https://explorer.solana.com/tx/eBEBE9R4Z3JmVGvUxCNRfnPzZweAoBkxCjra8C6CuyYJqJfchx8TKbKb5rYRgmR4Zgd1TTC5DrFsAf7u9CVVsJb?cluster=devnet
- `initialize_config` tx: https://explorer.solana.com/tx/DM7KkNQkhxdtBooNA8UPyu6T82MUoaee5f6wABNgE2GN1rMo4vKhg5XRftHCULRbBd5toY5hyNvLHMofSLCAWSJ?cluster=devnet

### Config account verification

On-chain account owner is the program, size is 73 bytes, discriminator matches `account:Config`. Decoded fields:

- `authority` = `8w3kGAyCZy2uHVHbvtxQvTRzjVHQF8fPh1YshkE4H3xB` (the deployer signer)
- `usdc_mint` = `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- `bump` = 254

### Upgrade authority (QA L5)

Held by the gitignored devnet deployer keypair (pubkey `8w3kGAyCZy2uHVHbvtxQvTRzjVHQF8fPh1YshkE4H3xB`). Devnet only; the key material is not in git. Before any mainnet deploy: transfer upgrade authority to a Squads multisig, or mark the program final with `solana program set-upgrade-authority --final`. Neither action is taken now. See `programs/paytruth/SECURITY.md`.
