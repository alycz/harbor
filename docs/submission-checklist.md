# Submission checklist

This is a checklist, not a claim that deployment, wallet testing or submission has
already completed. Leash deployment is a separate handoff.

## Judge entry points

- App: https://harbor.r13n.workers.dev/chat
- Source: https://github.com/alycz/harbor
- Local setup: follow the root README, using `pnpm run setup` then `pnpm dev`.
- Demo script: [demo.md](demo.md). Without a model key, chat is scripted.

## Before recording or submitting

- Record the final main commit and passing CI for that exact revision.
- Confirm the hosted app is that revision, with working same-origin API, D1 migrations,
  Durable Object bindings, session cookies and one-minute scheduled trigger.
- Inspect remote migration impact first, particularly replacement of legacy Rhea plans.
- For real transactions, verify `EXECUTION_ENABLED=true` and only the intended adapters
  in `ENABLED_WRITE_ADAPTERS` (`oneclick`, `rhea-lending`, `templar`).
  The default `deploy:mainnet` command does not itself request execution enablement.
- Verify a real wallet sign-in and the exact demo flow. Automated mock-backed tests,
  a successful quote and a build are not proof of a signed deposit or settlement.
- Check the configured model responds; do not label the scripted fallback a live model.
- Record a public demo video/post and complete the official submission with working
  links. Add the actual published demo link to the submission; no video is claimed here.
- Disclose the baseline/reused work and what was built during the hackathon accurately.
  Use repository history and the team's records, not invented dates or attribution.

## Describe capabilities accurately

- Guardrails apply to Harbor-generated plans, not all NEAR transactions in the wallet.
- Periodic monitors discover opportunities; users review and sign trades separately.
- Quotes are not guaranteed profit, and two cross-chain legs are not an atomic trade.
- Rhea/Templar execution depends on supported markets, liquidity and account setup.
- Leash has an owner-approved UI, durable dispatch and private bounded signer, not verified deployed autonomous
  trading. See [its handoff](../contracts/leash/README.md); do not use fixture accounts
  as deployment accounts or claim a testnet stand-in is real 1Click settlement.
- KAIO is excluded from the current implementation scope.

Do not include private keys, provider secrets or funded-wallet credentials in the
repository, recording, logs or submission.
