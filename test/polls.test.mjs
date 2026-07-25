// Reference model of contracts/umbra_polls.compact (Level 3 — the poll factory
// with Merkle-allowlist eligibility), tested with node:test.
//
// Like test/logic.test.mjs this is an off-chain model, not the ZK circuit: it
// stands in sha256 for Compact's `persistentHash` and mirrors the *rules* so
// they are pinned down independently of the compiler. The rules under test:
//   • polls are unique, and an option count outside 2..8 is rejected
//   • a ballot is one-per-(key, poll): the same key votes in every poll, once
//   • a gated poll admits only members, proven by a Merkle path
//   • the path's leaf must be the voter's OWN leaf — replaying another
//     member's published leaf must not pass
//   • only the organiser secret behind `closeAuth` can close a poll
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const DEPTH = 10;
const h = (...parts) => createHash("sha256").update(parts.join("|")).digest("hex");
const ZERO = "00".repeat(32);

// ── Merkle tree over member leaves (mirrors the organiser's off-chain build) ──

/** Hash of an internal node. Mirrors the tree the Compact stdlib walks. */
const node = (left, right) => h("umbra:node", left, right);

class Allowlist {
  constructor(leaves) {
    this.leaves = [...leaves];
    // Level 0 is the leaves, padded out to 2^DEPTH with a zero leaf.
    this.levels = [];
    let level = [...leaves];
    const width = 2 ** DEPTH;
    while (level.length < width) level.push(ZERO);
    this.levels.push(level);
    for (let d = 0; d < DEPTH; d++) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) next.push(node(level[i], level[i + 1]));
      this.levels.push(next);
      level = next;
    }
  }

  get root() {
    return this.levels[DEPTH][0];
  }

  /** The sibling chain proving `index` is in the tree. */
  pathFor(index) {
    const path = [];
    let i = index;
    for (let d = 0; d < DEPTH; d++) {
      const goesLeft = i % 2 === 0;
      path.push({ sibling: this.levels[d][goesLeft ? i + 1 : i - 1], goesLeft });
      i = Math.floor(i / 2);
    }
    return { leaf: this.levels[0][index], path };
  }
}

/** Mirrors `merkleTreePathRoot` — recompute the root from a leaf + siblings. */
function pathRoot({ leaf, path }) {
  return path.reduce(
    (acc, { sibling, goesLeft }) => (goesLeft ? node(acc, sibling) : node(sibling, acc)),
    leaf,
  );
}

// ── Contract model ───────────────────────────────────────────────────────────

const memberLeaf = (sk) => h("umbra:member:v2", sk);
const voterNullifier = (pollId, sk) => h("umbra:nullifier:v2", pollId, sk);
const tallyKey = (pollId, option) => h("umbra:tally:v2", pollId, option);
const organiserAuth = (secret) => h("umbra:organiser:v2", secret);

class UmbraPolls {
  constructor() {
    this.polls = new Map();
    this.pollIds = [];
    this.pollCount = 0n;
    this.tallies = new Map();
    this.totals = new Map();
    this.nullifiers = new Set();
  }

  createPoll(pollId, question, optionCount, { gated = false, allowRoot = ZERO, closeAuth = ZERO } = {}) {
    if (this.polls.has(pollId)) throw new Error("Umbra: poll already exists");
    if (optionCount < 2) throw new Error("Umbra: a poll needs at least two options");
    if (optionCount > 8) throw new Error("Umbra: at most eight options per poll");
    this.polls.set(pollId, { question, optionCount, gated, allowRoot, closeAuth, open: true });
    this.pollIds.unshift(pollId);
    this.pollCount += 1n;
    this.totals.set(pollId, 0n);
  }

