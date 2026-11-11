//! Harbor's leash: an owner's budget that an agent can spend only inside the owner's limits.
//!
//! The owner deposits a budget of one token and stores their limits. The agent's key is a
//! function-call key for `execute` alone. `execute` pays a 1Click deposit address only when 1Click's
//! own key signed the quote, and the signed quote sells the vault's token, delivers to one of the
//! owner's recipients, refunds to the owner, stays within the caps, and has not been paid before.
//! A stolen agent key can therefore only buy what the owner allowed, for delivery to the owner.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, Value};
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};

const DAY_NS: u64 = 24 * 60 * 60 * 1_000_000_000;
const GAS_TOKEN_CALL: Gas = Gas::from_tgas(15);
const GAS_CALLBACK: Gas = Gas::from_tgas(10);
/// What a token asks to register a fresh deposit address; refunded by the token if already registered.
const STORAGE_DEPOSIT: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);

/// What the owner allows the agent to do with this vault.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Limits {
    /// The NEP-141 token this vault holds and the agent may sell.
    pub token: AccountId,
    pub per_action: U128,
    pub per_day: U128,
    /// 1Click asset IDs the agent may buy, such as `nep141:usdt.tether-token.near`.
    pub buy_assets: Vec<String>,
    /// The owner's own addresses: the only recipients a paid quote may deliver to.
    pub recipients: Vec<String>,
    pub max_slippage_bps: u32,
    /// Unix milliseconds after which the agent can do nothing.
    pub expires_at_ms: u64,
}

#[near(serializers = [borsh])]
pub struct Vault {
    limits: Limits,
    balance: u128,
    frozen: bool,
    day_started_ns: u64,
    spent_today: u128,
}

#[near(serializers = [json])]
pub struct VaultView {
    pub limits: Limits,
    pub balance: U128,
    pub frozen: bool,
    pub spent_today: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Leash {
    /// The only account that may call `execute`.
    agent: AccountId,
    /// 1Click's ed25519 key that signs every quote.
    quote_signer: [u8; 32],
    vaults: LookupMap<AccountId, Vault>,
    /// Deposit addresses already paid: each quote is paid at most once.
    paid: LookupSet<String>,
}

#[near]
impl Leash {
    #[init]
    pub fn new(agent: AccountId, quote_signer: String) -> Self {
        Self {
            agent,
            quote_signer: decode_key(&quote_signer),
            vaults: LookupMap::new(b"v"),
            paid: LookupSet::new(b"p"),
        }
    }

    /// Opens or updates the caller's vault. The caller pays for the storage it uses.
    #[payable]
    pub fn set_limits(&mut self, limits: Limits) {
        let owner = env::predecessor_account_id();
        require!(limits.recipients.len() <= 16 && limits.buy_assets.len() <= 32, "Too many entries");
        require!(limits.per_action.0 <= limits.per_day.0, "The per-action cap cannot exceed the daily cap");
        let before = env::storage_usage();
        match self.vaults.get_mut(&owner) {
            Some(vault) => {
                require!(vault.balance == 0 || vault.limits.token == limits.token, "Withdraw before changing the token");
                vault.limits = limits;
            }
            None => {
                self.vaults.insert(
                    owner.clone(),
                    Vault { limits, balance: 0, frozen: false, day_started_ns: env::block_timestamp(), spent_today: 0 },
                );
            }
        }
        self.vaults.flush();
        charge_storage(before, &owner);
    }

    /// Stops the agent at once. Only the owner can undo it.
    pub fn freeze(&mut self) {
        self.own_vault().frozen = true;
        log_event("freeze", &env::predecessor_account_id(), "{}");
    }

    pub fn unfreeze(&mut self) {
        self.own_vault().frozen = false;
    }

    /// Returns budget to the owner, frozen or not. The agent can never call this for anyone.
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        let owner = env::predecessor_account_id();
        let vault = self.own_vault();
        require!(amount.0 > 0 && amount.0 <= vault.balance, "Not that much in the vault");
        vault.balance -= amount.0;
        let token = vault.limits.token.clone();
        Promise::new(token)
            .function_call(
                "ft_transfer".to_string(),
                serde_json::json!({ "receiver_id": owner, "amount": amount }).to_string().into_bytes(),
                NearToken::from_yoctonear(1),
                GAS_TOKEN_CALL,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_withdraw(owner, amount))
    }

