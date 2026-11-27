mod common;

use common::*;

/// QA X11: passing the Token-2022 program id where the classic Token program is required
/// fails Anchor's `Program<'info, Token>` check with InvalidProgramId 3008 for
/// claim/refund/recover/close, leaving state unchanged.
#[test]
fn x11_token2022_program_on_claim_refund_recover_close() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);
    let caller = funded_keypair(&mut svm);

    // ---- merchant_claim ----
    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 500, 1000, &mint);
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
    let merchant_ata = ata_for(&merchant.pubkey(), &mint);
    let res = send(
        &mut svm,
        &merchant,
        &[&merchant],
        merchant_claim_ix(
            &merchant.pubkey(), &invoice, &mint, &escrow, &merchant_ata,
            &TOKEN_2022_PROGRAM_ID,
        ),
    );
    assert_custom_error(res, &program_id(), 3008);
    assert!(!read_invoice(&svm, &invoice).claimed);
    assert_eq!(token_balance(&svm, &escrow), 1000);
    assert_eq!(token_balance(&svm, &merchant_ata), 0);

    // ---- refund_overpayment ----
    let (invoice2, escrow2) = open_invoice(&mut svm, &merchant, &config, 501, 1000, &mint);
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
    let res = send(
        &mut svm,
        &payer2,
        &[&payer2],
        refund_overpayment_ix(
            &payer2.pubkey(), &invoice2, &mint, &escrow2, &payer2.pubkey(), &payer2_ata,
            &TOKEN_2022_PROGRAM_ID,
        ),
    );
    assert_custom_error(res, &program_id(), 3008);
    assert_eq!(read_invoice(&svm, &invoice2).refunded_excess, 0);
    assert_eq!(token_balance(&svm, &escrow2), 1500);
    assert_eq!(token_balance(&svm, &payer2_ata), 3_500);

    // ---- recover_unattributed ----
    let expiry = now(&svm) + 1_000;
    let (invoice3, escrow3, _b) = do_create_invoice(
        &mut svm, &merchant, &config, 502, 1000, expiry, [0u8; 64], &mint,
    );
    mint_to(
        &mut svm, &authority, &mint, &mint_auth, &escrow3, 700, &TOKEN_PROGRAM_ID,
    );
    warp_to(&mut svm, expiry);
    expect_ok(
        &mut svm, &caller, &[&caller], expire_invoice_ix(&caller.pubkey(), &invoice3),
    );
    let merchant_ata3 = ata_for(&merchant.pubkey(), &mint);
    let res = send(
        &mut svm,
        &merchant,
        &[&merchant],
        recover_unattributed_ix(
            &merchant.pubkey(), &invoice3, &mint, &escrow3, &merchant_ata3,
            &TOKEN_2022_PROGRAM_ID,
        ),
    );
    assert_custom_error(res, &program_id(), 3008);
    assert_eq!(token_balance(&svm, &escrow3), 700);
    assert_eq!(token_balance(&svm, &merchant_ata3), 0);

    // ---- close_invoice ----
    let expiry4 = now(&svm) + 1_000;
    let (invoice4, escrow4, _b) = do_create_invoice(
        &mut svm, &merchant, &config, 503, 1000, expiry4, [0u8; 64], &mint,
    );
    warp_to(&mut svm, expiry4);
    expect_ok(
        &mut svm, &caller, &[&caller], expire_invoice_ix(&caller.pubkey(), &invoice4),
    );
    let res = send(
        &mut svm,
        &merchant,
        &[&merchant],
        close_invoice_ix(
            &merchant.pubkey(), &invoice4, &mint, &escrow4, &TOKEN_2022_PROGRAM_ID,
        ),
    );
    assert_custom_error(res, &program_id(), 3008);
    assert_eq!(read_invoice(&svm, &invoice4).status, 2, "not closed");
    assert!(account_exists(&svm, &escrow4), "vault still exists");
}
