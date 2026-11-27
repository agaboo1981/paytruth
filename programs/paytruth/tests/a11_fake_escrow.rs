mod common;

use common::*;

#[test]
fn a11_fake_escrow_non_ata_owned_by_invoice() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 11, 1000, &mint);
    let payer_ata = create_ata(&mut svm, &payer, &payer.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    mint_to(&mut svm, &payer, &mint, &mint_auth, &payer_ata, 5_000, &TOKEN_PROGRAM_ID);

    // A raw (non-ATA) token account, owned by the invoice PDA, same mint.
    let fake = create_raw_token_account(&mut svm, &payer, &mint, &invoice, &TOKEN_PROGRAM_ID);
    assert_ne!(fake, escrow);
    assert_eq!(token_authority(&svm, &fake), Some(invoice));

    let res = send(
        &mut svm,
        &payer,
        &[&payer],
        pay_invoice_ix(
            &payer.pubkey(),
            &config,
            &invoice,
            &mint,
            &payer_ata,
            &fake,
            &TOKEN_PROGRAM_ID,
            1000,
        ),
    );
    assert_custom_error(res, &program_id(), 6012);
    assert_eq!(read_invoice(&svm, &invoice).status, 0);
    assert_eq!(token_balance(&svm, &payer_ata), 5_000);
    assert_eq!(token_balance(&svm, &escrow), 0);
}

#[test]
fn a11b_fake_escrow_ata_wrong_authority() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);
    let stranger = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 11, 1000, &mint);
    let payer_ata = create_ata(&mut svm, &payer, &payer.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    mint_to(&mut svm, &payer, &mint, &mint_auth, &payer_ata, 5_000, &TOKEN_PROGRAM_ID);

    // An ATA for the same mint but with a different authority (stranger).
    let wrong_ata = create_ata(&mut svm, &stranger, &stranger.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    assert_eq!(token_authority(&svm, &wrong_ata), Some(stranger.pubkey()));
    assert_ne!(wrong_ata, escrow);

    let res = send(
        &mut svm,
        &payer,
        &[&payer],
        pay_invoice_ix(
            &payer.pubkey(),
            &config,
            &invoice,
            &mint,
            &payer_ata,
            &wrong_ata,
            &TOKEN_PROGRAM_ID,
            1000,
        ),
    );
    assert_custom_error(res, &program_id(), 6012);
    assert_eq!(read_invoice(&svm, &invoice).status, 0);
    assert_eq!(token_balance(&svm, &payer_ata), 5_000);
    assert_eq!(token_balance(&svm, &escrow), 0);
}
