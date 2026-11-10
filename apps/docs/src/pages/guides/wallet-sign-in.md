# Wallet sign-in

Harbor uses NEAR Connect and NEP-413 message signing to establish a session. A sign-in message is not a transaction or permission to spend.

## Flow

1. Request a challenge for the account.
2. Review the message and recipient in the wallet, then sign there.
3. The Worker verifies the signature, browser-bound challenge, nonce, and account access key.
4. Successful verification creates an HTTP-only session cookie.
5. Logout ends the session and clears its cookie.

The recipient is the request host, so a message signed for another host must not verify here. Cookies use `SameSite=Lax` and are secure on HTTPS. Session reads disable caching.

The full-access check refers to the **public key's permission on the account**. Harbor must never request the private full-access key or seed phrase. Signing in does not activate a strategy policy or enable execution.

## Validation scope

The repository has tests using recorded RPC responses. That is not a claim that every real wallet has been tested. If sign-in fails, confirm the selected account and network, use a new challenge, and inspect the public error and request ID. Never debug by pasting private keys.

Sources: [auth routes](https://github.com/alycz/harbor/blob/main/apps/worker/src/auth/routes.ts), [session implementation](https://github.com/alycz/harbor/blob/main/apps/worker/src/auth/session.ts), [NEP-413 verification](https://github.com/alycz/harbor/blob/main/packages/near/src/sign-in.ts).
