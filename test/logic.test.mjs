// Pure-TS/JS model of the Umbra contract semantics, tested with the built-in
// node:test runner (no dependencies). This mirrors the on-chain rules so we can
// lock the intended behaviour before/around compiling the Compact source:
//   • one ballot per secret key (nullifier), voter stays anonymous
//   • option must be in range
//   • tallies + totalVotes update correctly
//
// It is intentionally an off-chain reference model, not the real ZK circuit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

/** Reference model matching contracts/umbra.compact. */
class UmbraModel {
  constructor(question, optionCount) {
    if (optionCount < 1 || optionCount > 4) throw new Error("optionCount must be 1..4");
    this.question = question;
    this.optionCount = optionCount;
    this.tallies = [0n, 0n, 0n, 0n];
    this.totalVotes = 0n;
    this.nullifiers = new Set();
  }

  // Mirrors `voterNullifier(sk)` — deterministic, stable per key, hides the key.
  nullifier(secretKeyHex) {
    return createHash("sha256").update("umbra:nullifier:v1" + secretKeyHex).digest("hex");
  }

  vote(secretKeyHex, option) {
    if (option < 0 || option >= this.optionCount) throw new Error("Umbra: option out of range");
    const tag = this.nullifier(secretKeyHex);
    if (this.nullifiers.has(tag)) throw new Error("Umbra: this voter has already voted");
    this.nullifiers.add(tag);
    this.tallies[option] += 1n;
    this.totalVotes += 1n;
  }
}

test("a valid ballot updates the tally and total", () => {
  const poll = new UmbraModel("Best moon phase?", 4);
  poll.vote("aa".repeat(32), 2);
  assert.equal(poll.tallies[2], 1n);
  assert.equal(poll.totalVotes, 1n);
});

test("the same secret key cannot vote twice", () => {
  const poll = new UmbraModel("Ship it?", 2);
  poll.vote("11".repeat(32), 0);
  assert.throws(() => poll.vote("11".repeat(32), 1), /already voted/);
  assert.equal(poll.totalVotes, 1n);
});

test("different keys can each vote for the same option", () => {
  const poll = new UmbraModel("Deploy to mainnet?", 2);
  poll.vote("01".repeat(32), 0);
  poll.vote("02".repeat(32), 0);
  assert.equal(poll.tallies[0], 2n);
  assert.equal(poll.totalVotes, 2n);
});

test("an out-of-range option is rejected", () => {
  const poll = new UmbraModel("Two choices only", 2);
  assert.throws(() => poll.vote("ff".repeat(32), 3), /out of range/);
  assert.equal(poll.totalVotes, 0n);
});

test("nullifier hides the key but is stable per key", () => {
  const poll = new UmbraModel("x", 1);
  const a = poll.nullifier("ab".repeat(32));
  const b = poll.nullifier("ab".repeat(32));
  const c = poll.nullifier("cd".repeat(32));
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.doesNotMatch(a, /abababab/); // the raw key does not leak into the tag
});
