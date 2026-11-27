mod common;

use common::*;

#[test]
fn a10_pay_wrong_mint() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 10, 1000, &mint);
    let payer_ata = create_ata(&mut svm, &payer, &payer.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    mint_to(&mut svm, &payer, &mint, &mint_auth, &payer_ata, 5_000, &TOKEN_PROGRAM_ID);

    // A different, valid classic 6-dec mint. Passing it as `mint` must fail InvalidMint (6011).
    let (other_mint, _other_auth) = create_mint(&mut svm, &authority, MintKind::Classic, USDC_DECIMALS);
    assert_ne!(other_mint, mint);

    let res = send(
        &mut svm,
        &payer,
        &[&payer],
        pay_invoice_ix(
            &payer.pubkey(),
            &config,
            &invoice,
            &other_mint,
            &payer_ata,
            &escrow,
            &TOKEN_PROGRAM_ID,
            1000,
        ),
    );
    assert_custom_error(res, &program_id(), 6011);

    assert_eq!(read_invoice(&svm, &invoice).status, 0);
    assert_eq!(token_balance(&svm, &escrow), 0);
    assert_eq!(token_balance(&svm, &payer_ata), 5_000);
}
