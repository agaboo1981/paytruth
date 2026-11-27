# Paytruth Schedule

All times WAT (UTC+1). Working backwards from submit **Sat 28 Nov 22:00 WAT**. Now: Fri 27 Nov ~09:40 WAT.

Official FAQ hard deadline: Sunday 29 Nov 2026 (exact UTC hours unconfirmed). Conservative unofficial cutoff risk ~08:00 WAT Sun 29 Nov (Chile partner Luma page, not official). Do not plan to use the buffer.

## Timeline

| Window (WAT) | Milestone | Owner | Definition of done |
|---|---|---|---|
| Fri 27 ~10:00 | Architecture docs frozen | Team Lead | This docs set written under `paytruth/docs/`; repo still to be created |
| Fri 27 10:00 → 11:00 | Repo scaffold + branches | Team Lead | `feat/program`, `feat/client`, `feat/ui`, `qa/tests`; protection on `main` |
| Fri 27 11:00 → 22:00 | Program + localnet tests done — **hard internal deadline** | Anchor Eng | All 8 instructions; `anchor test` green incl. attack suite A1–A25 |
| Fri 27 22:00 → Sat 08:00 | Overnight buffer / leftover program fixes | Anchor Eng | CI green; IDL + types committed |
| Sat 28 08:00 → 10:00 | Devnet deploy + Circle faucet (or fallback mint) + smoke | Anchor Eng | Program id, config PDA, mint, deploy tx recorded in `programs/DEPLOYMENTS.md` |
| Sat 28 10:00 → 13:00 | Client SDK | Full-Stack | INTERFACES §SDK implemented; can start earlier against localnet IDL |
| Sat 28 10:00 → 15:00 | UI complete incl. verify page | UI/UX | Create/pay/claim/refund/expire/verify flows; verify reads chain directly |
| Sat 28 15:00 | **Integration freeze** | Team Lead | No new features after this point |
| Sat 28 15:00 → 18:00 | QA pass + adversarial on devnet | QA/Sec | §F checklist green; all 7 official E2E demo steps pass on devnet |
| Sat 28 18:00 → 20:00 | Demo video <3 min, 7 live steps, no faked txs | Team Lead + Full-Stack | E2E steps 1–7 on devnet with real signatures |
| Sat 28 20:00 → 22:00 | Submission package + form | Team Lead | Repo README, deploy record, video, form submitted |
| Sun 29 → 08:00 | Buffer only (do not plan to use) | — | — |

## Parallel tracks

- SDK can start Sat 10:00 but may begin earlier against the localnet IDL once `target/idl/paytruth.json` is committed (Fri).
- UI can begin chrome against mocked reads; wire to SDK at integration.
- Video records the already-passing 7-step devnet flow; do not leave steps 5–7 for the first time in the video window.

## Critical path and risks

| Risk | Mitigation |
|---|---|
| Faucet rate limit / downtime (Sat) | Fallback 6-decimal legacy-SPL devnet test mint → set as `Config.usdc_mint`; documented in `DEPLOYMENTS.md` |
| Public RPC flakiness | Submit `confirmed`, poll account, `finalized` for irreversible actions; refetch before resubmit |
| Program slip past Fri 22:00 | Overnight buffer Fri 22:00–Sat 08:00; freeze scope, no new features |
| Integration overruns freeze | Feature freeze Sat 15:00; QA + demo only after |
| Deadline uncertainty | Submit Sat 22:00, well before both the unofficial ~08:00 Sun risk and the official Sun deadline |
