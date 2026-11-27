# Paytruth

On-chain USDC invoice settlement on Solana. The program is the source of truth: payments, claims, refunds, and expiry are enforced in an Anchor escrow, not by a backend.

Built for the Dev3pack Global Hackathon (27–29 November 2026). Early scaffold — not audited, not on mainnet.

## Status

Architecture is written. The `programs/paytruth` tree is an Anchor 1.2.2 workspace scaffold (placeholder initialize/increment instructions) and will be replaced with the invoice state machine in [`docs/PROGRAM-SPEC.md`](docs/PROGRAM-SPEC.md). Early UI work lives under `app/` and is not yet wired to a real program.

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Program spec](docs/PROGRAM-SPEC.md)
- [State machine](docs/STATE-MACHINE.md)
- [Test plan](docs/TEST-PLAN.md)
- [Interfaces](docs/INTERFACES.md)
- [Schedule](docs/SCHEDULE.md)
- [Deployments](programs/DEPLOYMENTS.md)

## Layout

| Path | Owner |
|---|---|
| `programs/paytruth/` | Solana / Anchor Engineer |
| `tests/program/` | Solana / Anchor Engineer |
| `sdk/` | Full-Stack Engineer |
| `app/` | UI/UX (presentational) + Full-Stack (hooks / wallet) |
| `tests/adversarial/`, `tests/e2e/` | QA / Security |
| `docs/` | Team Lead |

Branches: `feat/program`, `feat/client`, `feat/ui`, `qa/tests`. `main` is protected in policy; merge via pull request, Team Lead only.

## Toolchain (pinned)

- Anchor 1.2.2 + `anchor-spl` 1.2.2
- Rust 1.89.0 (`rust-toolchain.toml`)
- Devnet USDC (official Circle mint): `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (6 decimals, classic SPL Token). Localnet tests use a fresh test mint.

Program ID (local scaffold, not deployed): `D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H`

## License

MIT
