mod common;

use common::*;

#[test]
fn a5_refund_wrong_destination() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);
    let attacker = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 5, 1000, &mint);
    let payer_ata = create_ata(&mut svm, &payer, &payer.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    mint_to(&mut svm, &payer, &mint, &mint_auth, &payer_ata, 5_000, &TOKEN_PROGRAM_ID);
    expect_ok(
        &mut svm,
        &payer,
        &[&payer],
        pay_invoice_ix(
            &payer.pubkey(),
            &config,
            &invoice,
            &mint,
            &payer_ata,
            &escrow,
            &TOKEN_PROGRAM_ID,
            1500,
        ),
    );

    // Attacker pretends to be the recorded payer: the `payer` account's address constraint
    // does not match invoice.payer, so InvalidPayerAta (6014) fires before any transfer.
    let attacker_ata = create_ata(&mut svm, &attacker, &attacker.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    let res = send(
        &mut svm,
        &attacker,
        &[&attacker],
        refund_overpayment_ix(
            &attacker.pubkey(),
            &invoice,
            &mint,
            &escrow,
            &attacker.pubkey(),
            &attacker_ata,
            &TOKEN_PROGRAM_ID,
        ),
    );
    assert_custom_error(res, &program_id(), 6014);

    // State fully unchanged.
    let inv = read_invoice(&svm, &invoice);
    assert_eq!(inv.refunded_excess, 0);
    assert_eq!(token_balance(&svm, &escrow), 1500);
    assert_eq!(token_balance(&svm, &attacker_ata), 0);
    assert_eq!(token_balance(&svm, &payer_ata), 3_500);
}
