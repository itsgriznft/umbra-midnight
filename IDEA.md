# 💡 Idea — Umbra

**One line:** Anonymous, double-vote-proof, publicly-verifiable polls for on-chain communities,
powered by Midnight's zero-knowledge proofs.

## Why it fits Midnight

Midnight's whole value proposition is *selective disclosure*: prove what must be true, reveal
nothing else. Voting is the textbook case — you must prove "an eligible member cast one valid
ballot" while hiding "who". Transparent chains can't do this; Umbra makes it native.

## The problem

On transparent chains, every governance vote is a public record tied to an address. That has
consequences people work around rather than accept: whales are copied, dissent against a loud
majority is visible and therefore costly, and a member's whole voting history can be reassembled
from the ledger. So communities quietly move the decisions that matter into private polls —
and lose verifiability to get privacy back.

## Who it's for

- **DAOs / token communities** running sentiment or governance votes without whales steering the
  room and without doxxing members' positions.
- **Grant programs, hackathons, guilds** running anonymous nominations or approvals.
- **Any org** that needs an auditable count with a secret ballot.

## Why not the existing tools

| | Verifiable count | Secret ballot | No trusted operator |
| --- | --- | --- | --- |
| On-chain token vote | ✅ | ❌ every ballot is public | ✅ |
| Snapshot / off-chain signature | ✅ | ❌ signer is visible | ⚠️ operator hosts the tally |
| Web2 poll (Google Forms, Discord) | ❌ | ⚠️ operator sees everything | ❌ |
| **Umbra** | ✅ on-chain tally | ✅ voter never revealed | ✅ enforced by the circuit |

The gap is real: today you pick two of the three. Umbra's claim is that zero-knowledge proofs
make all three simultaneous, and the contract — not a promise — is what enforces it.

## What is built

Not a sketch. The repo runs today:

- **Poll factory** — one contract hosts many polls, each with its own question, options,
  organiser and lifecycle.
- **One ballot per key, enforced by a nullifier** — the secret key never leaves the device and
  no ballot is ever linked to it.
- **Merkle-allowlist eligibility** — private polls publish only the tree's *root*; members prove
  membership with a private path, so a ballot never says which member cast it.
- **Organiser-only close, proven in zero knowledge** — closing proves knowledge of the organiser
  secret without revealing who the organiser is.
- **A live demo** anyone can click through: <https://itsgriznft.github.io/umbra-midnight/>
- **43 tests**, including circuit-level tests against the compiled contract, all green in CI.

See the [README](README.md) for the privacy model — specifically what an observer can and
cannot learn — and [ROADMAP.md](ROADMAP.md) for how this grows through the lunar cycle.

## Why it's a real product, not a demo

- The privacy property is the feature people actually notice. A secret ballot is a
  centuries-old requirement that most on-chain tools silently break.
- The core primitive — a nullifier-gated anonymous action, with optional Merkle-proved
  eligibility — is reusable well beyond voting: anonymous attestations, private allowlists,
  sybil-resistant feedback. Umbra is the first product on top of it, not the only possible one.
- Adoption does not need a treasury or a token. A community can run one poll, in a browser, and
  see the point immediately — which is the path to the program's later traction goals.

## How the first users arrive

1. A community already running votes has a decision where visibility is the problem — a
   contentious grant, a leadership vote, a sentiment check people won't answer honestly in public.
2. The organiser publishes a poll from the browser; members need no wallet to see it and no
   identity to be counted.
3. The tally is on-chain and checkable by anyone, which is what makes the result *usable* as
   evidence afterwards — the reason to come back for the next vote.
