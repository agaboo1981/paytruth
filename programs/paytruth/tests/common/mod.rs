#![allow(dead_code)]

use anchor_lang::{AccountDeserialize, Discriminator};
pub use litesvm::LiteSVM;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
pub use solana_keypair::Keypair;
use solana_message::Message;
use solana_program_pack::Pack;
use solana_pubkey::pubkey;
pub use solana_pubkey::Pubkey;
pub use solana_signer::Signer;
use solana_transaction::Transaction;
use spl_associated_token_account_interface::address::get_associated_token_address_with_program_id;
use spl_token_interface::state::{Account as TokenAccountState, Mint as MintState};

use paytruth::state::{Config, Invoice};

pub const USDC_DECIMALS: u8 = 6;
pub const TOKEN_PROGRAM_ID: Pubkey = spl_token_interface::ID;
pub const TOKEN_2022_PROGRAM_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey =
    spl_associated_token_account_interface::program::id();

pub const SYSTEM_PROGRAM_ID: Pubkey = pubkey!("11111111111111111111111111111111");

pub const CONFIG_SEED: &[u8] = b"config";
pub const INVOICE_SEED: &[u8] = b"invoice";

pub const DISCRIMINATOR_LEN: usize = 8;
pub const CONFIG_ACCOUNT_LEN: usize = 73;
// SPEC-NOTE: docs state Invoice account = 211, but the documented six 8-byte numeric
// fields make the true account length 219 (8 + 96 + 48 + 3 + 64). See programs/paytruth/src/state.rs.
pub const INVOICE_ACCOUNT_LEN: usize = 219;

/// The program id under test, read from the crate's `declare_id!`.
pub fn program_id() -> Pubkey {
    paytruth::id()
}

/// Fresh LiteSVM with the compiled program plus the SPL Token, Token-2022 and ATA programs
/// (LiteSVM::new already loads the default SPL programs).
pub fn setup_svm() -> LiteSVM {
    let mut svm = LiteSVM::new();
    let so = include_bytes!("../../../../target/deploy/paytruth.so");
    svm.add_program(program_id(), so)
        .expect("program .so loads");
    svm
}

pub fn dedupe(svm: &mut LiteSVM) {
    svm.expire_blockhash();
}

/// Creates a fresh keypair funded with 100 SOL.
pub fn funded_keypair(svm: &mut LiteSVM) -> Keypair {
    let kp = Keypair::new();
    svm.airdrop(&kp.pubkey(), 100_000_000_000).unwrap();
    kp
}

pub fn token_program_for(kind: MintKind) -> Pubkey {
    match kind {
        MintKind::Classic => TOKEN_PROGRAM_ID,
        MintKind::Token2022 => TOKEN_2022_PROGRAM_ID,
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum MintKind {
    Classic,
    Token2022,
}

/// Creates a fresh mint with the given program and decimals. Returns (mint, mint_authority).
pub fn create_mint(
    svm: &mut LiteSVM,
    payer: &Keypair,
    kind: MintKind,
    decimals: u8,
) -> (Pubkey, Keypair) {
    let token_program = token_program_for(kind);
    let mint = Keypair::new();
    let authority = Keypair::new();
    svm.airdrop(&authority.pubkey(), 1_000_000_000).unwrap();

    let rent = svm.minimum_balance_for_rent_exemption(MintState::LEN);
    let create = solana_system_interface_instruction_create_account(
        payer.pubkey(),
        mint.pubkey(),
        rent,
        MintState::LEN as u64,
        token_program,
    );
    let init = match kind {
        MintKind::Classic => spl_token_interface::instruction::initialize_mint2(
            &token_program,
            &mint.pubkey(),
            &authority.pubkey(),
            None,
            decimals,
        )
        .unwrap(),
        MintKind::Token2022 => spl_token_2022_interface::instruction::initialize_mint2(
            &token_program,
            &mint.pubkey(),
            &authority.pubkey(),
            None,
            decimals,
        )
        .unwrap(),
    };
    let msg = Message::new(&[create, init], Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer, &mint], msg, svm.latest_blockhash());
    svm.send_transaction(tx)
        .expect("create+mint init should succeed");
    dedupe(svm);
    (mint.pubkey(), authority)
}

fn solana_system_interface_instruction_create_account(
    from: Pubkey,
    to: Pubkey,
    lamports: u64,
    space: u64,
    owner: Pubkey,
) -> Instruction {
    // system program `CreateAccount` instruction: u32 tag 0, then lamports, space, owner.
    let mut data = Vec::with_capacity(4 + 8 + 8 + 32);
    data.extend_from_slice(&0u32.to_le_bytes());
    data.extend_from_slice(&lamports.to_le_bytes());
    data.extend_from_slice(&space.to_le_bytes());
    data.extend_from_slice(owner.as_ref());
    Instruction {
        program_id: SYSTEM_PROGRAM_ID,
        accounts: vec![AccountMeta::new(from, true), AccountMeta::new(to, true)],
        data,
    }
}

/// Creates (idempotently) the ATA for `owner`/`mint` under `token_program`.
pub fn create_ata(
    svm: &mut LiteSVM,
    payer: &Keypair,
    owner: &Pubkey,
    mint: &Pubkey,
    token_program: &Pubkey,
) -> Pubkey {
    let ata = get_associated_token_address_with_program_id(owner, mint, token_program);
    let ix = spl_associated_token_account_interface::instruction::create_associated_token_account_idempotent(
        &payer.pubkey(),
        owner,
        mint,
        token_program,
    );
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer], msg, svm.latest_blockhash());
    svm.send_transaction(tx).expect("create ATA should succeed");
    dedupe(svm);
    ata
}

