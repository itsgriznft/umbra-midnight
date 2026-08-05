// Headless deploy of the Umbra Compact contract to Midnight Preprod.
// Builds a fresh wallet, auto-funds it from the Preprod faucet, generates dust,
// then deploys the contract and prints its address. Requires a local proof
// server on http://127.0.0.1:6300.
//
//   node deploy.mjs
//
import path from "node:path";
import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import pino from "pino";
import * as Rx from "rxjs";

import { setNetworkId, getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import {
  ZswapSecretKeys,
  DustSecretKey,
  LedgerParameters,
  unshieldedToken,
} from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { ttlOneHour } from "@midnight-ntwrk/midnight-js-utils";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { FluentWalletBuilder } from "@midnight-ntwrk/testkit-js";
import { requestTokens } from "./faucet.mjs";
import { UnshieldedAddress } from "@midnight-ntwrk/wallet-sdk-address-format";
import { HDWallet, Roles } from "@midnight-ntwrk/wallet-sdk-hd";
import { createKeystore } from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";

import * as Umbra from "./managed/umbra/contract/index.js";

// @ts-ignore - enable WebSocket for the indexer subscription
globalThis.WebSocket = WebSocket;

const logger = pino({ level: "info", base: undefined, timestamp: false });

const NETWORK = "preprod";
const env = {
  walletNetworkId: NETWORK,
  networkId: NETWORK,
  indexer: "https://indexer.preprod.midnight.network/api/v4/graphql",
  indexerWS: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
  node: "https://rpc.preprod.midnight.network",
  nodeWS: "wss://rpc.preprod.midnight.network",
  faucet: "https://midnight-tmnight-preprod.nethermind.dev/",
  proofServer: "http://127.0.0.1:6300",
};

const ZK_CONFIG_PATH = path.join(import.meta.dirname, "managed", "umbra");
const PRIVATE_STATE_ID = "umbraPrivateState";
const POLL_QUESTION = "Which lunar phase should Umbra ship on?";
const NUM_OPTIONS = 4n;

const witnesses = {
  localSecretKey: ({ privateState }) => [privateState, privateState.secretKey],
};

const isComplete = (p) => !!p && typeof p.isStrictlyComplete === "function" && p.isStrictlyComplete();

// Dump every field the SDK exposes on a progress object — the names differ
// between the shielded/dust/unshielded wallets and change between releases, so
// guessing which one means "done" is how you end up waiting on the wrong number.
const describe = (p) => {
  if (!p) return "null";
  const own = {};
  for (const k of Object.keys(p)) {
    const v = p[k];
    if (typeof v !== "function" && typeof v !== "object") own[k] = typeof v === "bigint" ? v.toString() : v;
  }
  for (const m of ["isStrictlyComplete", "isComplete", "isSynced"]) {
    if (typeof p[m] === "function") { try { own[m + "()"] = p[m](); } catch { own[m + "()"] = "threw"; } }
  }
  return JSON.stringify(own);
};

// The dust wallet can report a target of the whole chain while only ever
// applying the handful of events that concern it, so it never satisfies
// isStrictlyComplete(). UMBRA_RELAX_DUST treats it as done once the other two
// wallets are complete and dust has stopped moving.
const RELAX_DUST = !!process.env.UMBRA_RELAX_DUST;
let dumped = false;
let dustLast = -1;
let dustStill = 0;
const dustSettled = (p) => {
  const applied = Number(p?.appliedIndex ?? -1);
  if (applied === dustLast) dustStill += 1;
  else { dustLast = applied; dustStill = 0; }
  return dustStill >= 6;
};

const isSynced = (s) => {
  const others = isComplete(s.shielded.state.progress) && isComplete(s.unshielded.progress);
  const dustP = s.dust.state.progress;
  if (isComplete(dustP)) return others;
  if (RELAX_DUST && others && dustSettled(dustP)) return true;
  return false;
};

// A wallet counts as synced once it has APPLIED everything relevant to itself
// (highestRelevantWalletIndex / highestTransactionId) and is still connected —
// not once it reaches the chain tip (highestIndex), which it never has to.
// The shielded/dust wallets use ...Index names; the unshielded one uses ...Id.
const at = (p) => {
  if (!p) return "n/a";
  const applied = p.appliedIndex ?? p.appliedId;
  const target = p.highestRelevantWalletIndex ?? p.highestTransactionId;
  return `${applied}/${target}${p.isConnected ? "" : " DISCONNECTED"}`;
};
const syncLine = (s) =>
  `shielded=${at(s.shielded.state.progress)} dust=${at(s.dust.state.progress)} unshielded=${at(s.unshielded.progress)}` +
  ` tip=${s.shielded.state.progress?.highestIndex ?? "?"}` +
  ` rss=${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)}MB`;

async function buildWallet(seed) {
  const dustOptions = {
    ledgerParams: LedgerParameters.initialParameters(),
    additionalFeeOverhead: 1000n,
    feeBlocksMargin: 5,
  };
  const built = await FluentWalletBuilder.forEnvironment(env).withDustOptions(dustOptions).withSeed(seed).buildWithoutStarting();
  const { wallet, seeds, keystore } = built;
  const zswapSecretKeys = ZswapSecretKeys.fromSeed(seeds.shielded);
  const dustSecretKey = DustSecretKey.fromSeed(seeds.dust);
  await wallet.start(zswapSecretKeys, dustSecretKey);
  const shielded0 = await Rx.firstValueFrom(wallet.shielded.state);
  logger.info(`Wallet ready. Shielded address: ${shielded0.address.coinPublicKeyString?.() ?? "(n/a)"}`);
  return { wallet, seeds, keystore, zswapSecretKeys, dustSecretKey };
}

async function fundAndWait(wallet) {
  const token = unshieldedToken();
  const init = await Rx.firstValueFrom(wallet.unshielded.state);
  const addr = UnshieldedAddress.codec.encode(getNetworkId(), init.address).toString();
  logger.info(`Unshielded (NIGHT) address: ${addr}`);

  const bal0 = init.balances[token.raw];
  if (bal0 && bal0 > 0n) {
    logger.info("Already funded — skipping the faucet.");
    return init;
  }

  // NOT testkit's FaucetClient: it silently no-ops against the public faucet.
  // See faucet.mjs for the details.
  if (process.env.UMBRA_SKIP_FAUCET) {
    logger.info("UMBRA_SKIP_FAUCET set — assuming the address is already funded.");
  } else {
    try {
      await requestTokens(addr, { faucet: env.faucet, log: (m) => logger.info(m) });
    } catch (e) {
      logger.warn(`Faucet request failed: ${e?.message ?? e}`);
      logger.warn(`Fund it manually at ${env.faucet} and re-run with UMBRA_SKIP_FAUCET=1.`);
    }
  }
  logger.info("Waiting for NIGHT to arrive (sync)...");
  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(3000),
      Rx.tap((s) => logger.info(`  synced=${isSynced(s)} night=${(s.unshielded.balances[token.raw] ?? 0n).toString()} ${syncLine(s)}`)),
      Rx.tap((s) => {
        if (dumped) return;
        dumped = true;
        logger.info(`  dust.progress   = ${describe(s.dust.state.progress)}`);
        logger.info(`  shielded.progress = ${describe(s.shielded.state.progress)}`);
        logger.info(`  unshielded.progress = ${describe(s.unshielded.progress)}`);
      }),
      Rx.filter((s) => isSynced(s) && (s.unshielded.balances[token.raw] ?? 0n) > 0n),
      Rx.map((s) => s.unshielded),
    ),
  );
}

