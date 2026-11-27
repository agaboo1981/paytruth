mod common;

use common::*;

#[test]
fn a12b_create_with_foreign_seeds() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, _mint_auth) = setup_config(&mut svm, &authority);

    let real_merchant = funded_keypair(&mut svm);
    let attacker = funded_keypair(&mut svm);

    // The signer/merchant that pays is `attacker`, but we target the PDA derived for
    // `real_merchant`, so the program's seed check (which uses the signer) must fail.
    let invoice_id = 12;
    let foreign_invoice = foreign_invoice_pda(&real_merchant.pubkey(), invoice_id);
    let escrow = escrow_ata(&foreign_invoice, &mint);
    let expiry = now(&svm) + 1_000;

    let ix = create_invoice_ix(
        &attacker.pubkey(),
        &config,
        &foreign_invoice,
        &mint,
        &escrow,
        &TOKEN_PROGRAM_ID,
        &CreateInvoiceArgs {
            invoice_id,
            amount_due: 1000,
            expires_at: expiry,
            memo: [0u8; 64],
        },
    );
    let res = send(&mut svm, &attacker, &[&attacker], ix);
    // Anchor ConstraintSeeds.
    assert_custom_error(res, &program_id(), 2006);

    // No invoice/escrow created.
    assert!(!account_exists(&svm, &foreign_invoice));
    assert!(!account_exists(&svm, &escrow));
}