/// Creates a raw SPL token account (not the ATA) with the given program and owner.
pub fn create_raw_token_account(
    svm: &mut LiteSVM,
    payer: &Keypair,
    mint: &Pubkey,
    owner: &Pubkey,
    token_program: &Pubkey,
) -> Pubkey {
    let account = Keypair::new();
    let rent = svm.minimum_balance_for_rent_exemption(TokenAccountState::LEN);
    let create = solana_system_interface_instruction_create_account(
        payer.pubkey(),
        account.pubkey(),
        rent,
        TokenAccountState::LEN as u64,
        *token_program,
    );
    let init = spl_token_interface::instruction::initialize_account3(
        token_program,
        &account.pubkey(),
        mint,
        owner,
    )
    .unwrap();
    let msg = Message::new(&[create, init], Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer, &account], msg, svm.latest_blockhash());
    svm.send_transaction(tx)
        .expect("raw token account init should succeed");
    dedupe(svm);
    account.pubkey()
}

pub fn mint_to(
    svm: &mut LiteSVM,
    payer: &Keypair,
    mint: &Pubkey,
    mint_authority: &Keypair,
    destination: &Pubkey,
    amount: u64,
    token_program: &Pubkey,
) {
    let ix = if *token_program == TOKEN_2022_PROGRAM_ID {
        spl_token_2022_interface::instruction::mint_to(
            token_program,
            mint,
            destination,
            &mint_authority.pubkey(),
            &[],
            amount,
        )
        .unwrap()
    } else {
        spl_token_interface::instruction::mint_to(
            token_program,
            mint,
            destination,
            &mint_authority.pubkey(),
            &[],
            amount,
        )
        .unwrap()
    };
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer, mint_authority], msg, svm.latest_blockhash());
    svm.send_transaction(tx).expect("mint_to should succeed");
    dedupe(svm);
}

pub fn token_balance(svm: &LiteSVM, account: &Pubkey) -> u64 {
    read_token_account(svm, account).map(|a| a.amount).unwrap_or(0)
}

/// Plain SPL `Transfer` (no program involvement) authority-signed by `authority`.
pub fn raw_transfer(
    svm: &mut LiteSVM,
    payer: &Keypair,
    authority: &Keypair,
    source: &Pubkey,
    destination: &Pubkey,
    amount: u64,
    token_program: &Pubkey,
) {
    let ix = spl_token_interface::instruction::transfer(
        token_program,
        source,
        destination,
        &authority.pubkey(),
        &[],
        amount,
    )
    .unwrap();
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer, authority], msg, svm.latest_blockhash());
    svm.send_transaction(tx)
        .expect("raw transfer should succeed");
    dedupe(svm);
}

pub fn read_token_account(svm: &LiteSVM, account: &Pubkey) -> Option<TokenAccountState> {
    let acc = svm.get_account(account)?;
    TokenAccountState::unpack(&acc.data).ok()
}

