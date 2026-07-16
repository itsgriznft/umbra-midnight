/**
 * Real Midnight integration for Umbra — deploys/joins the compiled contract and
 * casts ballots through the Lace wallet on Preprod.
 *
 * This file is EXCLUDED from the default typecheck/build (see ui/tsconfig.json)
 * because it depends on the Midnight SDK and the compiler-generated contract,
 * which are only present for a real Preprod run. It is faithful to the official
 * `example-bboard` pattern (v4.x DApp connector, midnight-js-protocol providers).
 *
 * To enable it (see ui/README.md):
 *   1. compile the contract:   (repo root) npm run compact:build
 *   2. install the SDK deps:   npm i buffer rxjs semver \
 *        @midnight-ntwrk/dapp-connector-api \
 *        @midnight-ntwrk/midnight-js-contracts \
 *        @midnight-ntwrk/midnight-js-types \
 *        @midnight-ntwrk/midnight-js-network-id \
 *        @midnight-ntwrk/midnight-js-indexer-public-data-provider \
 *        @midnight-ntwrk/midnight-js-http-client-proof-provider \
 *        @midnight-ntwrk/midnight-js-fetch-zk-config-provider \
 *        @midnight-ntwrk/midnight-js-utils
 *   3. import "../globals" at the very top of main.tsx, then use UmbraLaceController.
 */

