use ed25519_dalek::{Signer, SigningKey};
use near_sdk::json_types::U128;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{env, testing_env, AccountId, NearToken, PromiseError, PromiseOrValue};

use super::{parse_iso_ms, Leash, Limits};

const NOW_MS: u64 = 1_794_600_000_000;
const DEPOSIT: &str = "4f8a1c2e9b0d7a6f5e3c1b2a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e";
const USDT: &str = "nep141:usdt.tether-token.near";

fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}

/// Stands in for 1Click's manager key.
fn one_click() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

fn signer_key(key: &SigningKey) -> String {
    format!("ed25519:{}", bs58::encode(key.verifying_key().to_bytes()).into_string())
}

fn as_caller(name: &str, deposit: NearToken) {
    let mut context = VMContextBuilder::new();
    context
        .current_account_id(account("leash.near"))
        .predecessor_account_id(account(name))
        .signer_account_id(account(name))
        .attached_deposit(deposit)
        .block_timestamp(NOW_MS * 1_000_000);
    testing_env!(context.build());
}

fn limits() -> Limits {
    Limits {
        token: account("wrap.near"),
        per_action: U128(2_000),
        per_day: U128(3_000),
        buy_assets: vec![USDT.to_string()],
        recipients: vec!["alice.near".to_string()],
        max_slippage_bps: 50,
        expires_at_ms: NOW_MS + 86_400_000,
    }
}

/// A leash with alice's vault holding 10,000 wNEAR.
fn funded() -> Leash {
    as_caller("deployer.near", NearToken::from_yoctonear(0));
    let mut leash = Leash::new(account("agent.near"), signer_key(&one_click()));
    as_caller("alice.near", NearToken::from_near(1));
    leash.set_limits(limits());
    as_caller("wrap.near", NearToken::from_yoctonear(0));
    match leash.ft_on_transfer(account("alice.near"), U128(10_000), String::new()) {
        PromiseOrValue::Value(refund) => assert_eq!(refund.0, 0),
        PromiseOrValue::Promise(_) => panic!("expected a value"),
    }
    leash
}

/// The canonical quote 1Click signs, as Harbor passes it on.
fn quote(change: impl FnOnce(&mut near_sdk::serde_json::Value)) -> String {
    let mut value = near_sdk::serde_json::json!({
        "amount": "1000",
        "amountIn": "1000",
        "deadline": "2026-11-20T00:00:00.000Z",
        "depositAddress": DEPOSIT,
        "depositType": "ORIGIN_CHAIN",
        "destinationAsset": USDT,
        "dry": false,
        "originAsset": "nep141:wrap.near",
        "recipient": "alice.near",
        "recipientType": "DESTINATION_CHAIN",
        "refundTo": "alice.near",
        "refundType": "ORIGIN_CHAIN",
        "slippageTolerance": 50,
        "swapType": "EXACT_INPUT",
    });
    change(&mut value);
    value.to_string()
}

fn signed(quote: &str, key: &SigningKey) -> String {
    let message = bs58::encode(env::sha256(quote.as_bytes())).into_string();
    format!("ed25519:{}", bs58::encode(key.sign(message.as_bytes()).to_bytes()).into_string())
}

fn execute(leash: &mut Leash, quote: &str) {
    as_caller("agent.near", NearToken::from_yoctonear(0));
    let _ = leash.execute(account("alice.near"), quote.to_string(), signed(quote, &one_click()));
}

#[test]
fn credits_only_the_owner_s_deposits_of_the_vault_token() {
    let mut leash = funded();
    as_caller("usdt.tether-token.near", NearToken::from_yoctonear(0));
    match leash.ft_on_transfer(account("alice.near"), U128(5), String::new()) {
        PromiseOrValue::Value(refund) => assert_eq!(refund.0, 5),
        PromiseOrValue::Promise(_) => panic!("expected a refund"),
    }
    as_caller("wrap.near", NearToken::from_yoctonear(0));
    match leash.ft_on_transfer(account("bob.near"), U128(5), String::new()) {
        PromiseOrValue::Value(refund) => assert_eq!(refund.0, 5),
        PromiseOrValue::Promise(_) => panic!("expected a refund"),
    }
    assert_eq!(leash.get_vault(account("alice.near")).unwrap().balance.0, 10_000);
}