pub fn token_authority(svm: &LiteSVM, account: &Pubkey) -> Option<Pubkey> {
    read_token_account(svm, account).map(|a| a.owner)
}

pub fn account_exists(svm: &LiteSVM, account: &Pubkey) -> bool {
    svm.get_account(account).is_some()
}

pub fn lamports(svm: &LiteSVM, account: &Pubkey) -> u64 {
    svm.get_account(account).map(|a| a.lamports).unwrap_or(0)
}

pub fn read_config(svm: &LiteSVM, config: &Pubkey) -> Config {
    let acc = svm.get_account(config).expect("config account must exist");
    Config::try_deserialize(&mut acc.data.as_slice()).expect("config deserializes")
}

pub fn read_invoice(svm: &LiteSVM, invoice: &Pubkey) -> Invoice {
    let acc = svm.get_account(invoice).expect("invoice account must exist");
    Invoice::try_deserialize(&mut acc.data.as_slice()).expect("invoice deserializes")
}

pub fn config_account_len(svm: &LiteSVM, config: &Pubkey) -> usize {
    svm.get_account(config).unwrap().data.len()
}

pub fn invoice_account_len(svm: &LiteSVM, invoice: &Pubkey) -> usize {
    svm.get_account(invoice).unwrap().data.len()
}

pub fn now(svm: &LiteSVM) -> i64 {
    svm.get_sysvar::<Clock>().unix_timestamp
}

/// Warps the clock to an absolute unix timestamp.
pub fn warp_to(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar::<Clock>(&clock);
}

// ---------------------------------------------------------------------------
// PDA helpers
// ---------------------------------------------------------------------------

pub fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], &program_id())
}

pub fn invoice_pda(merchant: &Pubkey, invoice_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[INVOICE_SEED, merchant.as_ref(), &invoice_id.to_le_bytes()],
        &program_id(),
    )
}

pub fn escrow_ata(invoice: &Pubkey, mint: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(invoice, mint, &TOKEN_PROGRAM_ID)
}

/// Derives the classic-token ATA for an arbitrary owner.
pub fn ata_for(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(owner, mint, &TOKEN_PROGRAM_ID)
}

/// Builds an Invoice PDA for a *different* merchant (seeds-constraint attack helper).
pub fn foreign_invoice_pda(merchant: &Pubkey, invoice_id: u64) -> Pubkey {
    invoice_pda(merchant, invoice_id).0
}

// ---------------------------------------------------------------------------
// Instruction builders + send helper
// ---------------------------------------------------------------------------

pub fn initialize_config_ix(authority: &Pubkey, usdc_mint: &Pubkey) -> Instruction {
    let (config, _) = config_pda();
    let mut data = paytruth::instruction::InitializeConfig::DISCRIMINATOR.to_vec();
    data.extend_from_slice(usdc_mint.as_ref());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*authority, true),
            AccountMeta::new(config, false),
            AccountMeta::new_readonly(*usdc_mint, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ],
        data,
    }
}

pub struct CreateInvoiceArgs {
    pub invoice_id: u64,
    pub amount_due: u64,
    pub expires_at: i64,
    pub memo: [u8; 64],
}

pub fn create_invoice_ix(
    merchant: &Pubkey,
    config: &Pubkey,
    invoice: &Pubkey,
    mint: &Pubkey,
    escrow: &Pubkey,
    token_program: &Pubkey,
    args: &CreateInvoiceArgs,
) -> Instruction {
    let mut data = paytruth::instruction::CreateInvoice::DISCRIMINATOR.to_vec();
    data.extend_from_slice(&args.invoice_id.to_le_bytes());
    data.extend_from_slice(&args.amount_due.to_le_bytes());
    data.extend_from_slice(&args.expires_at.to_le_bytes());
    data.extend_from_slice(&args.memo);
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*merchant, true),
            AccountMeta::new_readonly(*config, false),
            AccountMeta::new(*invoice, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*escrow, false),
            AccountMeta::new_readonly(*token_program, false),
            AccountMeta::new_readonly(ASSOCIATED_TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ],
        data,
    }
}

