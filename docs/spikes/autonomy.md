# Spike: how the agent is held to the policy

2026-11-11. The question: what lets Harbor's agent act without the owner signing each action, while limits stay enforced outside Harbor's own server?

## Options checked

**Intents agent API.** No official NEAR Intents API for delegated agent limits was found in the NEAR Intents docs or the 1Click OpenAPI on this date. Third-party agent-custody services exist, but would add a custodian. Not used.

**1Click signed intents.** `depositType: INTENTS` lets a user sign an off-chain intent instead of a deposit, but the signature is the owner's own key: it does not bound an agent. Not used for autonomy.

**Leash contract.** Feasible, and the strongest option. Design:

- One contract holds per-owner vaults. The owner deposits a budget with `ft_transfer_call` and stores limits matching their signed policy: allowed tokens, per-action and daily caps, own recipients, expiry, freeze.
- The agent's key is a function-call key that can only call `execute`, with a small gas allowance.
- `execute(owner, signed_quote, signature)` verifies 1Click's ed25519 quote signature on chain against 1Click's manager key (`env::ed25519_verify` over the base58 SHA-256 of the canonical quote, the scheme Harbor already verifies in `packages/adapters/src/oneclick/signature.ts`), then parses the signed quote and checks: origin token is the vault's, amount within caps, `recipient` is one of the owner's, `refundTo` is the owner, deadline in the future, deposit address never used before. Only then does it `ft_transfer` to the deposit address.
- So a stolen agent key can only buy what the owner allowed, within caps, for delivery to the owner. 1Click's key becomes the trust root for where the swap delivers.

**Server enforcement with one-tap approval.** Always available: the agent queues actions under an active policy; the owner signs each in one tap. Harbor's server never signs.

## Decision

Ship server enforcement with one-tap approval now, which keeps the rule that nothing signs for the owner without a bounded mechanism. Build the leash contract next. It needs a mainnet account and storage deposit to deploy, so deploying it is a person's call, and it stays outside the Worker until it is deployed and audited.
