# Changes after the deadline

The hackathon's development window closed on 14 November 2026 at 23:59 UTC. The last commit inside it is `ecca236` (23:09 UTC), tagged `hackathon-submission`. Compare anything later against that tag:

```sh
git diff hackathon-submission..main --stat
```

What changed afterwards, and why:

- **README rewritten** for the hackathon's README rules: the problem, steps of the form "run this, see that", a table tying each claim to a command and a file, one list of what is not verified live, the tracks, and the disclosure of reused work and AI-generated code. No capability was added to the list of claims.
- **`pnpm demo:attack`** added. It runs the poisoned-post test that already existed and prints the values that test asserts. The test's assertions are unchanged.
- **Documentation corrected** where pages had fallen behind the code: the safety page said policy signing was planned; the demo and spec named a removed Policy page, three of six agent tools and the wrong default model. Two internal handoff notes were removed (`docs/submission-checklist.md`, `contracts/leash/DEPLOYMENT-READINESS.md`) and replaced by `docs/evidence.md`, which lists the mainnet transactions.
- **Acknowledgements completed**: Inter and Newsreader, Tailwind, Motion, Vite, Vocs, DefiLlama's data and icons, and the design sources. A docs test that forbade linking the team's earlier repositories was removed.
- **Setup**: `pnpm install` no longer fails in a source download without a `.git` directory, and the Node version message no longer assumes nvm.
- **`/api/health`** reports the deployed commit as `revision`, so the hosted app can be matched to the source.
- **`/api/templar/markets`** answers 503 "could not be read right now" instead of an internal error when Templar's registry or catalogue is unreachable.

Nothing in the swap, policy, settlement or contract code changed.

One on-chain action also falls after the deadline: the second Leash run (set limits, fund, execute, delivery) on 15 November between 00:10 and 00:12 UTC. The contract deployment, the first Leash run and the wallet-signed swaps are all inside the window. `docs/evidence.md` gives the time of each.
