mod common;

use common::*;

/// QA A13c: an attacker pre-creating the canonical escrow ATA (ATA(invoice PDA, mint))
/// before `create_invoice` must not block creation, because `create_invoice` uses
/// `init_if_needed` on the escrow. The invoice then works end-to-end.
#[test]
fn a13c_precreated_escrow_ata_does_not_block_create() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);
    let attacker = funded_keypair(&mut svm);

    let invoice_id = 130;
    let (invoice, _bump) = invoice_pda(&merchant.pubkey(), invoice_id);
    let escrow = escrow_ata(&invoice, &mint);

    // Attacker front-runs: pre-creates the canonical escrow ATA (empty).
    let created = create_ata(
        &mut svm,
        &attacker,
        &invoice,
        &mint,
        &TOKEN_PROGRAM_ID,
    );
    assert_eq!(created, escrow, "canonical escrow ATA");
    assert!(account_exists(&svm, &escrow));
    assert_eq!(token_authority(&svm, &escrow), Some(invoice));
    assert_eq!(token_balance(&svm, &escrow), 0);

    // create_invoice still succeeds (init_if_needed accepts the pre-created ATA).
    let expiry = now(&svm) + 10_000;
    expect_ok(
        &mut svm,
        &merchant,
        &[&merchant],
        create_invoice_ix(
            &merchant.pubkey(),
            &config,
            &invoice,
            &mint,
            &escrow,
            &TOKEN_PROGRAM_ID,
            &CreateInvoiceArgs {
                invoice_id,
                amount_due: 1000,
                expires_at: expiry,
                memo: [0u8; 64],
            },
        ),
    );
    let inv = read_invoice(&svm, &invoice);
    assert_eq!(inv.status, 0, "Open");
    assert_eq!(inv.amount_due, 1000);

    // End-to-end: pay exact then claim.
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
    let merchant_ata = ata_for(&merchant.pubkey(), &mint);
    expect_ok(
        &mut svm,
        &merchant,
        &[&merchant],
        merchant_claim_ix(
            &merchant.pubkey(),
            &invoice,
            &mint,
            &escrow,
            &merchant_ata,
            &TOKEN_PROGRAM_ID,
        ),
    );
    assert_eq!(token_balance(&svm, &merchant_ata), 1000);
    assert_eq!(token_balance(&svm, &escrow), 0);
    assert_eq!(token_balance(&svm, &payer_ata), 4_000);
    assert!(read_invoice(&svm, &invoice).claimed);
}

/// QA A13c: attacker pre-creates AND pre-funds the escrow ATA with 7 stray units. Creation
/// still succeeds; the invoice works; claim pays exactly amount_due; the stray 7 stay in the
/// vault and are recoverable by the merchant after claim; close then works.
#[test]
fn a13c_precreated_and_prefunded_escrow() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);
    let attacker = funded_keypair(&mut svm);

    let invoice_id = 131;
    let (invoice, _bump) = invoice_pda(&merchant.pubkey(), invoice_id);
    let escrow = escrow_ata(&invoice, &mint);

    // Attacker pre-creates the canonical escrow ATA and seeds it with 7 stray units.
    let created = create_ata(&mut svm, &attacker, &invoice, &mint, &TOKEN_PROGRAM_ID);
    assert_eq!(created, escrow);
    let attacker_ata = create_ata(
        &mut svm,
        &attacker,
        &attacker.pubkey(),
        &mint,
        &TOKEN_PROGRAM_ID,
    );
    mint_to(
        &mut svm,
        &attacker,
        &mint,
        &mint_auth,
        &attacker_ata,
        100,
        &TOKEN_PROGRAM_ID,
    );
    raw_transfer(
        &mut svm,
        &attacker,
        &attacker,
        &attacker_ata,
        &escrow,
        7,
        &TOKEN_PROGRAM_ID,
    );
    assert_eq!(token_balance(&svm, &escrow), 7);

    // create_invoice succeeds despite the pre-funded escrow.
    let expiry = now(&svm) + 10_000;
    expect_ok(
        &mut svm,
        &merchant,
        &[&merchant],
        create_invoice_ix(
            &merchant.pubkey(),
            &config,
            &invoice,
            &mint,
            &escrow,
            &TOKEN_PROGRAM_ID,
            &CreateInvoiceArgs {
                invoice_id,
                amount_due: 1000,
                expires_at: expiry,
                memo: [0u8; 64],
            },
        ),
    );
    assert_eq!(token_balance(&svm, &escrow), 7, "stray funds preserved");

    // Pay exact.
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
    assert_eq!(token_balance(&svm, &escrow), 1_007);

    // Claim gives merchant exactly amount_due; the 7 strays stay behind in the vault.
    let merchant_ata = ata_for(&merchant.pubkey(), &mint);
    expect_ok(
        &mut svm,
        &merchant,
        &[&merchant],
        merchant_claim_ix(
            &merchant.pubkey(),
            &invoice,
            &mint,
            &escrow,
            &merchant_ata,
            &TOKEN_PROGRAM_ID,
        ),
    );
    assert_eq!(
        token_balance(&svm, &merchant_ata),
        1000,
        "merchant gets exactly amount_due"
    );
    assert_eq!(
        token_balance(&svm, &escrow),
        7,
        "stray units remain in vault"
    );
    assert!(read_invoice(&svm, &invoice).claimed);

    // Merchant recovers the strays via recover_unattributed.
    expect_ok(
        &mut svm,
        &merchant,
        &[&merchant],
        recover_unattributed_ix(
            &merchant.pubkey(),
            &invoice,
            &mint,
            &escrow,
            &merchant_ata,
            &TOKEN_PROGRAM_ID,
        ),
    );
    assert_eq!(token_balance(&svm, &escrow), 0, "vault drained");
    assert_eq!(token_balance(&svm, &merchant_ata), 1007);

    // Close then works: vault is empty, invoice is Paid + claimed.
    expect_ok(
        &mut svm,
        &merchant,
        &[&merchant],
        close_invoice_ix(
            &merchant.pubkey(),
            &invoice,
            &mint,
            &escrow,
            &TOKEN_PROGRAM_ID,
        ),
    );
    assert!(!account_exists(&svm, &escrow), "vault closed");
    assert!(account_exists(&svm, &invoice), "tombstone kept");
    assert_eq!(read_invoice(&svm, &invoice).status, 3);
}
