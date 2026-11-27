mod common;

use common::*;

#[test]
fn h2_create_invoice() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, _mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);

    let invoice_id = 7;
    let amount_due = 2_500_000u64;
    let expiry = now(&svm) + 3_600;
    let mut memo = [0u8; 64];
    let text = b"INV-7 coffee beans";
    memo[..text.len()].copy_from_slice(text);

    let (invoice, escrow, expected_bump) = do_create_invoice(
        &mut svm, &merchant, &config, invoice_id, amount_due, expiry, memo, &mint,
    );

    // SPEC-NOTE: spec text says 211; the documented six 8-byte numerals give 219.
    assert_eq!(invoice_account_len(&svm, &invoice), INVOICE_ACCOUNT_LEN);
    assert_eq!(INVOICE_ACCOUNT_LEN, 219);
    let inv = read_invoice(&svm, &invoice);
    assert_eq!(inv.merchant, merchant.pubkey());
    assert_eq!(inv.payer, Pubkey::default());
    assert_eq!(inv.mint, mint);
    assert_eq!(inv.invoice_id, invoice_id);
    assert_eq!(inv.amount_due, amount_due);
    assert_eq!(inv.paid_amount, 0);
    assert_eq!(inv.refunded_excess, 0);
    assert_eq!(inv.created_at, now(&svm));
    assert_eq!(inv.expires_at, expiry);
    assert_eq!(inv.status, 0);
    assert!(!inv.claimed);
    assert_eq!(inv.bump, expected_bump);
    assert_eq!(&inv.memo[..text.len()], text);
    assert!(
        inv.memo[text.len()..].iter().all(|b| *b == 0),
        "memo must be zero-padded"
    );

    // Escrow ATA exists, owned by invoice, holds the right mint.
    assert!(account_exists(&svm, &escrow));
    assert_eq!(escrow, escrow_ata(&invoice, &mint));
    assert_eq!(token_authority(&svm, &escrow), Some(invoice));
    assert_eq!(read_token_account(&svm, &escrow).unwrap().mint, mint);
    assert_eq!(token_balance(&svm, &escrow), 0);
}
