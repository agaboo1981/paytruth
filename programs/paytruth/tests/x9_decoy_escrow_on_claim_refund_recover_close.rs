mod common;

use common::*;

/// QA X9: the expected escrow is derived from `invoice.mint`. An attacker-supplied decoy
/// ATA(invoice PDA, OTHER mint) — passed with the CORRECT `mint` — must be rejected as
/// InvalidEscrow (6012) by claim/refund/recover/close, leaving the real vault and the
/// invoice untouched.
#[test]
fn x9_decoy_escrow_on_claim_refund_recover_close() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);
    let caller = funded_keypair(&mut svm);
    let attacker = funded_keypair(&mut svm);

    let (other_mint, _other_auth) =
        create_mint(&mut svm, &authority, MintKind::Classic, USDC_DECIMALS);
    assert_ne!(other_mint, mint);

    // ---- merchant_claim ----
    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 400, 1000, &mint);
    let payer_ata = create_ata(&mut svm, &payer, &payer.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    mint_to(
        &mut svm, &payer, &mint, &mint_auth, &payer_ata, 5_000, &TOKEN_PROGRAM_ID,
    );
    expect_ok(
        &mut svm,
        &payer,
        &[&payer],
        pay_invoice_ix(
            &payer.pubkey(), &config, &invoice, &mint, &payer_ata, &escrow,
            &TOKEN_PROGRAM_ID, 1000, 1000,
        ),
    );
    // Decoy: ATA(invoice PDA, other_mint).
    let decoy = create_ata(
        &mut svm, &attacker, &invoice, &other_mint, &TOKEN_PROGRAM_ID,
    );
    assert_ne!(decoy, escrow);
    assert_eq!(token_authority(&svm, &decoy), Some(invoice));
    let merchant_ata = ata_for(&merchant.pubkey(), &mint);
    let res = send(
        &mut svm,
        &merchant,
        &[&merchant],
        merchant_claim_ix(
            &merchant.pubkey(), &invoice, &mint, &decoy, &merchant_ata, &TOKEN_PROGRAM_ID,
        ),
    );
    assert_custom_error(res, &program_id(), 6012);
    assert!(!read_invoice(&svm, &invoice).claimed);
    assert_eq!(token_balance(&svm, &escrow), 1000, "real vault intact");
    assert_eq!(token_balance(&svm, &merchant_ata), 0);

    // ---- refund_overpayment ----
    let (invoice2, escrow2) = open_invoice(&mut svm, &merchant, &config, 401, 1000, &mint);
    let payer2 = funded_keypair(&mut svm);
    let payer2_ata = create_ata(&mut svm, &payer2, &payer2.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    mint_to(
        &mut svm, &payer2, &mint, &mint_auth, &payer2_ata, 5_000, &TOKEN_PROGRAM_ID,
    );
    expect_ok(
        &mut svm,
        &payer2,
        &[&payer2],
        pay_invoice_ix(
            &payer2.pubkey(), &config, &invoice2, &mint, &payer2_ata, &escrow2,
            &TOKEN_PROGRAM_ID, 1500, 1000,
        ),
    );
    let decoy2 = create_ata(
        &mut svm, &attacker, &invoice2, &other_mint, &TOKEN_PROGRAM_ID,
    );
    let res = send(
        &mut svm,
        &payer2,
        &[&payer2],
        refund_overpayment_ix(
            &payer2.pubkey(), &invoice2, &mint, &decoy2, &payer2.pubkey(), &payer2_ata,
            &TOKEN_PROGRAM_ID,
        ),
    );
    assert_custom_error(res, &program_id(), 6012);
    assert_eq!(read_invoice(&svm, &invoice2).refunded_excess, 0);
    assert_eq!(token_balance(&svm, &escrow2), 1500, "real vault intact");

    // ---- recover_unattributed ----
    let expiry = now(&svm) + 1_000;
    let (invoice3, escrow3, _b) = do_create_invoice(
        &mut svm, &merchant, &config, 402, 1000, expiry, [0u8; 64], &mint,
    );
    mint_to(
        &mut svm, &authority, &mint, &mint_auth, &escrow3, 700, &TOKEN_PROGRAM_ID,
    );
    warp_to(&mut svm, expiry);
    expect_ok(
        &mut svm, &caller, &[&caller], expire_invoice_ix(&caller.pubkey(), &invoice3),
    );
    let decoy3 = create_ata(
        &mut svm, &attacker, &invoice3, &other_mint, &TOKEN_PROGRAM_ID,
    );
    let merchant_ata3 = ata_for(&merchant.pubkey(), &mint);
    let res = send(
        &mut svm,
        &merchant,
        &[&merchant],
        recover_unattributed_ix(
            &merchant.pubkey(), &invoice3, &mint, &decoy3, &merchant_ata3, &TOKEN_PROGRAM_ID,
        ),
    );
    assert_custom_error(res, &program_id(), 6012);
    assert_eq!(token_balance(&svm, &escrow3), 700, "real vault intact");
    assert_eq!(token_balance(&svm, &merchant_ata3), 0);

    // ---- close_invoice (assert real vault survives and invoice not Closed) ----
    let expiry4 = now(&svm) + 1_000;
    let (invoice4, escrow4, _b) = do_create_invoice(
        &mut svm, &merchant, &config, 403, 1000, expiry4, [0u8; 64], &mint,
    );
    // Seed stray funds so the real vault is non-empty; close must still fail on InvalidEscrow
    // (before the VaultNotEmpty check) and leave the real vault balance intact.
    mint_to(
        &mut svm, &authority, &mint, &mint_auth, &escrow4, 300, &TOKEN_PROGRAM_ID,
    );
    warp_to(&mut svm, expiry4);
    expect_ok(
        &mut svm, &caller, &[&caller], expire_invoice_ix(&caller.pubkey(), &invoice4),
    );
    let decoy4 = create_ata(
        &mut svm, &attacker, &invoice4, &other_mint, &TOKEN_PROGRAM_ID,
    );
    let res = send(
        &mut svm,
        &merchant,
        &[&merchant],
        close_invoice_ix(&merchant.pubkey(), &invoice4, &mint, &decoy4, &TOKEN_PROGRAM_ID),
    );
    assert_custom_error(res, &program_id(), 6012);
    assert!(account_exists(&svm, &escrow4), "real vault still exists");
    assert_eq!(token_balance(&svm, &escrow4), 300, "real vault balance intact");
    let inv4 = read_invoice(&svm, &invoice4);
    assert_ne!(inv4.status, 3, "invoice not tombstoned");
    assert_eq!(inv4.status, 2, "still Expired");
}
