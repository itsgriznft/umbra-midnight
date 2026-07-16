# 🌑 Umbra — anonymous, verifiable polls on Midnight

> _Start in the dark. Ship in the light._
> Level 1 (New Moon) submission for **New Moon to Full: Monthly Moonshots on Midnight**.

Umbra is a privacy-first voting dApp built on [Midnight](https://midnight.network) with the
[Compact](https://docs.midnight.network) smart-contract language. It gives communities a poll
where **the result is public and auditable, but how any individual voted is not** — and where
**nobody can vote twice**, all enforced by zero-knowledge proofs.

## The problem

On transparent chains, on-chain governance leaks the full voting history of every address.
That enables **coercion, vote-buying, and herding** (people copy whales), and it deters honest
participation. "Just move it off-chain" throws away verifiability — you then have to trust the
tallier.

## What Umbra does

| Property | How |
| --- | --- |
| Public, auditable tally | Per-option counters live in the public ledger |
| Anonymous voter | The ballot never stores an identity; only an unlinkable nullifier |
| One vote per member | A nullifier derived from the voter's secret key is recorded once |
| No trusted tallier | Correctness is enforced by the ZK circuit, not an operator |

The voter's secret key is provided by a local `witness` and **never leaves the device**. The
circuit derives a deterministic nullifier from it, checks it hasn't been used, records it, and
increments the chosen option's public counter.

## Contract

[`contracts/umbra.compact`](contracts/umbra.compact) — a single fixed poll with up to four
options. Highlights:

```compact
witness localSecretKey(): Bytes<32>;

export circuit vote(option: Uint<8>): [] {
  assert(option < optionCount, "Umbra: option out of range");
  const tag = disclose(voterNullifier(localSecretKey()));
  assert(!nullifiers.member(tag), "Umbra: this voter has already voted");
  nullifiers.insert(tag);
  // ...increment the chosen option's public counter + totalVotes
}
```

## Getting started

Requires Node.js ≥ 22 and the Compact toolchain (Linux/macOS, or Windows via WSL2).

```bash
# 1. Install the Compact developer tools, then the compiler
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
compact update 0.31.0

# 2. Install JS deps
npm install

# 3. Compile the contract to zero-knowledge circuits
npm run compact:build      # -> contracts/managed/umbra/

# 4. Typecheck + run the reference-model tests
npm run typecheck
npm test
```

Compilation emits the JS/TS bindings and proving/verifying keys under
`contracts/managed/umbra/` (git-ignored). Deployment to the Preview/Preprod testnet with a
funded [Lace](https://www.lace.io) wallet is wired up in **Level 2** (see the
[roadmap](ROADMAP.md)).

## Project layout

```
contracts/umbra.compact   # the Compact smart contract (Level 1 deliverable)
src/witnesses.ts          # witness wiring — supplies the private secret key
src/types.ts              # off-chain private-state + poll/result types
test/logic.test.mjs       # node:test reference model of the contract rules
.github/workflows/ci.yml  # CI: typecheck + tests, and compile the contract
IDEA.md                   # the product idea (Level 1 "seed the idea")
ROADMAP.md                # how Umbra grows across the six lunar levels
```

## Status

- ✅ **Level 1 — New Moon:** first Compact contract + toolchain + tests + CI, idea seeded.
- ⏳ Level 2 — Waxing Crescent: React UI + Lace wallet on Preprod.

See [ROADMAP.md](ROADMAP.md) for the full six-phase plan.

## License

[MIT](LICENSE).