// @ts-nocheck  — reference integration; types resolve once the SDK + managed/ exist.
import { BehaviorSubject } from "rxjs";
import semver from "semver";
import { ConnectedAPI, type InitialAPI } from "@midnight-ntwrk/dapp-connector-api";
import { deployContract, findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import {
  type ContractAddress,
  fromHex,
  toHex,
} from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import {
  Binding,
  FinalizedTransaction,
  Proof,
  SignatureEnabled,
  Transaction,
  TransactionId,
} from "@midnight-ntwrk/midnight-js-protocol/ledger";

// Compiler-generated contract module + the local witness wiring (adjust paths to
// wherever your compiled output lives — repo-root `contracts/managed/umbra`).
import * as Umbra from "../../../../contracts/managed/umbra/contract/index.js";
import { CompiledUmbraContract } from "../../../../src/contract.js";
import { createUmbraPrivateState, witnesses } from "../../../../src/witnesses.js";

import type { PollState, UmbraController, UmbraMode } from "./types";

const PRIVATE_STATE_KEY = "umbraPrivateState";
const COMPATIBLE_CONNECTOR_API_VERSION = "4.x";

const randomBytes = (n: number) => {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
};

const getWallet = (): InitialAPI | undefined => {
  if (!window.midnight) return undefined;
  return Object.values(window.midnight).find(
    (w: any) => w && typeof w === "object" && "apiVersion" in w &&
      semver.satisfies(w.apiVersion, COMPATIBLE_CONNECTOR_API_VERSION),
  );
};

export class UmbraLaceController implements UmbraController {
  readonly mode: UmbraMode = "lace";
  #subject = new BehaviorSubject<PollState>({
    question: "", options: [], tallies: [], totalVotes: 0, hasVoted: false,
    myChoice: null, contractAddress: null, connected: false, busy: false, mode: "lace",
  });
  #connected?: ConnectedAPI;
  #providers?: any;
  #deployed?: any;

  getState(): PollState { return this.#subject.value; }
  subscribe(listener: (s: PollState) => void): () => void {
    const sub = this.#subject.subscribe(listener);
    return () => sub.unsubscribe();
  }
  #patch(p: Partial<PollState>) { this.#subject.next({ ...this.#subject.value, ...p }); }

  async connect(): Promise<void> {
    const networkId = import.meta.env.VITE_NETWORK_ID as string;
    const wallet = getWallet();
    if (!wallet) throw new Error("Midnight Lace wallet not found. Is the extension installed and enabled?");
    const connected = await wallet.connect(networkId);
    const config = await connected.getConfiguration();
    const shielded = await connected.getShieldedAddresses();

    const zkConfigPath = window.location.origin;
    const keyMaterial = new FetchZkConfigProvider(zkConfigPath, fetch.bind(window));

    this.#connected = connected;
    this.#providers = {
      privateStateProvider: inMemoryPrivateStateProvider(),
      zkConfigProvider: keyMaterial,
      proofProvider: httpClientProofProvider(config.proverServerUri!, keyMaterial),
      publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
      walletProvider: {
        getCoinPublicKey: () => shielded.shieldedCoinPublicKey,
        getEncryptionPublicKey: () => shielded.shieldedEncryptionPublicKey,
        balanceTx: async (tx: any) => {
          const received = await connected.balanceUnsealedTransaction(toHex(tx.serialize()));
          return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
            "signature", "proof", "binding", fromHex(received.tx),
          );
        },
      },
      midnightProvider: {
        submitTx: async (tx: FinalizedTransaction): Promise<TransactionId> => {
          await connected.submitTransaction(toHex(tx.serialize()));
          return tx.identifiers()[0];
        },
      },
    };
    this.#patch({ connected: true });
  }

  async deploy(question: string, options: string[]): Promise<string> {
    if (!this.#providers) throw new Error("Connect the wallet first");
    this.#patch({ busy: true });
    // NOTE: the Umbra constructor takes (question, numOptions).
    this.#deployed = await deployContract(this.#providers, {
      compiledContract: CompiledUmbraContract,
      privateStateId: PRIVATE_STATE_KEY,
      initialPrivateState: createUmbraPrivateState(randomBytes(32)),
      args: [question, options.length],
    });
    const address: ContractAddress = this.#deployed.deployTxData.public.contractAddress;
    this.#observe(address, options);
    this.#patch({ busy: false, contractAddress: address, question, options });
    return address;
  }

  async join(contractAddress: string): Promise<void> {
    if (!this.#providers) throw new Error("Connect the wallet first");
    this.#deployed = await findDeployedContract(this.#providers, {
      contractAddress,
      compiledContract: CompiledUmbraContract,
      privateStateId: PRIVATE_STATE_KEY,
      initialPrivateState: createUmbraPrivateState(randomBytes(32)),
    });
    this.#observe(contractAddress, []);
    this.#patch({ contractAddress });
  }

  async vote(option: number): Promise<void> {
    if (!this.#deployed) throw new Error("Deploy or join a poll first");
    this.#patch({ busy: true });
    try {
      await this.#deployed.callTx.vote(option); // proves + submits via wallet
      this.#patch({ hasVoted: true, myChoice: option });
    } finally {
      this.#patch({ busy: false });
    }
  }

  #observe(address: string, optionLabels: string[]) {
    this.#providers.publicDataProvider
      .contractStateObservable(address, { type: "latest" })
      .subscribe((cs: any) => {
        const l = Umbra.ledger(cs.data);
        const tallies = [l.votesOption0, l.votesOption1, l.votesOption2, l.votesOption3]
          .map((c: bigint) => Number(c))
          .slice(0, Number(l.optionCount));
        this.#patch({
          question: optionLabels.length ? this.#subject.value.question : String(l.question),
          options: optionLabels.length ? optionLabels : tallies.map((_, i) => `Option ${i + 1}`),
          tallies,
          totalVotes: Number(l.totalVotes),
        });
      });
  }
}

// Minimal private-state provider (the SDK also ships one; kept inline for clarity).
function inMemoryPrivateStateProvider() {
  const store = new Map<string, unknown>();
  let addr = "";
  return {
    setContractAddress(a: string) { addr = a; },
    async get(key: string) { return store.get(key) ?? store.get(addr); },
    async set(key: string, value: unknown) { store.set(key, value); },
    async remove(key: string) { store.delete(key); },
    async clear() { store.clear(); },
  };
}
