mod common;

use common::*;

/// QA M2: paying with a different (valid classic 6-dec) mint and that mint's payer ATA must
/// fail InvalidMint (6011) and leave everything unchanged.
#[test]
fn m2_pay_wrong_mint() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 201, 1000, &mint);
    let payer_ata = create_ata(&mut svm, &payer, &payer.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    mint_to(
        &mut svm,
        &payer,
        &mint,
        &mint_auth,
        &payer_ata,
        5_000,
        &TOKEN_PROGRAM_ID,
    );

    // A different classic 6-dec mint and the payer's ATA of that mint, both funded.
    let (other_mint, other_auth) =
        create_mint(&mut svm, &authority, MintKind::Classic, USDC_DECIMALS);
    assert_ne!(other_mint, mint);
    let other_ata = create_ata(
        &mut svm,
        &payer,
        &payer.pubkey(),
        &other_mint,
        &TOKEN_PROGRAM_ID,
    );
    mint_to(
        &mut svm,
        &payer,
        &other_mint,
        &other_auth,
        &other_ata,
        5_000,
        &TOKEN_PROGRAM_ID,
    );

    let res = send(
        &mut svm,
        &payer,
        &[&payer],
        pay_invoice_ix(
            &payer.pubkey(),
            &config,
            &invoice,
            &other_mint,
            &other_ata,
            &escrow,
            &TOKEN_PROGRAM_ID,
            1000,
            1000,
        ),
    );
    assert_custom_error(res, &program_id(), 6011);

    let inv = read_invoice(&svm, &invoice);
    assert_eq!(inv.status, 0, "still Open");
    assert_eq!(inv.paid_amount, 0);
    assert_eq!(inv.payer, Pubkey::default());
    assert_eq!(token_balance(&svm, &payer_ata), 5_000);
    assert_eq!(token_balance(&svm, &other_ata), 5_000);
    assert_eq!(token_balance(&svm, &escrow), 0);
}