    /// Credits a deposit of the vault's token from its owner; anything else goes straight back.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let _ = msg;
        let token = env::predecessor_account_id();
        match self.vaults.get_mut(&sender_id) {
            Some(vault) if vault.limits.token == token => {
                vault.balance += amount.0;
                PromiseOrValue::Value(U128(0))
            }
            _ => PromiseOrValue::Value(amount),
        }
    }

    /// Pays one 1Click deposit from `owner`'s vault, if 1Click signed this exact quote and it fits the
    /// owner's limits. `quote` is the canonical JSON 1Click signs; `signature` is its ed25519 signature.
    pub fn execute(&mut self, owner: AccountId, quote: String, signature: String) -> Promise {
        require!(env::predecessor_account_id() == self.agent, "Only the agent may execute");
        let message = bs58::encode(env::sha256(quote.as_bytes())).into_string();
        let signature = decode_signature(&signature);
        require!(
            env::ed25519_verify(&signature, message.as_bytes(), &self.quote_signer),
            "1Click did not sign this quote"
        );
        let quote: Value = serde_json::from_str(&quote).unwrap_or_else(|_| env::panic_str("Unreadable quote"));
        let field = |name: &str| quote.get(name).and_then(Value::as_str).unwrap_or_default().to_string();

        let now_ns = env::block_timestamp();
        let vault = self.vaults.get_mut(&owner).unwrap_or_else(|| env::panic_str("No vault for this owner"));
        require!(!vault.frozen, "The owner froze this vault");
        require!(now_ns / 1_000_000 < vault.limits.expires_at_ms, "The owner's limits have expired");
        require!(quote.get("dry") == Some(&Value::Bool(false)), "Not an executable quote");
        require!(field("swapType") == "EXACT_INPUT", "Only exact-input swaps");
        require!(field("depositType") == "ORIGIN_CHAIN", "Only origin-chain deposits");
        require!(field("refundType") == "ORIGIN_CHAIN", "Refunds must return to the origin chain");
        require!(field("originAsset") == format!("nep141:{}", vault.limits.token), "This vault does not hold that asset");
        require!(vault.limits.buy_assets.contains(&field("destinationAsset")), "The owner does not allow buying that");
        require!(vault.limits.recipients.contains(&field("recipient")), "The recipient is not one of the owner's");
        require!(field("refundTo") == owner.as_str(), "Refunds must go to the owner");
        let slippage = quote.get("slippageTolerance").and_then(Value::as_u64).unwrap_or(u64::MAX);
        require!(slippage <= u64::from(vault.limits.max_slippage_bps), "Slippage is above the owner's limit");
        require!(parse_iso_ms(&field("deadline")).is_some_and(|ms| ms > now_ns / 1_000_000), "The quote has expired");

        let amount: u128 = field("amountIn").parse().unwrap_or_else(|_| env::panic_str("Unreadable amount"));
        require!(field("amount") == field("amountIn"), "The quote does not spend exactly what was asked");
        let deposit = field("depositAddress");
        require!(is_implicit_account(&deposit), "The deposit address is not a NEAR implicit account");
        require!(!self.paid.contains(&deposit), "This quote was already paid");

        if now_ns.saturating_sub(vault.day_started_ns) >= DAY_NS {
            vault.day_started_ns = now_ns;
            vault.spent_today = 0;
        }
        require!(amount > 0 && amount <= vault.limits.per_action.0, "Above the owner's per-action cap");
        require!(vault.spent_today + amount <= vault.limits.per_day.0, "Above the owner's daily cap");
        require!(amount <= vault.balance, "Not enough budget in the vault");
        vault.balance -= amount;
        vault.spent_today += amount;
        let token = vault.limits.token.clone();
        self.paid.insert(deposit.clone());
        log_event(
            "execute",
            &owner,
            &serde_json::json!({ "deposit": deposit, "amount": U128(amount), "recipient": field("recipient") }).to_string(),
        );

        Promise::new(token)
            .function_call(
                "storage_deposit".to_string(),
                serde_json::json!({ "account_id": deposit, "registration_only": true }).to_string().into_bytes(),
                STORAGE_DEPOSIT,
                GAS_TOKEN_CALL,
            )
            .function_call(
                "ft_transfer".to_string(),
                serde_json::json!({ "receiver_id": deposit, "amount": U128(amount) }).to_string().into_bytes(),
                NearToken::from_yoctonear(1),
                GAS_TOKEN_CALL,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_execute(owner, U128(amount)))
    }

    /// Puts the budget back if the transfer did not happen. The deposit address stays paid.
    #[private]
    pub fn on_execute(&mut self, owner: AccountId, amount: U128, #[callback_result] result: Result<(), PromiseError>) {
        if result.is_err() {
            if let Some(vault) = self.vaults.get_mut(&owner) {
                vault.balance += amount.0;
                vault.spent_today = vault.spent_today.saturating_sub(amount.0);
            }
            log_event("execute_failed", &owner, "{}");
        }
    }

    #[private]
    pub fn on_withdraw(&mut self, owner: AccountId, amount: U128, #[callback_result] result: Result<(), PromiseError>) {
        if result.is_err() {
            if let Some(vault) = self.vaults.get_mut(&owner) {
                vault.balance += amount.0;
            }
        }
    }

    pub fn get_vault(&self, owner: AccountId) -> Option<VaultView> {
        self.vaults.get(&owner).map(|vault| VaultView {
            limits: vault.limits.clone(),
            balance: U128(vault.balance),
            frozen: vault.frozen,
            spent_today: U128(vault.spent_today),
        })
    }

    pub fn get_agent(&self) -> AccountId {
        self.agent.clone()
    }
}