  /** `path` is the private witness; for an open poll it is ignored. */
  vote(pollId, option, secretKey, path) {
    const poll = this.polls.get(pollId);
    if (!poll) throw new Error("Umbra: no such poll");
    if (!poll.open) throw new Error("Umbra: poll is closed");
    if (option < 0 || option >= poll.optionCount) throw new Error("Umbra: option out of range");

    const ownLeaf = path !== undefined && path.leaf === memberLeaf(secretKey);
    const eligible = !poll.gated || (ownLeaf && pathRoot(path) === poll.allowRoot);
    if (!eligible) throw new Error("Umbra: not on this poll's allowlist");

    const tag = voterNullifier(pollId, secretKey);
    if (this.nullifiers.has(tag)) throw new Error("Umbra: this voter has already voted");
    this.nullifiers.add(tag);

    const key = tallyKey(pollId, option);
    this.tallies.set(key, (this.tallies.get(key) ?? 0n) + 1n);
    this.totals.set(pollId, this.totals.get(pollId) + 1n);
  }

  closePoll(pollId, organiserSecret) {
    const poll = this.polls.get(pollId);
    if (!poll) throw new Error("Umbra: no such poll");
    if (!poll.open) throw new Error("Umbra: poll is already closed");
    if (organiserAuth(organiserSecret) !== poll.closeAuth) throw new Error("Umbra: not the poll organiser");
    poll.open = false;
  }