pub fn pay_invoice_ix(
    payer: &Pubkey,
    config: &Pubkey,
    invoice: &Pubkey,
    mint: &Pubkey,
    payer_ata: &Pubkey,
    escrow: &Pubkey,
    token_program: &Pubkey,
    amount: u64,
) -> Instruction {
    let mut data = paytruth::instruction::PayInvoice::DISCRIMINATOR.to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*payer, true),
            AccountMeta::new_readonly(*config, false),
            AccountMeta::new(*invoice, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*payer_ata, false),
            AccountMeta::new(*escrow, false),
            AccountMeta::new_readonly(*token_program, false),
        ],
        data,
    }
}

pub fn merchant_claim_ix(
    merchant: &Pubkey,
    invoice: &Pubkey,
    mint: &Pubkey,
    escrow: &Pubkey,
    merchant_ata: &Pubkey,
    token_program: &Pubkey,
) -> Instruction {
    let data = paytruth::instruction::MerchantClaim::DISCRIMINATOR.to_vec();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*merchant, true),
            AccountMeta::new(*invoice, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*escrow, false),
            AccountMeta::new(*merchant_ata, false),
            AccountMeta::new_readonly(*token_program, false),
            AccountMeta::new_readonly(ASSOCIATED_TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ],
        data,
    }
}

pub fn refund_overpayment_ix(
    caller: &Pubkey,
    invoice: &Pubkey,
    mint: &Pubkey,
    escrow: &Pubkey,
    payer: &Pubkey,
    payer_ata: &Pubkey,
    token_program: &Pubkey,
) -> Instruction {
    let data = paytruth::instruction::RefundOverpayment::DISCRIMINATOR.to_vec();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*caller, true),
            AccountMeta::new(*invoice, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*escrow, false),
            AccountMeta::new_readonly(*payer, false),
            AccountMeta::new(*payer_ata, false),
            AccountMeta::new_readonly(*token_program, false),
            AccountMeta::new_readonly(ASSOCIATED_TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ],
        data,
    }
}

pub fn expire_invoice_ix(caller: &Pubkey, invoice: &Pubkey) -> Instruction {
    let data = paytruth::instruction::ExpireInvoice::DISCRIMINATOR.to_vec();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*caller, true),
            AccountMeta::new(*invoice, false),
        ],
        data,
    }
}

pub fn recover_unattributed_ix(
    merchant: &Pubkey,
    invoice: &Pubkey,
    mint: &Pubkey,
    escrow: &Pubkey,
    destination_ata: &Pubkey,
    token_program: &Pubkey,
) -> Instruction {
    let data = paytruth::instruction::RecoverUnattributed::DISCRIMINATOR.to_vec();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*merchant, true),
            AccountMeta::new(*invoice, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*escrow, false),
            AccountMeta::new(*destination_ata, false),
            AccountMeta::new_readonly(*token_program, false),
            AccountMeta::new_readonly(ASSOCIATED_TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ],
        data,
    }
}

pub fn close_invoice_ix(
    merchant: &Pubkey,
    invoice: &Pubkey,
    mint: &Pubkey,
    escrow: &Pubkey,
    token_program: &Pubkey,
) -> Instruction {
    let data = paytruth::instruction::CloseInvoice::DISCRIMINATOR.to_vec();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*merchant, true),
            AccountMeta::new(*invoice, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*escrow, false),
            AccountMeta::new_readonly(*token_program, false),
        ],
        data,
    }
}

/// Sends a single-instruction transaction signed by `signers` (first is fee payer).
/// Expires the blockhash afterwards so repeated identical instructions are not deduped.
pub fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    signers: &[&Keypair],
    ix: Instruction,
) -> Result<(), (solana_transaction_error::TransactionError, Vec<String>)> {
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(signers, msg, svm.latest_blockhash());
    let res = svm.send_transaction(tx);
    svm.expire_blockhash();
    match res {
        Ok(_) => Ok(()),
        Err(failed) => Err((failed.err, failed.meta.logs)),
    }
}

pub fn expect_ok(
    svm: &mut LiteSVM,
    payer: &Keypair,
    signers: &[&Keypair],
    ix: Instruction,
) {
    if let Err((err, logs)) = send(svm, payer, signers, ix) {
        panic!("expected success but got {err:?}\nlogs:\n{}", logs.join("\n"));
    }
}

