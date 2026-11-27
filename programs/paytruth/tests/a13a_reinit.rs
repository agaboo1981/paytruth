mod common;

use common::*;
use solana_instruction_error::InstructionError;

#[test]
fn a13a_reinit_while_invoice_exists() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (config, mint, _mint_auth) = setup_config(&mut svm, &authority);
    let merchant = funded_keypair(&mut svm);

    let (invoice, escrow) = open_invoice(&mut svm, &merchant, &config, 13, 1000, &mint);
    let before = read_invoice(&svm, &invoice);
    assert_eq!(before.status, 0);

    // Re-init the same PDA: `init` on an existing account must fail (account in use).
    // Anchor forwards the system program's CreateAccount failure, i.e. Custom(0)
    // (SystemError::AccountAlreadyInUse).
    let expiry = now(&svm) + 5_000;
    let ix = create_invoice_ix(
        &merchant.pubkey(),
        &config,
        &invoice,
        &mint,
        &escrow,
        &TOKEN_PROGRAM_ID,
        &CreateInvoiceArgs {
            invoice_id: 13,
            amount_due: 9_999,
            expires_at: expiry,
            memo: [7u8; 64],
        },
    );
    let res = send(&mut svm, &merchant, &[&merchant], ix);
    assert_instruction_error(res, InstructionError::Custom(0));

    // State pristine.
    let after = read_invoice(&svm, &invoice);
    assert_eq!(after.amount_due, 1000);
    assert_eq!(after.expires_at, before.expires_at);
    assert_eq!(after.memo, before.memo);
    assert_eq!(token_balance(&svm, &escrow), 0);
}
