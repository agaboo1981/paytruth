mod common;

use common::*;

/// QA A28: every instruction on a Closed (tombstoned) invoice is rejected with its specific
/// "not open / not paid / not terminal" error. A freshly re-created empty escrow ATA is
/// supplied where an escrow account must deserialize.
#[test]
fn a28_closed_invoice_rejects_all_instructions() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let caller = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);
    let third_party = funded_keypair(&mut svm);

    // Pay exact, claim, then close -> a Closed tombstone with a recorded payer (status 3).
    // A recorded payer lets refund's `payer` account constraint pass so the handler's status
    // check (InvoiceNotPaid) is what rejects it.
    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 700, 1000, &mint);
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
    expect_ok(
        &mut svm,
        &merchant,
        &[&merchant],
        merchant_claim_ix(
            &merchant.pubkey(), &invoice, &mint, &escrow, &merchant_ata, &TOKEN_PROGRAM_ID,
        ),
    );
    expect_ok(
        &mut svm,
        &merchant,
        &[&merchant],
        close_invoice_ix(
            &merchant.pubkey(), &invoice, &mint, &escrow, &TOKEN_PROGRAM_ID,
        ),
    );
    assert_eq!(read_invoice(&svm, &invoice).status, 3, "Closed tombstone");
    assert!(!account_exists(&svm, &escrow), "escrow closed");

    // Re-create an empty canonical escrow ATA so escrow-deserializing instructions work.
    let recreated = create_ata(&mut svm, &third_party, &invoice, &mint, &TOKEN_PROGRAM_ID);
    assert_eq!(recreated, escrow);
    assert_eq!(token_balance(&svm, &escrow), 0);
    let status_before = read_invoice(&svm, &invoice).status;

    // pay -> DuplicatePayment 6001.
    let res = send(
        &mut svm,
        &payer,
        &[&payer],
        pay_invoice_ix(
            &payer.pubkey(), &config, &invoice, &mint, &payer_ata, &escrow,
            &TOKEN_PROGRAM_ID, 1000, 1000,
        ),
    );
    assert_custom_error(res, &program_id(), 6001);

    // expire -> InvoiceNotOpen 6002.
    let res = send(
        &mut svm, &caller, &[&caller], expire_invoice_ix(&caller.pubkey(), &invoice),
    );
    assert_custom_error(res, &program_id(), 6002);

    // claim -> InvoiceNotPaid 6004.
    let merchant_ata = ata_for(&merchant.pubkey(), &mint);
    let res = send(
        &mut svm,
        &merchant,
        &[&merchant],
        merchant_claim_ix(
            &merchant.pubkey(), &invoice, &mint, &escrow, &merchant_ata, &TOKEN_PROGRAM_ID,
        ),
    );
    assert_custom_error(res, &program_id(), 6004);

    // refund -> InvoiceNotPaid 6004.
    let res = send(
        &mut svm,
        &payer,
        &[&payer],
        refund_overpayment_ix(
            &payer.pubkey(), &invoice, &mint, &escrow, &payer.pubkey(), &payer_ata,
            &TOKEN_PROGRAM_ID,
        ),
    );
    assert_custom_error(res, &program_id(), 6004);

    // close -> InvoiceNotTerminal 6017.
    let res = send(
        &mut svm,
        &merchant,
        &[&merchant],
        close_invoice_ix(
            &merchant.pubkey(), &invoice, &mint, &escrow, &TOKEN_PROGRAM_ID,
        ),
    );
    assert_custom_error(res, &program_id(), 6017);

    // Status unchanged throughout.
    assert_eq!(read_invoice(&svm, &invoice).status, status_before);
    assert_eq!(read_invoice(&svm, &invoice).status, 3);
}
