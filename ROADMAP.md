# 🌙 Roadmap — Umbra through the lunar cycle

Umbra grows one project across all six levels of **New Moon to Full: Monthly Moonshots on
Midnight**. Each phase builds on the last.

| Phase | Milestone | Umbra deliverable |
| --- | --- | --- |
| 🌑 **L1 · New Moon** | Setup & first contract | ✅ Compact contract (anonymous nullifier-gated vote), toolchain, tests, CI, idea seeded — **this repo** |
| 🌒 **L2 · Waxing Crescent** | Frontend integration | React UI wired to the contract; connect **Lace** wallet; cast a vote on **Preprod** |
| 🌓 **L3 · First Quarter** | Production-grade dApp | Poll **factory** (many polls), Merkle allowlist eligibility, full test suite, CI/CD, tidy UX |
| 🌓 **The Turn** | Idea submission | Submit Umbra against a problem statement; commit to the direction |
| 🌔 **L4 · Waxing Gibbous** | MVP goes live | MVP live on Preprod, docs, deploy pipeline, public product profile on **X** |
| 🌕 **L5 · Full Moon** | Users & feedback | Living feedback loop + **50 Preprod users** running real polls |
| 🌝 **L6 · Supermoon** | Mainnet launch | Deploy to **Mainnet**, brand assets, onboard **20 real users**, iterate on feedback |

## Technical trajectory

- **L1 → L3:** move from four hard-coded option counters to a generalised, gated poll factory
  (Merkle-tree membership proofs for eligibility, a `Map` of polls).
- **L2 → L4:** off-chain indexer + UI to browse polls and results; wallet UX; deploy scripts.
- **L5 → L6:** onboarding funnel, analytics on participation (not on individual votes — that
  stays private), mainnet hardening and a security pass on the circuits.

## Design principles carried through every level

1. **The tally is public; the voter is private.** Never regress on this.
2. **No trusted tallier.** Correctness comes from the circuit.
3. **Reusable privacy primitive.** The nullifier-gated anonymous action underneath Umbra should
   stay clean enough to power future products (anonymous attestations, private allowlists).
