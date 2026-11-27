# Program tests (Anchor Engineer)

The Paytruth program tests are LiteSVM Rust integration tests in `programs/paytruth/tests/` (one file per TEST-PLAN ID: H1-H11, A1-A28, M2, X8, X9, X11). They load the real `target/deploy/paytruth.so` plus the real SPL Token / Token-2022 / ATA programs and warp the clock for expiry tests.

```bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$HOME/.cargo/bin:$PATH"
anchor build
cargo test -p paytruth -- --test-threads=4
```

Why not ts-mocha + solana-test-validator: see `programs/paytruth/NOTES.md` (exact `unix_timestamp` warping).
