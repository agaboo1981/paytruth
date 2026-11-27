# Test results — 2026-11-27 10:30 WAT

Command: `anchor build && cargo test -p paytruth -- --test-threads=4` (LiteSVM 0.15, anchor 1.2.2, solana-cli 4.1.2, rust 1.89).

Totals: 60 passed, 0 failed, 0 ignored (4 unit + 56 integration).

```
test a10_pay_wrong_mint ... ok
test a11_fake_escrow_non_ata_owned_by_invoice ... ok
test a11b_fake_escrow_ata_wrong_authority ... ok
test a12a_wrong_merchant_signer_claim ... ok
test a12a_wrong_merchant_signer_close ... ok
test a12a_wrong_merchant_signer_recover ... ok
test a12b_create_with_foreign_seeds ... ok
test a13a_reinit_while_invoice_exists ... ok
test a13b_close_then_recreate_same_id_rejected ... ok
test a13c_precreated_and_prefunded_escrow ... ok
test a13c_precreated_escrow_ata_does_not_block_create ... ok
test a14_initialize_config_with_token2022_mint ... ok
test a14_pay_with_token2022_program ... ok
test a15_underpayment ... ok
test a16a_create_zero_amount ... ok
test a16b_pay_zero_amount ... ok
test a17_create_expiry_in_past ... ok
test a17b_create_expiry_equal_now_is_rejected ... ok
test a18_recover_before_terminal ... ok
test a19_recover_while_excess_outstanding ... ok
test a1_double_pay ... ok
test a20_close_with_nonempty_vault ... ok
test a21_direct_transfer_then_recover ... ok
test a22_refund_when_no_excess ... ok
test a23_recover_empty_vault ... ok
test a24_close_open_invoice ... ok
test a25_claim_on_expired ... ok
test a26_invoice_id_reuse_after_close_rejected ... ok
test a27_recover_after_close_from_recreated_escrow ... ok
test a28_closed_invoice_rejects_all_instructions ... ok
test a2_claim_twice ... ok
test a3_claim_before_paid ... ok
test a4_claim_capped_at_amount_due ... ok
test a5_refund_wrong_destination ... ok
test a6_refund_twice ... ok
test a7_pay_after_expiry ... ok
test a7b_pay_at_expires_at_minus_one_succeeds ... ok
test a8_expire_before_time ... ok
test a9_expire_paid_invoice ... ok
test h10_close_invoice_empty_vault ... ok
test h11_paid_flow_pay_claim_close ... ok
test h1_initialize_config ... ok
test h2_create_invoice ... ok
test h3_pay_exact ... ok
test h4_pay_over ... ok
test h5_merchant_claim ... ok
test h6_refund_overpayment ... ok
test h7_refund_after_claim ... ok
test h7_refund_before_claim ... ok
test h8_expire_at_expires_at ... ok
test h9_recover_unattributed_expired_stray_funds ... ok
test m2_pay_expected_amount_due_mismatch ... ok
test m2_pay_wrong_mint ... ok
test state::tests::config_account_size_is_73 ... ok
test state::tests::invoice_account_size_is_219 ... ok
test state::tests::invoice_field_geometry ... ok
test state::tests::status_roundtrip ... ok
test x11_token2022_program_on_claim_refund_recover_close ... ok
test x8_wrong_mint_on_claim_refund_recover_close ... ok
test x9_decoy_escrow_on_claim_refund_recover_close ... ok
```
