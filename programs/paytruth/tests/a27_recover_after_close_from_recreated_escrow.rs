mod common;

use common::*;

/// QA A27: after close leaves an Invoice tombstone (status 3), a third party can still
/// re-create the escrow ATA (init_if_needed in recover accepts it) and send stray tokens.
/// `recover_unattributed` accepts Closed status and drains them to the merchant; status
/// stays 3.
#[test]
fn a27_recover_after_close_from_recreated_escrow() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let caller = funded_keypair(&mut svm);
    let third_party = funded_keypair(&mut svm);

    // Open, expire, close -> tombstone. Use a Paid+claimed flow so recover on Closed is the
    // only path; here expiry+close is simplest and reaches Closed with an empty vault.
    let expiry = now(&svm) + 1_000;
    let (invoice, escrow, _b) = do_create_invoice(
        &mut svm, &merchant, &config, 600, 1000, expiry, [0u8; 64], &mint,
    );
    warp_to(&mut svm, expiry);
    expect_ok(
        &mut svm, &caller, &[&caller], expire_invoice_ix(&caller.pubkey(), &invoice),
    );
    expect_ok(
        &mut svm,
        &merchant,
        &[&merchant],
        close_invoice_ix(
            &merchant.pubkey(), &invoice, &mint, &escrow, &TOKEN_PROGRAM_ID,
        ),
    );
    assert!(!account_exists(&svm, &escrow), "escrow closed");
    assert_eq!(read_invoice(&svm, &invoice).status, 3, "Closed tombstone");

    // Third party re-creates the SAME escrow ATA and sends 5 stray tokens into it.
    let recreated = create_ata(
        &mut svm, &third_party, &invoice, &mint, &TOKEN_PROGRAM_ID,
    );
    assert_eq!(recreated, escrow, "same canonical escrow ATA");
    let third_ata = create_ata(
        &mut svm, &third_party, &third_party.pubkey(), &mint, &TOKEN_PROGRAM_ID,
    );
    mint_to(
        &mut svm, &third_party, &mint, &mint_auth, &third_ata, 100, &TOKEN_PROGRAM_ID,
    );
    raw_transfer(
        &mut svm, &third_party, &third_party, &third_ata, &escrow, 5, &TOKEN_PROGRAM_ID,
    );
    assert_eq!(token_balance(&svm, &escrow), 5);

    // Merchant recovers the 5 from the Closed invoice.
    let merchant_ata = ata_for(&merchant.pubkey(), &mint);
    expect_ok(
        &mut svm,
        &merchant,
        &[&merchant],
        recover_unattributed_ix(
            &merchant.pubkey(), &invoice, &mint, &escrow, &merchant_ata, &TOKEN_PROGRAM_ID,
        ),
    );
    assert_eq!(token_balance(&svm, &escrow), 0, "drained");
    assert_eq!(token_balance(&svm, &merchant_ata), 5);
    assert_eq!(
        read_invoice(&svm, &invoice).status,
        3,
        "status stays Closed"
    );
}
