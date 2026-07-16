# 💡 Idea — Umbra

**One line:** Anonymous, double-vote-proof, publicly-verifiable polls for on-chain communities,
powered by Midnight's zero-knowledge proofs.

## Why it fits Midnight

Midnight's whole value proposition is *selective disclosure*: prove what must be true, reveal
nothing else. Voting is the textbook case — you must prove "an eligible member cast one valid
ballot" while hiding "who". Transparent chains can't do this; Umbra makes it native.

## Who it's for

- **DAOs / token communities** that want sentiment or governance votes without whales steering
  the room and without doxxing members' positions.
- **Grant programs, hackathons, guilds** running anonymous nominations or approvals.
- **Any org** that needs an auditable count with a secret ballot.

## Why it's a real product (not a demo)

- The privacy property is the feature people actually pay attention to — secret ballot is a
  centuries-old requirement that most on-chain tools silently break.
- It has an obvious growth path from a single poll → poll factory → hosted app with real users
  (see [ROADMAP.md](ROADMAP.md)), which lines up with the program's Level 4–6 traction goals.
- The core cryptographic primitive (nullifier-gated anonymous action) is reusable: anonymous
  attestations, private allowlists, sybil-resistant feedback — Umbra is the first product on top
  of it.

## Level 1 scope (this repo)

A single fixed poll with up to four options:

- public per-option tallies + total ballot count,
- a `witness`-supplied secret key that stays off-chain,
- a nullifier set that enforces **one ballot per key** without revealing the voter,
- a reference-model test suite and CI that compiles the contract.

## What's deliberately out of scope for Level 1

Membership/eligibility gating (Merkle allowlist), many concurrent polls, the React UI, and live
testnet deployment — those are Levels 2–4. Level 1 proves the core private-voting circuit works.
