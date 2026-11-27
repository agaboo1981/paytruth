mod common;

use common::*;

#[test]
fn a14_initialize_config_with_token2022_mint() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);

    // A valid 6-decimal Token-2022 mint: initialize_config must reject it as InvalidMint.
    let (mint_2022, _auth) = create_mint(&mut svm, &authority, MintKind::Token2022, USDC_DECIMALS);
    let acc = svm.get_account(&mint_2022).unwrap();
    assert_eq!(acc.owner, TOKEN_2022_PROGRAM_ID, "mint is owned by Token-2022");

    let (config, _) = config_pda();
    let res = send(
        &mut svm,
        &authority,
        &[&authority],
        initialize_config_ix(&authority.pubkey(), &mint_2022),
    );
    assert_custom_error(res, &program_id(), 6011);
    assert!(!account_exists(&svm, &config), "config not created");
}

#[test]
fn a14_pay_with_token2022_program() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 14, 1000, &mint);
    let payer_ata = create_ata(&mut svm, &payer, &payer.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    mint_to(&mut svm, &payer, &mint, &mint_auth, &payer_ata, 5_000, &TOKEN_PROGRAM_ID);

    // Passing the Token-2022 program id where the classic Token program is required makes
    // Anchor's `Program<'info, Token>` check fail with InvalidProgramId (3008).
    let ix = pay_invoice_ix(
        &payer.pubkey(),
        &config,
        &invoice,
        &mint,
        &payer_ata,
        &escrow,
        &TOKEN_2022_PROGRAM_ID,
        1000,
    );
    let res = send(&mut svm, &payer, &[&payer], ix);
    assert_custom_error(res, &program_id(), 3008);

    // No state change.
    assert_eq!(read_invoice(&svm, &invoice).status, 0);
    assert_eq!(token_balance(&svm, &payer_ata), 5_000);
    assert_eq!(token_balance(&svm, &escrow), 0);
}
