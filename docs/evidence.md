# Mainnet evidence

What has happened on NEAR mainnet, with the transaction hashes, and how to check each item yourself. Times are UTC. The hackathon's development window closed on 14 November 2026 at 23:59; anything after that is marked.

Every hash below can be opened at `https://nearblocks.io/txns/<hash>`. Every swap can be re-read from NEAR Intents at `https://1click.chaindefuser.com/v0/status?depositAddress=<deposit address>`, which names the origin and delivery transactions.

## Accounts

| Account | Role |
|---|---|
| `harbor-leash.near` | The deployed Leash contract ([contracts/leash](../contracts/leash)) |
| `harbor-agent.near` | The agent the contract trusts. It calls `execute` with a function-call key |
| `36093feb6b3abf76cc0c3b0456ec8180403e95b3fdfc57167da4c2e6492b0ac0` | Created both accounts above, and owns the first vault |
| `closedome193.near` | Owner wallet used for the wallet-signed swaps and the second vault |

## Leash: the agent spends a vault inside on-chain limits

| Step | Time | Transaction |
|---|---|---|
| Contract account created | 14 Nov 21:13 | `FCtjMUcxFHMvbHfFnq4TNcEM2ir8KyPitARUkhkAKy8c` |
| Agent account created | 14 Nov 21:13 | `7fLeAUGrsDHfDbhGaiHoqPyUM5h9CDmGw8zotz99FgoB` |
| Contract deployed and initialised with `agent: harbor-agent.near` and 1Click's key as `quote_signer` | 14 Nov 21:14 | `4PcBGTnDeEBbHabkvHamq9WPopo9FoBdTExYHCxZTSfT` |
| Function-call key added to the agent account | 14 Nov 21:17 | `5PZPHYiBwc3Ciz2ebgXQk1ZuSxQfNgWMvoxu2u93eXqz` |

**First run, inside the window.** 0.1 wNEAR swapped to USDC for the vault's owner.

| Step | Time | Transaction |
|---|---|---|
| Owner sets limits: token wNEAR, 0.1 per action and per day, may buy USDC only, deliver to the owner only, 1% slippage | 14 Nov 21:40 | `4cXZ4CpTWgpVP3qcMAcpz5tv8co1sibmNUK7CCHPmZUW` |
| Owner funds the vault with 0.1 wNEAR | 14 Nov 21:50 | `2p57udbfzb82quCQZJJR4Ym8KJUYLFhrXkxDz9ZaSTMr` |
| Agent calls `execute` with a 1Click-signed quote; the contract pays 0.1 wNEAR to the quote's deposit address | 14 Nov 22:23 | `AivY8fwq9E1jbpPbxQdL4oEt8LhMxDYoqDkBHyBuUrcX` |
| NEAR Intents delivers 0.298619 USDC to the owner. Status `SUCCESS` | by 14 Nov 23:09 | `C6zHCujHmJCJj6MeVb3PkygZarYj99FkHPe87LM9SieW` |

Deposit address: `83d44e5304c37a2e5e8883f9214f9e57f55d7f1ba9883a92eb808a13195b6c12`.

**Second run, after the deadline.** 2 USDC swapped to NEAR for a second owner, `closedome193.near`.

| Step | Time | Transaction |
|---|---|---|
| Owner sets limits: token USDC, 10 per action and per day, may buy wNEAR only, deliver to the owner only | 15 Nov 00:10 | `5tt84eyeNovM371kznwdw2P2oyDHwP4tp18SkLPMM9my` |
| Owner funds the vault with 2 USDC | 15 Nov 00:11 | `8cYEJJT92HWVd2cQmpE6gSzgxLBzf7m5xtbzfwPWvDoH` |
| Agent calls `execute`; the contract pays 2 USDC to the deposit address | 15 Nov 00:11 | `HiHuLdi1agPsD8aVMiJM4W3a6ocV49Cb8HTaHpho6Fp` |
| NEAR Intents delivers about 0.653 NEAR to the owner. Status `SUCCESS` | 15 Nov 00:12 | `Br7SQyvgubGdmosgushCmbq8XiZcL5Hp4L4VaEBibKEs` |

Deposit address: `62c9dd6ccc6951fc99cb4da2cb39b92000d3010a14193e4a47b8e35d65818a87`.

What this does not show:

- The contract has not been audited, and the amounts are small.
- `harbor-leash.near` still holds a full-access key, so its deployer can replace the code. Harbor's Worker pins the code hash it reviewed and refuses to dispatch if it changes (`apps/worker/src/autopilot/leash-dispatch.ts`).
- `harbor-agent.near` still holds the full-access key it was created with, beside the function-call key. The signer Worker refuses to sign with anything but an `execute`-only function-call key (`apps/leash-signer/src/scope.ts`), but the account itself is not yet reduced to that key.
- Each dispatch was approved by the vault's owner. Nothing ran unattended.

## Swaps signed in a wallet

USDC on NEAR to native NEAR, from and to `closedome193.near`. Each deposit is one transaction: register the deposit address on the token, then transfer exactly the quoted amount.

| Swap | Deposit | Delivery | Result |
|---|---|---|---|
| 10 USDC to NEAR | 14 Nov 22:59, `51jHBrS9P92qMGjU9gDeEvoNxi78vMiXX8jSBsT5JsHm` | 14 Nov 23:00, `5YAgaU9C7NECqB2E4tpgaypU24V7PPoaVpFCVcURg1u` | `SUCCESS`, about 3.380 NEAR delivered |
| 10 USDC to NEAR | 14 Nov 23:47, `3GMmDqD7fPYrrp3jsM5MxmcfX79Sdduj6VF45LaobSzZ` | 14 Nov 23:48, `BBX5jqrvn6Giv1aeFZui8W28LUc1cbwjNMBy1ysXGrD7` | `SUCCESS`, about 3.309 NEAR delivered |

Deposit addresses: `2c3637ce5412e39dc15cadd0152ec5f3fceaa963a0035e566763b6dbfb3407a6` and `78713f2eb8964384ab4917aea54e27d53e3df11c9d7393c88ebac95f1158be99`.

## Earn deposits that were refunded

Two deposits of 50 USDC into the Gauntlet USDC Prime vault on Base did not complete. NEAR Intents refunded both in full with reason `QUOTE_EXPIRED`. No Earn deposit has completed on mainnet.

| Deposit | Refund | Deposit address |
|---|---|---|
| 14 Nov 22:45, `tDZFoqep6Py8WDFGFfYNT6RU64zEGTDsUSgMZp83kuS` | `8phEn5S9YdCQwxN11NKiLNKz7He7RhSx4ddxcfjZPZny` | `9234931604fb896c7a9d0780d23dfd2943b6c00e5df95bc258f7578d7dc7f5ac` |
| 14 Nov 23:33, `9NbXwVzve4Y3wSffY5zurXaHV9H6iYAV32rLyR2WZnHn` | `E2ZsNiCUuzbAejBRy1Y4NNnTaNP3crusrPD8zupwzQxE` | `ed01b0755dbb441bded2c444ebbdf6b583725066873225987e3bf3b756ec5916` |

The refund reply these produced, with `amountIn` and `amountOut` null, is what commit `674fc65` teaches the client to accept. Harbor records a refund as `refunded`, never as a success.

## Rhea lending

| What | Time | Transaction |
|---|---|---|
| 10 USDC supplied to `contract.main.burrow.near` from `closedome193.near` | 14 Nov 23:35 | `4X6H9JWJP4NThZE65U8QQQE4LxL3xCqcT8fG7vJLdTKm` |
| A separate real supply of 11.171634 USDC, kept as the fixture Harbor's receipt check is tested on | November 2026 | `CX3nCVEtyTH7k3fhn3NruvYJmb6XXVDMyw4YMHU1dKNh` |

Re-read the fixture supply from chain with `HARBOR_LIVE_RHEA=1 pnpm --filter @harbor/adapters test`.

## Other

- The hosted app, `GET https://harbor.r13n.workers.dev/api/health`, answered `network: mainnet`, `executionEnabled: true`, `database: ok` on 15 November 2026. Deployments from this revision onward also report `revision`, the commit they were built from.
- A dry NEAR to USDC quote recorded from the live 1Click API on 3 November 2026 is kept as `packages/adapters/test/fixtures/oneclick-dry-quote.json`. Its signature verifies against `ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc`, the same key the deployed contract was initialised with.

## Not recorded

- A completed Earn vault deposit (both attempts were refunded, above).
- A Templar borrow.
- A swap delivered to an EVM chain or funded from one.