/// Like `expect_ok`, but returns the transaction fee paid.
pub fn expect_ok_fee(
    svm: &mut LiteSVM,
    payer: &Keypair,
    signers: &[&Keypair],
    ix: Instruction,
) -> u64 {
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(signers, msg, svm.latest_blockhash());
    let res = svm.send_transaction(tx);
    svm.expire_blockhash();
    match res {
        Ok(meta) => meta.fee,
        Err(failed) => panic!(
            "expected success but got {:?}\nlogs:\n{}",
            failed.err,
            failed.meta.logs.join("\n")
        ),
    }
}

/// Asserts the failure is a program `Custom` error carrying `code`.
pub fn assert_custom_error(
    result: Result<(), (solana_transaction_error::TransactionError, Vec<String>)>,
    source_id: &Pubkey,
    code: u32,
) {
    use solana_instruction_error::InstructionError;
    use solana_transaction_error::TransactionError;
    match result {
        Ok(()) => panic!("expected failure with custom code {code}, but tx succeeded"),
        Err((err, logs)) => match err {
            TransactionError::InstructionError(_, InstructionError::Custom(actual)) => {
                assert_eq!(actual, code, "wrong custom error code; logs:\n{}", logs.join("\n"));
            }
            other => panic!(
                "expected InstructionError::Custom({code}) from {source_id}, got {other:?}\nlogs:\n{}",
                logs.join("\n")
            ),
        },
    }
}

/// Asserts a specific non-custom `InstructionError` variant.
pub fn assert_instruction_error(
    result: Result<(), (solana_transaction_error::TransactionError, Vec<String>)>,
    expected: solana_instruction_error::InstructionError,
) {
    use solana_transaction_error::TransactionError;
    match result {
        Ok(()) => panic!("expected failure {expected:?}, but tx succeeded"),
        Err((err, logs)) => match err {
            TransactionError::InstructionError(_, actual) => {
                assert_eq!(actual, expected, "logs:\n{}", logs.join("\n"));
            }
            other => panic!("expected InstructionError, got {other:?}\nlogs:\n{}", logs.join("\n")),
        },
    }
}

/// Creates a config using a fresh classic 6-dec mint. Returns (config, mint, mint_authority).
pub fn setup_config(svm: &mut LiteSVM, authority: &Keypair) -> (Pubkey, Pubkey, Keypair) {
    let (mint, mint_auth) = create_mint(svm, authority, MintKind::Classic, USDC_DECIMALS);
    let (config, _) = config_pda();
    expect_ok(
        svm,
        authority,
        &[authority],
        initialize_config_ix(&authority.pubkey(), &mint),
    );
    (config, mint, mint_auth)
}

#[allow(clippy::too_many_arguments)]
pub fn do_create_invoice(
    svm: &mut LiteSVM,
    merchant: &Keypair,
    config: &Pubkey,
    invoice_id: u64,
    amount_due: u64,
    expires_at: i64,
    memo: [u8; 64],
    mint: &Pubkey,
) -> (Pubkey, Pubkey, u8) {
    let (invoice, bump) = invoice_pda(&merchant.pubkey(), invoice_id);
    let escrow = escrow_ata(&invoice, mint);
    expect_ok(
        svm,
        merchant,
        &[merchant],
        create_invoice_ix(
            &merchant.pubkey(),
            config,
            &invoice,
            mint,
            &escrow,
            &TOKEN_PROGRAM_ID,
            &CreateInvoiceArgs {
                invoice_id,
                amount_due,
                expires_at,
                memo,
            },
        ),
    );
    (invoice, escrow, bump)
}

/// Convenience: open invoice with a default memo and far-future expiry.
pub fn open_invoice(
    svm: &mut LiteSVM,
    merchant: &Keypair,
    config: &Pubkey,
    invoice_id: u64,
    amount_due: u64,
    mint: &Pubkey,
) -> (Pubkey, Pubkey) {
    let expiry = now(svm) + 100_000;
    let (invoice, escrow, _) =
        do_create_invoice(svm, merchant, config, invoice_id, amount_due, expiry, [0u8; 64], mint);
    (invoice, escrow)
}

/// Validates a mint account's decimals with classic Token owner (for sanity).
pub fn assert_classic_mint(svm: &LiteSVM, mint: &Pubkey, decimals: u8) {
    let acc = svm.get_account(mint).expect("mint exists");
    assert_eq!(acc.owner, TOKEN_PROGRAM_ID);
    let state = MintState::unpack(&acc.data).unwrap();
    assert_eq!(state.decimals, decimals);
}