function unshieldedSeedFromHex(seed) {
  const res = HDWallet.fromSeed(Buffer.from(seed, "hex"));
  const { hdWallet } = res;
  const d = hdWallet.selectAccount(0).selectRole(Roles.NightExternal).deriveKeyAt(0);
  if (d.type === "keyOutOfBounds") throw new Error("Key derivation out of bounds");
  return d.key;
}

async function generateDust(seed, unshieldedState, wallet) {
  const dustState = await wallet.dust.waitForSyncedState();
  const ks = createKeystore(unshieldedSeedFromHex(seed), getNetworkId());
  const utxos = unshieldedState.availableCoins.filter((c) => !c.meta.registeredForDustGeneration);
  if (utxos.length === 0) { logger.info("No UTXOs to register for dust."); return; }
  logger.info(`Registering ${utxos.length} UTXO(s) for dust generation...`);
  const recipe = await wallet.registerNightUtxosForDustGeneration(utxos, ks.getPublicKey(), (p) => ks.signData(p), dustState.address);
  const tx = await wallet.finalizeRecipe(recipe);
  const txId = await wallet.submitTransaction(tx);
  logger.info(`Dust registration tx: ${txId}`);
  const dustBal = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.dust.balance(new Date()) > 0n), Rx.map((s) => s.dust.balance(new Date()))));
  logger.info(`Dust balance: ${dustBal}`);
}