#[test]
fn pays_a_signed_in_limit_quote_once() {
    let mut leash = funded();
    execute(&mut leash, &quote(|_| {}));
    let vault = leash.get_vault(account("alice.near")).unwrap();
    assert_eq!(vault.balance.0, 9_000);
    assert_eq!(vault.spent_today.0, 1_000);
    assert!(get_logs().iter().any(|line| line.contains(r#""event":"execute""#) && line.contains(DEPOSIT)));
}

#[test]
#[should_panic(expected = "This quote was already paid")]
fn never_pays_the_same_deposit_twice() {
    let mut leash = funded();
    execute(&mut leash, &quote(|_| {}));
    execute(&mut leash, &quote(|_| {}));
}

#[test]
#[should_panic(expected = "Only the agent may execute")]
fn only_the_agent_executes() {
    let mut leash = funded();
    let quote = quote(|_| {});
    as_caller("mallory.near", NearToken::from_yoctonear(0));
    let _ = leash.execute(account("alice.near"), quote.clone(), signed(&quote, &one_click()));
}

#[test]
#[should_panic(expected = "1Click did not sign this quote")]
fn refuses_a_quote_1click_did_not_sign() {
    let mut leash = funded();
    let quote = quote(|_| {});
    as_caller("agent.near", NearToken::from_yoctonear(0));
    let _ = leash.execute(account("alice.near"), quote.clone(), signed(&quote, &SigningKey::from_bytes(&[9u8; 32])));
}

#[test]
#[should_panic(expected = "1Click did not sign this quote")]
fn refuses_a_signed_quote_altered_afterwards() {
    let mut leash = funded();
    let original = quote(|_| {});
    let altered = quote(|value| value["recipient"] = "attacker.near".into());
    as_caller("agent.near", NearToken::from_yoctonear(0));
    let _ = leash.execute(account("alice.near"), altered, signed(&original, &one_click()));
}

#[test]
#[should_panic(expected = "The recipient is not one of the owner's")]
fn refuses_delivery_to_anyone_but_the_owner() {
    let mut leash = funded();
    execute(&mut leash, &quote(|value| value["recipient"] = "attacker.near".into()));
}

#[test]
#[should_panic(expected = "Refunds must go to the owner")]
fn refuses_refunds_to_anyone_but_the_owner() {
    let mut leash = funded();
    execute(&mut leash, &quote(|value| value["refundTo"] = "attacker.near".into()));
}

#[test]
#[should_panic(expected = "The owner does not allow buying that")]
fn refuses_assets_the_owner_did_not_allow() {
    let mut leash = funded();
    execute(&mut leash, &quote(|value| value["destinationAsset"] = "nep141:meme.near".into()));
}

#[test]
#[should_panic(expected = "Above the owner's per-action cap")]
fn holds_the_per_action_cap() {
    let mut leash = funded();
    execute(&mut leash, &quote(|value| {
        value["amount"] = "2001".into();
        value["amountIn"] = "2001".into();
    }));
}

#[test]
#[should_panic(expected = "Above the owner's daily cap")]
fn holds_the_daily_cap() {
    let mut leash = funded();
    execute(&mut leash, &quote(|value| {
        value["amount"] = "2000".into();
        value["amountIn"] = "2000".into();
    }));
    execute(&mut leash, &quote(|value| {
        value["amount"] = "1500".into();
        value["amountIn"] = "1500".into();
        value["depositAddress"] = "a".repeat(64).into();
    }));
}

#[test]
#[should_panic(expected = "The owner froze this vault")]
fn stops_when_frozen() {
    let mut leash = funded();
    as_caller("alice.near", NearToken::from_yoctonear(0));
    leash.freeze();
    execute(&mut leash, &quote(|_| {}));
}

#[test]
#[should_panic(expected = "The quote has expired")]
fn refuses_an_expired_quote() {
    let mut leash = funded();
    execute(&mut leash, &quote(|value| value["deadline"] = "2026-11-01T00:00:00.000Z".into()));
}

#[test]
#[should_panic(expected = "Slippage is above the owner's limit")]
fn holds_the_slippage_limit() {
    let mut leash = funded();
    execute(&mut leash, &quote(|value| value["slippageTolerance"] = 51.into()));
}

#[test]
fn restores_the_budget_when_the_transfer_fails() {
    let mut leash = funded();
    execute(&mut leash, &quote(|_| {}));
    as_caller("leash.near", NearToken::from_yoctonear(0));
    leash.on_execute(account("alice.near"), U128(1_000), Err(PromiseError::Failed));
    let vault = leash.get_vault(account("alice.near")).unwrap();
    assert_eq!(vault.balance.0, 10_000);
    assert_eq!(vault.spent_today.0, 0);
}

#[test]
fn lets_the_owner_withdraw_frozen_or_not() {
    let mut leash = funded();
    as_caller("alice.near", NearToken::from_yoctonear(0));
    leash.freeze();
    let _ = leash.withdraw(U128(4_000));
    assert_eq!(leash.get_vault(account("alice.near")).unwrap().balance.0, 6_000);
}

#[test]
#[should_panic(expected = "You have no vault")]
fn never_lets_the_agent_withdraw() {
    let mut leash = funded();
    as_caller("agent.near", NearToken::from_yoctonear(0));
    let _ = leash.withdraw(U128(1));
}

#[test]
fn reads_iso_times_as_unix_milliseconds() {
    assert_eq!(parse_iso_ms("2000-03-01T00:00:00Z"), Some(951_868_800_000));
    assert_eq!(parse_iso_ms("2026-11-14T05:25:10.968Z"), Some(1_794_633_910_968));
    assert_eq!(parse_iso_ms("2024-02-29T23:59:59.999Z"), Some(1_709_251_199_999));
    assert_eq!(parse_iso_ms("not a date"), None);
}