impl Leash {
    fn own_vault(&mut self) -> &mut Vault {
        let owner = env::predecessor_account_id();
        self.vaults.get_mut(&owner).unwrap_or_else(|| env::panic_str("You have no vault"))
    }
}

fn charge_storage(before: u64, owner: &AccountId) {
    let used = env::storage_usage().saturating_sub(before);
    let cost = env::storage_byte_cost().saturating_mul(u128::from(used));
    let attached = env::attached_deposit();
    require!(attached >= cost, "Attach enough NEAR to cover the vault's storage");
    let refund = attached.saturating_sub(cost);
    if !refund.is_zero() {
        let _ = Promise::new(owner.clone()).transfer(refund);
    }
}

fn log_event(event: &str, owner: &AccountId, data: &str) {
    env::log_str(&format!(
        r#"EVENT_JSON:{{"standard":"harbor-leash","version":"1.0.0","event":"{event}","owner":"{owner}","data":{data}}}"#
    ));
}

fn decode_key(value: &str) -> [u8; 32] {
    let bytes = bs58::decode(value.trim_start_matches("ed25519:"))
        .into_vec()
        .unwrap_or_else(|_| env::panic_str("Unreadable key"));
    bytes.try_into().unwrap_or_else(|_| env::panic_str("A key is 32 bytes"))
}

fn decode_signature(value: &str) -> [u8; 64] {
    let bytes = bs58::decode(value.trim_start_matches("ed25519:"))
        .into_vec()
        .unwrap_or_else(|_| env::panic_str("Unreadable signature"));
    bytes.try_into().unwrap_or_else(|_| env::panic_str("A signature is 64 bytes"))
}

fn is_implicit_account(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Unix milliseconds for an ISO 8601 UTC time such as `2026-11-14T05:25:10.968Z`.
fn parse_iso_ms(value: &str) -> Option<u64> {
    let bytes = value.as_bytes();
    if bytes.len() < 20 || bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' || !value.ends_with('Z') {
        return None;
    }
    let number = |range: std::ops::Range<usize>| value.get(range)?.parse::<i64>().ok();
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    let (hour, minute, second) = (number(11..13)?, number(14..16)?, number(17..19)?);
    let millis = if bytes[19] == b'.' { number(20..23).unwrap_or(0) } else { 0 };
    // Days from the civil date, after Howard Hinnant's algorithm.
    let shifted = if month <= 2 { year - 1 } else { year };
    let era = shifted.div_euclid(400);
    let year_of_era = shifted - era * 400;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;
    let ms = (((days * 24 + hour) * 60 + minute) * 60 + second) * 1000 + millis;
    u64::try_from(ms).ok()
}

#[cfg(test)]
mod tests;
