// Deploy the Umbra poll factory to Midnight Preprod through the Lace wallet.
//
// Deliberately small: the point is to get a verifiable contract address, not to
// run the app on-chain. The wallet does the balancing and signing, the local
// proof server builds the ZK proof, and the compiled circuits are served from
// /managed/umbra_polls so FetchZkConfigProvider can pull the proving keys.
import "./env-shim.js"; // must come first — see the file for why
import { Buffer } from "buffer";
globalThis.Buffer ??= Buffer;
globalThis.global ??= globalThis;

import semver from "semver";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { fromHex, toHex } from "@midnight-ntwrk/midnight-js-utils";
import {
  Transaction,
} from "@midnight-ntwrk/midnight-js-protocol/ledger";

import * as UmbraPolls from "../public/managed/umbra_polls/contract/index.js";

const CONNECTOR_API_VERSION = "4.x";
const PRIVATE_STATE_ID = "umbraPollsPrivateState";
const ZK_BASE = "/managed/umbra_polls";

const logEl = document.getElementById("log");
const outEl = document.getElementById("out");
const goEl = document.getElementById("go");

let first = true;
const log = (msg, cls = "") => {
  if (first) { logEl.textContent = ""; first = false; }
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  console.log(msg);
};

const randomBytes = (n) => {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
};

/** The connector injects one object per wallet under window.midnight. */
function findLace() {
  if (!window.midnight) return undefined;
  return Object.values(window.midnight).find(
    (w) => w && typeof w === "object" && "apiVersion" in w && semver.satisfies(w.apiVersion, CONNECTOR_API_VERSION),
  );
}

/** Private state lives only for this deploy; nothing needs to outlive the tab. */
function inMemoryPrivateStateProvider() {
  const store = new Map();
  let addr = "";
  return {
    setContractAddress(a) { addr = a; },
    async get(key) { return store.get(key) ?? store.get(addr); },
    async set(key, value) { store.set(key, value); },
    async remove(key) { store.delete(key); },
    async clear() { store.clear(); },
  };
}

const witnesses = {
  localSecretKey: ({ privateState }) => [privateState, privateState.secretKey],
  allowlistPath: ({ privateState }) => [privateState, privateState.allowlistPath],
  organiserSecret: ({ privateState }) => [privateState, privateState.organiserSecret],
};

/** A path that verifies against nothing — the factory constructor never uses it. */
const emptyPath = () => ({
  leaf: new Uint8Array(32),
  path: Array.from({ length: 10 }, () => ({ sibling: { field: 0n }, goes_left: true })),
});

async function main() {
  goEl.disabled = true;

  const lace = findLace();
  if (!lace) {
    log("Lace not found. Install the Midnight Lace extension and reload this page.", "bad");
    goEl.disabled = false;
    return;
  }
  log(`Found wallet: ${lace.name ?? "Lace"} (connector API ${lace.apiVersion})`);

  // Lace accepts: mainnet | preprod | preview | qanet | undeployed.
  log("Requesting connection — approve it in the Lace popup…");
  const connected = await lace.connect("preprod");
  const config = await connected.getConfiguration();
  const shielded = await connected.getShieldedAddresses();
  log("Connected.", "ok");
  log(`  indexer:      ${config.indexerUri}`);
  log(`  proof server: ${config.proverServerUri}`);
  setNetworkId("preprod");

  const zk = new FetchZkConfigProvider(window.location.origin + ZK_BASE, fetch.bind(window));
  const providers = {
    privateStateProvider: inMemoryPrivateStateProvider(),
    zkConfigProvider: zk,
    proofProvider: httpClientProofProvider(config.proverServerUri, zk),
    publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
    walletProvider: {
      getCoinPublicKey: () => shielded.shieldedCoinPublicKey,
      getEncryptionPublicKey: () => shielded.shieldedEncryptionPublicKey,
      balanceTx: async (tx) => {
        log("  balancing the transaction in the wallet…");
        const received = await connected.balanceUnsealedTransaction(toHex(tx.serialize()));
        return Transaction.deserialize("signature", "proof", "binding", fromHex(received.tx));
      },
    },
    midnightProvider: {
      submitTx: async (tx) => {
        log("  submitting…");
        await connected.submitTransaction(toHex(tx.serialize()));
        return tx.identifiers()[0];
      },
    },
  };

  const compiled = CompiledContract.make("UmbraPolls", UmbraPolls.Contract).pipe(
    CompiledContract.withWitnesses(witnesses),
  );

  log("Deploying the poll factory — this builds a ZK proof, it can take a minute…");
  const deployed = await deployContract(providers, {
    compiledContract: compiled,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: {
      secretKey: randomBytes(32),
      allowlistPath: emptyPath(),
      organiserSecret: randomBytes(32),
    },
    args: [],
  });

  const address = deployed.deployTxData.public.contractAddress;
  log("Deployed.", "ok");
  outEl.style.display = "block";
  outEl.innerHTML = `<strong>Contract address (Preprod)</strong><br>${address}`;
  log(`CONTRACT_ADDRESS=${address}`, "ok");
  goEl.disabled = false;
}

goEl.addEventListener("click", () => {
  main().catch((e) => {
    // Effect surfaces failures as tagged objects with no `message`, which
    // otherwise print as "[object Object]" and say nothing.
    const detail =
      e?.message ??
      (() => {
        try {
          return JSON.stringify(e, Object.getOwnPropertyNames(e ?? {})).slice(0, 900);
        } catch {
          return String(e);
        }
      })();
    log(`Failed: ${detail}`, "bad");
    console.error("deploy failed:", e);
    if (e?.stack) log(String(e.stack).split("\n").slice(0, 6).join("\n"), "dim");
    goEl.disabled = false;
  });
});
