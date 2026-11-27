mod common;

use common::*;

#[test]
fn h1_initialize_config() {
    let mut svm = setup_svm();
    let authority = funded_keypair(&mut svm);
    let (mint, _mint_auth) = create_mint(&mut svm, &authority, MintKind::Classic, USDC_DECIMALS);
    let (config, expected_bump) = config_pda();

    expect_ok(
        &mut svm,
        &authority,
        &[&authority],
        initialize_config_ix(&authority.pubkey(), &mint),
    );

    assert_eq!(config_account_len(&svm, &config), CONFIG_ACCOUNT_LEN);
    let cfg = read_config(&svm, &config);
    assert_eq!(cfg.authority, authority.pubkey());
    assert_eq!(cfg.usdc_mint, mint);
    assert_eq!(cfg.bump, expected_bump);
}