  tally(pollId, option) {
    return this.tallies.get(tallyKey(pollId, option)) ?? 0n;
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const POLL_A = "aa".repeat(32);
const POLL_B = "bb".repeat(32);
const members = ["01", "02", "03"].map((b) => b.repeat(32));
const outsider = "99".repeat(32);

const gatedPoll = () => {
  const tree = new Allowlist(members.map(memberLeaf));
  const contract = new UmbraPolls();
  contract.createPoll(POLL_A, "Ship on the full moon?", 2, {
    gated: true,
    allowRoot: tree.root,
    closeAuth: organiserAuth("organiser-secret"),
  });
  return { contract, tree };
};

// ── The factory ──────────────────────────────────────────────────────────────

test("polls are independent and enumerable", () => {
  const c = new UmbraPolls();
  c.createPoll(POLL_A, "First?", 3);
  c.createPoll(POLL_B, "Second?", 2);
  assert.equal(c.pollCount, 2n);
  assert.deepEqual(c.pollIds, [POLL_B, POLL_A]);
});

test("a duplicate poll id is rejected", () => {
  const c = new UmbraPolls();
  c.createPoll(POLL_A, "First?", 2);
  assert.throws(() => c.createPoll(POLL_A, "Again?", 2), /already exists/);
});

test("option count must be between two and eight", () => {
  const c = new UmbraPolls();
  assert.throws(() => c.createPoll(POLL_A, "Only one?", 1), /at least two options/);
  assert.throws(() => c.createPoll(POLL_A, "Too many?", 9), /at most eight options/);
});

test("an out-of-range option is rejected", () => {
  const c = new UmbraPolls();
  c.createPoll(POLL_A, "Two choices", 2);
  assert.throws(() => c.vote(POLL_A, 2, members[0]), /out of range/);
  assert.equal(c.totals.get(POLL_A), 0n);
});

// ── One ballot per key per poll ──────────────────────────────────────────────

test("a key votes once per poll but in every poll", () => {
  const c = new UmbraPolls();
  c.createPoll(POLL_A, "First?", 2);
  c.createPoll(POLL_B, "Second?", 2);

  c.vote(POLL_A, 0, members[0]);
  assert.throws(() => c.vote(POLL_A, 1, members[0]), /already voted/);

  // The nullifier is domain-separated by poll, so the same key is free here.
  c.vote(POLL_B, 1, members[0]);
  assert.equal(c.tally(POLL_A, 0), 1n);
  assert.equal(c.tally(POLL_B, 1), 1n);
});

test("tallies and totals track every ballot", () => {
  const c = new UmbraPolls();
  c.createPoll(POLL_A, "Which phase?", 4);
  c.vote(POLL_A, 2, members[0]);
  c.vote(POLL_A, 2, members[1]);
  c.vote(POLL_A, 0, members[2]);
  assert.equal(c.tally(POLL_A, 2), 2n);
  assert.equal(c.tally(POLL_A, 0), 1n);
  assert.equal(c.tally(POLL_A, 1), 0n);
  assert.equal(c.totals.get(POLL_A), 3n);
});

// ── Merkle allowlist eligibility ─────────────────────────────────────────────

test("a member proves eligibility with a Merkle path", () => {
  const { contract, tree } = gatedPoll();
  contract.vote(POLL_A, 1, members[1], tree.pathFor(1));
  assert.equal(contract.tally(POLL_A, 1), 1n);
});

test("every member of the tree can vote", () => {
  const { contract, tree } = gatedPoll();
  members.forEach((sk, i) => contract.vote(POLL_A, 0, sk, tree.pathFor(i)));
  assert.equal(contract.totals.get(POLL_A), 3n);
});

test("an outsider with no path is turned away", () => {
  const { contract } = gatedPoll();
  assert.throws(() => contract.vote(POLL_A, 0, outsider, undefined), /not on this poll's allowlist/);
  assert.equal(contract.totals.get(POLL_A), 0n);
});

test("an outsider cannot replay a member's published leaf", () => {
  // Member leaves are public — the organiser publishes them to build the tree.
  // Eligibility must therefore bind the path's leaf to the voter's OWN key,
  // or a valid path plus someone else's leaf would admit anyone.
  const { contract, tree } = gatedPoll();
  const stolen = tree.pathFor(0); // a genuine, verifying path for members[0]
  assert.equal(pathRoot(stolen), contract.polls.get(POLL_A).allowRoot);
  assert.throws(() => contract.vote(POLL_A, 0, outsider, stolen), /not on this poll's allowlist/);
  assert.equal(contract.totals.get(POLL_A), 0n);
});

test("a path from a different tree does not verify", () => {
  const { contract } = gatedPoll();
  const other = new Allowlist([outsider].map(memberLeaf));
  assert.throws(() => contract.vote(POLL_A, 0, outsider, other.pathFor(0)), /not on this poll's allowlist/);
});

test("an open poll needs no path at all", () => {
  const c = new UmbraPolls();
  c.createPoll(POLL_B, "Anyone may vote", 2);
  c.vote(POLL_B, 0, outsider);
  assert.equal(c.tally(POLL_B, 0), 1n);
});

test("the allowlist root hides the membership list", () => {
  const tree = new Allowlist(members.map(memberLeaf));
  assert.equal(tree.root.length, 64);
  for (const sk of members) assert.doesNotMatch(tree.root, new RegExp(sk.slice(0, 16)));
});

// ── Closing a poll ───────────────────────────────────────────────────────────

test("only the organiser secret closes a poll", () => {
  const { contract } = gatedPoll();
  assert.throws(() => contract.closePoll(POLL_A, "wrong-secret"), /not the poll organiser/);
  contract.closePoll(POLL_A, "organiser-secret");
  assert.equal(contract.polls.get(POLL_A).open, false);
});

test("a closed poll accepts no more ballots", () => {
  const { contract, tree } = gatedPoll();
  contract.closePoll(POLL_A, "organiser-secret");
  assert.throws(() => contract.vote(POLL_A, 0, members[0], tree.pathFor(0)), /poll is closed/);
});

test("closing twice is rejected", () => {
  const { contract } = gatedPoll();
  contract.closePoll(POLL_A, "organiser-secret");
  assert.throws(() => contract.closePoll(POLL_A, "organiser-secret"), /already closed/);
});

test("voting in a poll that does not exist is rejected", () => {
  const c = new UmbraPolls();
  assert.throws(() => c.vote(POLL_A, 0, members[0]), /no such poll/);
});
