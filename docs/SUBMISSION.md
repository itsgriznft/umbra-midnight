# Submission checklist — New Moon to Full: Monthly Moonshots on Midnight

Repository: <https://github.com/itsgriznft/umbra-midnight> · Live demo:
<https://itsgriznft.github.io/umbra-midnight/> · Submission email:
`Livingdeath.shaman@gmail.com`

Every level's submission form takes only two inputs — the submission period and the GitHub
repository — so all the evidence has to live in this repo. This file maps each requirement to
where it is.

## 🌑 Level 1 — New Moon

| Requirement | Evidence |
| --- | --- |
| Toolchain installed, contract compiles via `compact compile` | [docs/compile-output.txt](compile-output.txt), screenshot [06-compile.png](screenshots/06-compile.png) |
| Passing test suite | [docs/test-output.txt](test-output.txt), screenshot [05-tests.png](screenshots/05-tests.png) — 43 passing |
| `managed/` directory generated (circuits + keys) | listed in the compile output: `keys/{createPoll,vote,closePoll}.{prover,verifier}`, `zkir/*.zkir` |
| README explains public state vs private witness | [Privacy model](../README.md#privacy-model--what-an-observer-can-and-cannot-learn) |
| Initial product idea paragraph | [The idea, in a paragraph](../README.md#the-idea-in-a-paragraph) |
| Minimum 5 meaningful commits | `git log` — 11+ |
| **Contract deployed with a visible address** | ✅ [`a14fc086c54c448c…`](../README.md#deployed) — the Level 1 contract, on **Preview** |

## 🌒 Level 2 — Waxing Crescent

| Requirement | Evidence |
| --- | --- |
| Lace connect / disconnect implemented | [ui/src/umbra/lace-controller.ts](../ui/src/umbra/lace-controller.ts) |
| Circuit called from the frontend | `UmbraFactory.vote` → `callTx.vote`; the mock factory runs the same seam in the demo |
| An observable privacy behaviour | a gated poll accepts a ballot while revealing nothing about which member cast it |
| Live demo link | <https://itsgriznft.github.io/umbra-midnight/> |
| README documenting the privacy claim | [Privacy model](../README.md#privacy-model--what-an-observer-can-and-cannot-learn) |
| Minimum 8 meaningful commits | `git log` — 11+ |
| **Deployed contract address** | ✅ [`7733833db4dc875b…`](../README.md#deployed) — the poll factory, on **Preview** |
| Demo video | [docs/video/umbra-demo.mp4](video/umbra-demo.mp4) — 68s, recorded against the live demo |

## 🌓 Level 3 — First Quarter

| Requirement | Evidence |
| --- | --- |
| Fully functional dApp using Midnight's privacy model | [contracts/umbra_polls.compact](../contracts/umbra_polls.compact) + [ui/](../ui/) |
| Minimum 3 tests passing | **43** — [05-tests.png](screenshots/05-tests.png) |
| CI/CD running (workflow + passing runs) | [ci.yml](../.github/workflows/ci.yml), [pages.yml](../.github/workflows/pages.yml), badges in the README |
| Public repository with complete README | [README.md](../README.md) |
| Live demo link | <https://itsgriznft.github.io/umbra-midnight/> |
| Screenshot: test output | [05-tests.png](screenshots/05-tests.png) |
| README "privacy model" section | [Privacy model](../README.md#privacy-model--what-an-observer-can-and-cannot-learn) |
| Minimum 10 meaningful commits | `git log` — 11+ |
| Chosen problem from the provided list | **Private Voting**, using **Private Allowlist Access** for eligibility |
| Product proposal submitted for approval | ⚠️ **needs one human click** — text below |
| Demo video (1 min) | [docs/video/umbra-demo.mp4](video/umbra-demo.mp4) — 68s, full flow |
| **Poll factory deployed on-chain** | ✅ [`7733833db4dc875b…`](../README.md#deployed) on **Preview**, tx `fa592e10…`, block 477369 |

## 💭 Idea Submission — ready to paste

Category to select: **Identity/credentials**. Period: **July Challenge**.

> Umbra — anonymous, verifiable polls on Midnight.
>
> THE PROBLEM. On transparent chains, on-chain governance publishes the complete voting history
> of every address. That enables coercion and vote-buying, and it encourages herding, because
> people can see how the large holders voted and copy them. It also deters honest participation:
> plenty of people will not vote at all if the vote is permanently attached to their name.
> Moving the vote off-chain fixes the privacy leak but throws away verifiability — you then have
> to trust whoever counts the ballots.
>
> THE IDEA. Umbra is a poll factory where the tally is public and auditable, but how any
> individual voted is not, and nobody can vote twice. A voter's secret key never leaves their
> device. The circuit derives a deterministic nullifier from it, checks that nullifier has not
> already been used for this poll, records it, and increments the chosen option's public counter.
> Because the nullifier is domain-separated by poll id, one key can vote in every poll but only
> once in each.
>
> Polls may be open to anyone, or gated by a Merkle allowlist. The organiser publishes only the
> root of a tree of member leaves; a voter proves membership with a path supplied as a private
> witness, and only the recomputed root is compared on-chain. So a ballot proves the voter was
> eligible without revealing which member cast it. The path's leaf is bound to the voter's own
> key, which matters: member leaves are public, so without that bind an outsider could replay
> somebody else's leaf and the allowlist would be worthless.
>
> From the provided list this is Private Voting, and it uses Private Allowlist Access as its
> eligibility primitive.
>
> THE PRIVACY MODEL. An observer learns how many ballots each option received, and that every
> ballot came from a distinct eligible member. An observer cannot learn which member cast which
> ballot, or whether any particular member voted at all. There is no trusted tallier —
> correctness comes from the circuit, not from an operator.
>
> WHERE IT IS TODAY. Levels 1 to 3 are built and public at
> https://github.com/itsgriznft/umbra-midnight — two Compact contracts (the Level 1 single poll,
> and the Level 3 poll factory with Merkle-allowlist eligibility), 43 passing tests, and green CI
> that compiles both contracts on every push. The tests include circuit-level tests that
> instantiate the real compiled contract against a local ledger and drive createPoll, vote and
> closePoll, so the off-chain allowlist builder is proven to agree with merkleTreePathRoot as the
> circuit computes it, and the leaf-replay attack is shown to be rejected by the circuit itself
> rather than by a model of it.
>
> THE PLAN FOR LEVEL 4. Take it live on Preprod: the factory deployed with a verifiable address,
> a hosted UI where a community can publish a poll, hand out member leaves and collect anonymous
> ballots, and the organiser tooling to build an allowlist and close a poll when voting ends. The
> nullifier-gated anonymous action underneath Umbra is deliberately kept clean enough to be
> reused for other products — anonymous attestations, private allowlists, anonymous feedback — so
> the contract doubles as a privacy primitive for the ecosystem, not just one app.

## 🌔 Level 4 — Waxing Gibbous

Level requirement, verbatim: *MVP live on Preprod, docs, CI/CD, public product (X) profile.*

| Requirement | Evidence |
| --- | --- |
| **MVP live** | <https://itsgriznft.github.io/umbra-midnight/> — publish a poll, gate it by allowlist, vote, close. The on-chain panel checks both deployed contracts live from the visitor's own browser. |
| **on Preprod** | ⚠️ deployed to **Preview** instead — see below |
| **Docs** | [README](../README.md) (privacy model, contracts, deploy, verification), [ROADMAP](../ROADMAP.md), [IDEA](../IDEA.md), [infra/INFRA.md](../infra/INFRA.md), [deploy-lace/README.md](../deploy-lace/README.md), [ui/README.md](../ui/README.md) |
| **CI/CD** | [ci.yml](../.github/workflows/ci.yml) compiles both Compact contracts, typechecks and runs 43 tests; [pages.yml](../.github/workflows/pages.yml) publishes the demo on every push. Both green — badges in the README. |
| **Public product (X) profile** | ⚠️ **needs a human** — profile text and launch thread written and ready in [docs/LAUNCH.md](LAUNCH.md) |

### Why Preview and not Preprod

This is the one place the submission departs from the letter of the requirement, so it is worth
being direct about it.

**Preprod could not be made to work.** A wallet must sync before it can pay a fee. On Preprod the
shielded and unshielded wallets synced, but the dust wallet did not: the sync stream failed to
decode ledger events (`protocolVersion: 1000000`) and stopped advancing. That was not a
dependency we could bump — `wallet-sdk-shielded@3.0.1` was the newest published version at the
time. `4.0.0-canary` later fixed the decode error, and then the dust wallet faced ~1.37M events
at roughly 43/s: about **8.5 hours of syncing per deploy attempt**. Two independent routes were
built — headless Node and browser-plus-Lace — and both stopped at this same wall.

**Preview was the answer given by the program.** Asked about it in the program channel, the
guidance was that *Preprod is unstable for now, use Preview instead*. Preview is a much shorter
chain, the same wallet syncs it in minutes, and the deploy then runs end to end.

**Nothing about the deliverable is weaker for it.** Preview is one of Midnight's public testnets,
the contracts are live and independently verifiable through its public indexer, and the deploy
script still takes `UMBRA_NETWORK=preprod` for whenever Preprod is usable again. The full
diagnosis is in the README under [Deployed](../README.md#deployed) and in
[deploy-lace/README.md](../deploy-lace/README.md).

> The Level 4 submission form is not open yet — unlike Levels 1–3 it has no link on the tasks
> page. This section is here so the evidence is ready the moment it opens.
