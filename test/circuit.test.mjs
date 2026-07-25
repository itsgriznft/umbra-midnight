// Circuit-level tests: these run the REAL compiled Compact contract
// (contracts/managed/umbra_polls) against a local ledger, rather than a
// hand-written model. They are what pins src/allowlist.mjs to the circuit —
// a path built off-chain must satisfy `merkleTreePathRoot` on-chain, and a
// forged one must not.
//
// The compiled contract only exists after `npm run compact:build`, which needs
// the Compact toolchain (Linux/macOS/WSL2). When it is absent these tests skip
// rather than fail, so `npm test` still works on a bare checkout; CI compiles
// first and therefore always runs them.
import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

import {
  Allowlist,
  emptyPath,
  memberLeaf,
  organiserAuth,
  pathRoot,
  bytes32,
} from "../src/allowlist.mjs";

const MANAGED = new URL("../contracts/managed/umbra_polls/contract/index.js", import.meta.url);
const compiled = existsSync(MANAGED);

describe("compiled umbra_polls circuits", { skip: compiled ? false : "run `npm run compact:build` first" }, () => {
  let Contract, ledger, pureCircuits, runtime;

  before(async () => {
    ({ Contract, ledger, pureCircuits } = await import(MANAGED.href));
    runtime = await import("@midnight-ntwrk/compact-runtime");
  });

  /** A fresh contract plus a tiny driver that threads the circuit context. */
  function deploy() {
    // The witnesses read whatever the current private state holds, so a test
    // can swap the acting voter between calls.
    const witnesses = {
      localSecretKey: ({ privateState }) => [privateState, privateState.secretKey],
      allowlistPath: ({ privateState }) => [privateState, privateState.allowlistPath],
      organiserSecret: ({ privateState }) => [privateState, privateState.organiserSecret],
    };
    const contract = new Contract(witnesses);
    const initialPrivateState = {
      secretKey: new Uint8Array(32),
      allowlistPath: emptyPath(),
      organiserSecret: new Uint8Array(32),
    };
    const { currentContractState, currentPrivateState, currentZswapLocalState } =
      contract.initialState(runtime.createConstructorContext(initialPrivateState, "0".repeat(64)));

    let context = runtime.createCircuitContext(
      runtime.sampleContractAddress(),
      currentZswapLocalState,
      currentContractState,
      currentPrivateState,
    );

    const call = (name, privateState, ...args) => {
      context = { ...context, currentPrivateState: { ...context.currentPrivateState, ...privateState } };
      const out = contract.impureCircuits[name](context, ...args);
      context = out.context;
      return out.result;
    };

    return {
      call,
      state: () => ledger(context.currentQueryContext.state),
    };
  }

  const POLL = bytes32("poll:lunar-phase");
  const ORGANISER = bytes32("organiser-secret");
  const members = ["member-a", "member-b", "member-c"].map(bytes32);
  const outsider = bytes32("outsider");

  const openPoll = (c, id = POLL, options = 3n) =>
    c.call("createPoll", {}, id, "Which phase?", options, false, { field: 0n }, organiserAuth(ORGANISER));

  const gatedPoll = (c, list, id = POLL) =>
    c.call("createPoll", {}, id, "Members only", 2n, true, list.root, organiserAuth(ORGANISER));

  // ── the factory ───────────────────────────────────────────────────────────

  test("the constructor publishes the allowlist depth", () => {
    const c = deploy();
    assert.equal(c.state().allowlistDepth, 10n);
    assert.equal(c.state().pollCount, 0n);
  });

  test("createPoll records a poll and its metadata", () => {
    const c = deploy();
    openPoll(c);
    const s = c.state();
    assert.equal(s.pollCount, 1n);
    assert.equal(s.polls.member(POLL), true);
    const poll = s.polls.lookup(POLL);
    assert.equal(poll.question, "Which phase?");
    assert.equal(poll.optionCount, 3n);
    assert.equal(poll.open, true);
    assert.equal(s.totals.lookup(POLL), 0n);
  });

  test("a duplicate poll id is rejected", () => {
    const c = deploy();
    openPoll(c);
    assert.throws(() => openPoll(c), /already exists/);
  });

  test("option count is bounded to 2..8", () => {
    const c = deploy();
    assert.throws(() => openPoll(c, bytes32("p1"), 1n), /at least two options/);
    assert.throws(() => openPoll(c, bytes32("p2"), 9n), /at most eight options/);
  });

  // ── voting ────────────────────────────────────────────────────────────────

  test("an open poll tallies a ballot without any path", () => {
    const c = deploy();
    openPoll(c);
    c.call("vote", { secretKey: members[0], allowlistPath: emptyPath() }, POLL, 1n);
    const s = c.state();
    assert.equal(s.totals.lookup(POLL), 1n);
    assert.equal(s.tallies.lookup(pureCircuits.tallyKey(POLL, 1n)), 1n);
    assert.equal(s.nullifiers.size(), 1n);
  });

  test("the same key cannot vote twice in one poll", () => {
    const c = deploy();
    openPoll(c);
    const voter = { secretKey: members[0], allowlistPath: emptyPath() };
    c.call("vote", voter, POLL, 0n);
    assert.throws(() => c.call("vote", voter, POLL, 1n), /already voted/);
    assert.equal(c.state().totals.lookup(POLL), 1n);
  });

  test("a key votes once in each poll", () => {
    const c = deploy();
    const second = bytes32("poll:second");
    openPoll(c);
    openPoll(c, second, 2n);
    const voter = { secretKey: members[0], allowlistPath: emptyPath() };
    c.call("vote", voter, POLL, 0n);
    c.call("vote", voter, second, 1n);
    const s = c.state();
    assert.equal(s.totals.lookup(POLL), 1n);
    assert.equal(s.totals.lookup(second), 1n);
  });

  test("an out-of-range option is rejected", () => {
    const c = deploy();
    openPoll(c);
    assert.throws(
      () => c.call("vote", { secretKey: members[0], allowlistPath: emptyPath() }, POLL, 3n),
      /out of range/,
    );
  });

  test("voting in an unknown poll is rejected", () => {
    const c = deploy();
    assert.throws(
      () => c.call("vote", { secretKey: members[0], allowlistPath: emptyPath() }, POLL, 0n),
      /no such poll/,
    );
  });

  // ── the Merkle allowlist, against the real circuit ────────────────────────

  test("src/allowlist.mjs agrees with the contract on member leaves", () => {
    // If these ever diverge, off-chain paths would be built over the wrong
    // leaves and every gated vote would fail on-chain.
    for (const sk of members) {
      assert.deepEqual(memberLeaf(sk), pureCircuits.memberLeaf(sk));
    }
  });

  test("a path built off-chain recomputes to the published root", () => {
    const list = Allowlist.fromSecretKeys(members);
    for (let i = 0; i < members.length; i++) {
      assert.equal(pathRoot(list.pathForIndex(i)).field, list.root.field);
    }
  });

  test("a member votes in a gated poll with a real Merkle path", () => {
    const c = deploy();
    const list = Allowlist.fromSecretKeys(members);
    gatedPoll(c, list);
    c.call("vote", { secretKey: members[1], allowlistPath: list.pathForSecretKey(members[1]) }, POLL, 1n);
    assert.equal(c.state().totals.lookup(POLL), 1n);
  });

  test("every member of the allowlist can vote", () => {
    const c = deploy();
    const list = Allowlist.fromSecretKeys(members);
    gatedPoll(c, list);
    for (const sk of members) {
      c.call("vote", { secretKey: sk, allowlistPath: list.pathForSecretKey(sk) }, POLL, 0n);
    }
    assert.equal(c.state().totals.lookup(POLL), 3n);
  });

  test("an outsider with no path is turned away", () => {
    const c = deploy();
    gatedPoll(c, Allowlist.fromSecretKeys(members));
    assert.throws(
      () => c.call("vote", { secretKey: outsider, allowlistPath: emptyPath() }, POLL, 0n),
      /not on this poll's allowlist/,
    );
    assert.equal(c.state().totals.lookup(POLL), 0n);
  });

  test("an outsider cannot replay a member's published leaf", () => {
    // Member leaves are public, so a valid path is not a secret. Eligibility
    // binds the path's leaf to the voter's own key; without that bind this
    // vote would succeed and the allowlist would be worthless.
    const c = deploy();
    const list = Allowlist.fromSecretKeys(members);
    gatedPoll(c, list);
    const stolen = list.pathForSecretKey(members[0]);
    assert.equal(pathRoot(stolen).field, list.root.field, "the stolen path really does verify");
    assert.throws(
      () => c.call("vote", { secretKey: outsider, allowlistPath: stolen }, POLL, 0n),
      /not on this poll's allowlist/,
    );
    assert.equal(c.state().totals.lookup(POLL), 0n);
  });

  test("a path from a different allowlist does not verify", () => {
    const c = deploy();
    gatedPoll(c, Allowlist.fromSecretKeys(members));
    const other = Allowlist.fromSecretKeys([outsider]);
    assert.throws(
      () => c.call("vote", { secretKey: outsider, allowlistPath: other.pathForSecretKey(outsider) }, POLL, 0n),
      /not on this poll's allowlist/,
    );
  });

  test("the published root does not reveal the membership list", () => {
    const list = Allowlist.fromSecretKeys(members);
    const asText = list.root.field.toString(16);
    for (const sk of members) {
      assert.ok(!asText.includes(Buffer.from(memberLeaf(sk)).toString("hex").slice(0, 12)));
    }
  });

  // ── closing ───────────────────────────────────────────────────────────────

  test("only the organiser secret closes a poll", () => {
    const c = deploy();
    openPoll(c);
    assert.throws(
      () => c.call("closePoll", { organiserSecret: bytes32("wrong") }, POLL),
      /not the poll organiser/,
    );
    c.call("closePoll", { organiserSecret: ORGANISER }, POLL);
    assert.equal(c.state().polls.lookup(POLL).open, false);
  });

  test("a closed poll accepts no more ballots", () => {
    const c = deploy();
    openPoll(c);
    c.call("closePoll", { organiserSecret: ORGANISER }, POLL);
    assert.throws(
      () => c.call("vote", { secretKey: members[0], allowlistPath: emptyPath() }, POLL, 0n),
      /poll is closed/,
    );
  });

  test("closing preserves the tally", () => {
    const c = deploy();
    openPoll(c);
    c.call("vote", { secretKey: members[0], allowlistPath: emptyPath() }, POLL, 2n);
    c.call("closePoll", { organiserSecret: ORGANISER }, POLL);
    const s = c.state();
    assert.equal(s.totals.lookup(POLL), 1n);
    assert.equal(s.tallies.lookup(pureCircuits.tallyKey(POLL, 2n)), 1n);
  });

  // ── nullifier properties ──────────────────────────────────────────────────

  test("the nullifier is stable per key and poll, and hides the key", () => {
    const sk = randomBytes(32);
    const a = pureCircuits.voterNullifier(POLL, sk);
    const b = pureCircuits.voterNullifier(POLL, sk);
    const elsewhere = pureCircuits.voterNullifier(bytes32("poll:other"), sk);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, elsewhere);
    assert.notEqual(Buffer.from(a).toString("hex"), Buffer.from(sk).toString("hex"));
  });
});
