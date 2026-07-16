# Umbra UI (Level 2 — Waxing Crescent 🌒)

React + Vite frontend for Umbra. The whole interface lives behind one
`UmbraController` interface with two implementations:

- **`MockController`** (default) — runs entirely in the browser, enforcing the
  same rules as the contract (one ballot per key + public tally). No wallet
  needed, so you can demo the full flow immediately.
- **`UmbraLaceController`** — the real integration: connects the **Lace** wallet,
  deploys/joins the compiled contract, and votes on **Preprod**. It follows the
  official `example-bboard` pattern (v4.x DApp connector).

## Run the demo (no wallet)

```bash
cd ui
npm install
npm run dev        # http://localhost:5173
```

Connect → create a poll (or join an address) → vote. Refresh keeps state; a
second vote from the same browser key is rejected, just like on-chain.

## Run against Preprod (real Lace wallet)

Prerequisites: WSL2 + Docker (proof server), the Compact toolchain, and the
[Lace wallet](https://www.lace.io) with Preprod tDUST.

```bash
# 1. compile the contract (repo root) — generates contracts/managed/umbra/
cd .. && npm run compact:build && cd ui

# 2. install the Midnight SDK + polyfills
npm i buffer rxjs semver \
  @midnight-ntwrk/dapp-connector-api \
  @midnight-ntwrk/midnight-js-contracts \
  @midnight-ntwrk/midnight-js-types \
  @midnight-ntwrk/midnight-js-network-id \
  @midnight-ntwrk/midnight-js-indexer-public-data-provider \
  @midnight-ntwrk/midnight-js-http-client-proof-provider \
  @midnight-ntwrk/midnight-js-fetch-zk-config-provider \
  @midnight-ntwrk/midnight-js-utils

# 3. point the app at Preprod
cp .env.example .env        # VITE_NETWORK_ID=Preprod

# 4. enable the real controller
#    - in src/main.tsx: add `import "./globals";` as the FIRST import
#    - in src/App.tsx:  swap `new MockController()` for `new UmbraLaceController()`
#      (see src/umbra/lace-controller.ts)
#    - remove src/umbra/lace-controller.ts from the tsconfig "exclude"

npm run dev
```

Start the proof server and indexer as described in the
[Midnight docs](https://docs.midnight.network), start a local proof server, then
connect Lace (set to Preprod), deploy a poll, and vote. The ZK proof is built
locally; only the anonymous nullifier + the chosen option reach the chain.

## Files

```
src/App.tsx                    the poll UI (depends only on UmbraController)
src/umbra/types.ts             UmbraController interface + PollState
src/umbra/mock-controller.ts   in-browser reference implementation (default)
src/umbra/lace-controller.ts   real Midnight + Lace integration (enable for Preprod)
src/globals.ts                 Buffer/process polyfills for the SDK
```
