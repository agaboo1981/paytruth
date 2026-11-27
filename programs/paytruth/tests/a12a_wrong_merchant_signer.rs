mod common;

use common::*;

#[test]
fn a12a_wrong_merchant_signer_claim() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);
    let attacker = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 12, 1000, &mint);
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
            1000,
            1000,
        ),
    );

    let attacker_ata = create_ata(
        &mut svm,
        &attacker,
        &attacker.pubkey(),
        &mint,
        &TOKEN_PROGRAM_ID,
    );
    let res = send(
        &mut svm,
        &attacker,
        &[&attacker],
        merchant_claim_ix(
            &attacker.pubkey(),
            &invoice,
            &mint,
            &escrow,
            &attacker_ata,
            &TOKEN_PROGRAM_ID,
        ),
    );
    assert_custom_error(res, &program_id(), 6013);
    assert!(!read_invoice(&svm, &invoice).claimed);
    assert_eq!(token_balance(&svm, &escrow), 1000);
}

#[test]
fn a12a_wrong_merchant_signer_close() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, _mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let caller = funded_keypair(&mut svm);
    let attacker = funded_keypair(&mut svm);

    let expiry = now(&svm) + 1_000;
    let (invoice, escrow, _bump) = do_create_invoice(
        &mut svm, &merchant, &config, 12, 1000, expiry, [0u8; 64], &mint,
    );
    warp_to(&mut svm, expiry);
    expect_ok(
        &mut svm,
        &caller,
        &[&caller],
        expire_invoice_ix(&caller.pubkey(), &invoice),
    );

    let res = send(
        &mut svm,
        &attacker,
        &[&attacker],
        close_invoice_ix(
            &attacker.pubkey(),
            &invoice,
            &mint,
            &escrow,
            &TOKEN_PROGRAM_ID,
        ),
    );
    assert_custom_error(res, &program_id(), 6013);
    assert!(account_exists(&svm, &invoice));
    assert!(account_exists(&svm, &escrow));
}

#[test]
fn a12a_wrong_merchant_signer_recover() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let caller = funded_keypair(&mut svm);
    let attacker = funded_keypair(&mut svm);

    let expiry = now(&svm) + 1_000;
    let (invoice, escrow, _bump) = do_create_invoice(
        &mut svm, &merchant, &config, 12, 1000, expiry, [0u8; 64], &mint,
    );
    mint_to(
        &mut svm,
        &authority,
        &mint,
        &mint_auth,
        &escrow,
        500,
        &TOKEN_PROGRAM_ID,
    );
    warp_to(&mut svm, expiry);
    expect_ok(
        &mut svm,
        &caller,
        &[&caller],
        expire_invoice_ix(&caller.pubkey(), &invoice),
    );

    let attacker_ata = create_ata(
        &mut svm,
        &attacker,
        &attacker.pubkey(),
        &mint,
        &TOKEN_PROGRAM_ID,
    );
    let res = send(
        &mut svm,
        &attacker,
        &[&attacker],
        recover_unattributed_ix(
            &attacker.pubkey(),
            &invoice,
            &mint,
            &escrow,
            &attacker_ata,
            &TOKEN_PROGRAM_ID,
        ),
    );
    assert_custom_error(res, &program_id(), 6013);
    assert_eq!(token_balance(&svm, &escrow), 500);
    assert_eq!(token_balance(&svm, &attacker_ata), 0);
}