async function main() {
  setNetworkId(NETWORK);
  logger.info(`Deploying Umbra to ${NETWORK}. Proof server: ${env.proofServer}`);
  // Reusing a seed keeps an earlier faucet grant (faucets rate-limit per address).
  const seed = process.env.UMBRA_SEED ?? randomBytes(32).toString("hex");
  logger.info(`Wallet seed (set UMBRA_SEED to reuse): ${seed}`);

  const { wallet, zswapSecretKeys, dustSecretKey, keystore } = await buildWallet(seed);

  const walletProvider = {
    getCoinPublicKey: () => zswapSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => zswapSecretKeys.encryptionPublicKey,
    balanceTx: async (tx, ttl = ttlOneHour()) => {
      const recipe = await wallet.balanceUnboundTransaction(tx, { shieldedSecretKeys: zswapSecretKeys, dustSecretKey }, { ttl });
      const signed = await wallet.signRecipe(recipe, (payload) => keystore.signData(payload));
      return wallet.finalizeRecipe(signed);
    },
    submitTx: (tx) => wallet.submitTransaction(tx),
  };

  const unshielded = await fundAndWait(wallet);
  logger.info(`NIGHT balance: ${(unshielded.balances[unshieldedToken().raw] ?? 0n).toString()}`);
  await generateDust(seed, unshielded, wallet);

  const zkConfigProvider = new NodeZkConfigProvider(ZK_CONFIG_PATH);
  const providers = {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: "umbra-private-state",
      signingKeyStoreName: "umbra-private-state-signing-keys",
      privateStoragePasswordProvider: () => "Umbra-Deploy-2026!",
      accountId: seed,
    }),
    publicDataProvider: indexerPublicDataProvider(env.indexer, env.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(env.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };

  const compiled = CompiledContract.make("Umbra", Umbra.Contract).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(ZK_CONFIG_PATH),
  );

  logger.info("Deploying contract (this builds a ZK proof via the proof server)...");
  const deployed = await deployContract(providers, {
    compiledContract: compiled,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: { secretKey: new Uint8Array(randomBytes(32)) },
    args: [POLL_QUESTION, NUM_OPTIONS],
  });

  const address = deployed.deployTxData.public.contractAddress;
  logger.info("========================================");
  logger.info(`CONTRACT_ADDRESS=${address}`);
  logger.info(`NETWORK=${NETWORK}`);
  logger.info("========================================");
  console.log(`CONTRACT_ADDRESS=${address}`);

  try { await wallet.stop(); } catch {}
  process.exit(0);
}

main().catch((e) => { logger.error(e); console.error("DEPLOY_FAILED: " + (e?.message ?? e)); process.exit(1); });
