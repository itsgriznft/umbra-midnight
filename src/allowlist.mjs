/**
 * Umbra allowlist — the organiser's side of gated polls (Level 3).
 *
 * A gated poll stores only the ROOT of a Merkle tree of member leaves. Voters
 * prove membership with a path supplied as a private witness, so the ballot
 * never reveals which member cast it. This module builds that tree off-chain
 * and hands out the witness paths.
 *
 * The hashing here is not a re-implementation: it is the same sequence the
 * generated circuit runs for `merkleTreePathRoot`, using the primitives the
 * Compact runtime exports —
 *   leaf   : degradeToTransient(persistentHash({domain_sep: "mdn:lh", data}))
 *   parent : transientHash([left, right])
 * test/circuit.test.mjs pins this down by running the compiled `vote` circuit
 * against paths produced here.
 *
 * Because the contract stores only the root (it never builds a tree itself),
 * the padding convention for unused leaves is ours to define; it just has to
 * be consistent between the root and the paths, which it is.
 */
import {
  CompactTypeBytes,
  CompactTypeField,
  CompactTypeVector,
  persistentHash,
  transientHash,
  degradeToTransient,
} from "@midnight-ntwrk/compact-runtime";

/** Tree depth baked into contracts/umbra_polls.compact — up to 1024 members. */
export const ALLOWLIST_DEPTH = 10;
export const MAX_MEMBERS = 2 ** ALLOWLIST_DEPTH;

const BYTES_32 = new CompactTypeBytes(32);
const BYTES_6 = new CompactTypeBytes(6);
const FIELD_PAIR = new CompactTypeVector(2, CompactTypeField);

/** The Compact standard library's leaf-hash domain separator, "mdn:lh". */
const LEAF_DOMAIN = new Uint8Array([109, 100, 110, 58, 108, 104]);

/** `struct LeafPreimage { domain_sep: Bytes<6>; data: Bytes<32> }` */
const LEAF_PREIMAGE = {
  alignment: () => BYTES_6.alignment().concat(BYTES_32.alignment()),
  toValue: (v) => BYTES_6.toValue(v.domain_sep).concat(BYTES_32.toValue(v.data)),
  fromValue: (v) => ({ domain_sep: BYTES_6.fromValue(v), data: BYTES_32.fromValue(v) }),
};

const bytes32 = (label) => {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(label).subarray(0, 32));
  return out;
};

/** Mirrors the contract's `memberLeaf(sk)` — the leaf a member occupies. */
export function memberLeaf(secretKey) {
  assertBytes32(secretKey, "secretKey");
  const pair = new CompactTypeVector(2, BYTES_32);
  return persistentHash(pair, [bytes32("umbra:member:v2"), secretKey]);
}

/** Hash a 32-byte leaf into the field element the tree stores. */
const hashLeaf = (leaf) =>
  degradeToTransient(persistentHash(LEAF_PREIMAGE, { domain_sep: LEAF_DOMAIN, data: leaf }));

const hashPair = (left, right) => transientHash(FIELD_PAIR, [left, right]);

function assertBytes32(value, name) {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new TypeError(`${name} must be a 32-byte Uint8Array`);
  }
}

/**
 * A member allowlist for one poll.
 *
 * ```js
 * const list = Allowlist.fromSecretKeys([skA, skB]);
 * createPoll(id, question, 2, true, list.root, closeAuth);   // organiser
 * const path = list.pathForSecretKey(skA);                   // voter's witness
 * ```
 */
export class Allowlist {
  /**
   * @param {Uint8Array[]} leaves member leaves, as returned by `memberLeaf`
   */
  constructor(leaves) {
    if (leaves.length === 0) throw new Error("Umbra: an allowlist needs at least one member");
    if (leaves.length > MAX_MEMBERS) {
      throw new Error(`Umbra: at most ${MAX_MEMBERS} members fit in a depth-${ALLOWLIST_DEPTH} tree`);
    }
    leaves.forEach((leaf, i) => assertBytes32(leaf, `leaf ${i}`));

    this.leaves = [...leaves];
    this.#index = new Map(this.leaves.map((leaf, i) => [hex(leaf), i]));

    // Level 0 holds the hashed leaves, padded to a full tree with a zero leaf.
    const width = 2 ** ALLOWLIST_DEPTH;
    const padding = hashLeaf(new Uint8Array(32));
    const level0 = this.leaves.map(hashLeaf);
    while (level0.length < width) level0.push(padding);

    this.levels = [level0];
    for (let d = 0; d < ALLOWLIST_DEPTH; d++) {
      const below = this.levels[d];
      const up = [];
      for (let i = 0; i < below.length; i += 2) up.push(hashPair(below[i], below[i + 1]));
      this.levels.push(up);
    }
  }

  #index;

  /** Build the tree straight from member secret keys (test/demo convenience). */
  static fromSecretKeys(secretKeys) {
    return new Allowlist(secretKeys.map(memberLeaf));
  }

  /** The `MerkleTreeDigest` to publish when creating the poll. */
  get root() {
    return { field: this.levels[ALLOWLIST_DEPTH][0] };
  }

  get size() {
    return this.leaves.length;
  }

  has(leaf) {
    return this.#index.has(hex(leaf));
  }

  /** The membership path for the member at `index`, shaped as the witness. */
  pathForIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.leaves.length) {
      throw new RangeError(`Umbra: no member at index ${index}`);
    }
    const path = [];
    let i = index;
    for (let d = 0; d < ALLOWLIST_DEPTH; d++) {
      const goesLeft = i % 2 === 0;
      path.push({
        sibling: { field: this.levels[d][goesLeft ? i + 1 : i - 1] },
        goes_left: goesLeft,
      });
      i = Math.floor(i / 2);
    }
    return { leaf: this.leaves[index], path };
  }

  /** The membership path for a given leaf. */
  pathForLeaf(leaf) {
    const index = this.#index.get(hex(leaf));
    if (index === undefined) throw new Error("Umbra: that leaf is not on this allowlist");
    return this.pathForIndex(index);
  }

  /** The membership path a voter proves with, from their own secret key. */
  pathForSecretKey(secretKey) {
    return this.pathForLeaf(memberLeaf(secretKey));
  }
}

/**
 * A path that verifies against nothing — what a voter supplies for an OPEN
 * poll, where the contract ignores eligibility entirely.
 */
export function emptyPath() {
  return {
    leaf: new Uint8Array(32),
    path: Array.from({ length: ALLOWLIST_DEPTH }, () => ({
      sibling: { field: 0n },
      goes_left: true,
    })),
  };
}

/** Recompute a path's root — the same fold the circuit performs. */
export function pathRoot({ leaf, path }) {
  return {
    field: path.reduce(
      (acc, entry) =>
        entry.goes_left ? hashPair(acc, entry.sibling.field) : hashPair(entry.sibling.field, acc),
      hashLeaf(leaf),
    ),
  };
}

const hex = (bytes) => Buffer.from(bytes).toString("hex");

/** The `closeAuth` digest to publish so `organiserSecret` can close the poll. */
export function organiserAuth(secret) {
  assertBytes32(secret, "secret");
  const pair = new CompactTypeVector(2, BYTES_32);
  return persistentHash(pair, [bytes32("umbra:organiser:v2"), secret]);
}

export { bytes32 };
