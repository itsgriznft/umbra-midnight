/**
 * In-browser reference implementation of {@link UmbraFactory}.
 *
 * It mirrors the rules of contracts/umbra_polls.compact so the whole Level 3
 * app is demoable with no wallet and no proof server:
 *   • a random 32-byte secret key per browser, standing in for the witness,
 *   • a poll-scoped nullifier enforcing ONE ballot per (key, poll),
 *   • a Merkle allowlist whose root is all the "contract" stores, with
 *     membership checked by recomputing the root from a path,
 *   • the path's leaf bound to the voter's own key, so a published member leaf
 *     cannot be replayed by an outsider.
 *
 * It is a faithful model of the RULES, not of the cryptography: hashing here is
 * SHA-256 via WebCrypto, where the contract uses Compact's persistent/transient
 * hashes. The real thing lives in src/allowlist.mjs, which is pinned to the
 * compiled circuit by test/circuit.test.mjs, and is what the Lace controller
 * uses on Preprod.
 *
 * State is persisted in localStorage per contract address, so a refresh — or a
 * second tab — sees the same polls.
 */
import {
  ALLOWLIST_DEPTH,
  MAX_OPTIONS,
  MIN_OPTIONS,
  type FactoryState,
  type NewPoll,
  type PollSummary,
  type UmbraFactory,
  type UmbraMode,
} from "./factory-types";

type StoredPoll = {
  id: string;
  question: string;
  options: string[];
  tallies: number[];
  totalVotes: number;
  gated: boolean;
  /** Root of the member tree; "" when the poll is open. */
  allowRoot: string;
  /** Member leaves, kept so the demo can build a voter's path locally. */
  members: string[];
  open: boolean;
  closeAuth: string;
};

type Stored = { polls: StoredPoll[] };

const SK_KEY = "umbra:sk";
const ORG_KEY = "umbra:organiser";
const storeKey = (address: string) => `umbra:factory:${address}`;

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const randomHex = (n: number) => {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return toHex(b);
};

async function sha256Hex(...parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join("|"));
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
}

const ZERO = "00".repeat(32);

// ── the allowlist, modelled exactly as the contract treats it ────────────────

const memberLeaf = (secretKey: string) => sha256Hex("umbra:member:v2", secretKey);
const nodeHash = (left: string, right: string) => sha256Hex("umbra:node", left, right);
const voterNullifier = (pollId: string, sk: string) => sha256Hex("umbra:nullifier:v2", pollId, sk);
const organiserAuth = (secret: string) => sha256Hex("umbra:organiser:v2", secret);

type PathEntry = { sibling: string; goesLeft: boolean };

/** Build the full tree over `leaves`, padded to 2^depth with a zero leaf. */
async function buildLevels(leaves: string[]): Promise<string[][]> {
  const width = 2 ** ALLOWLIST_DEPTH;
  const level0 = [...leaves];
  while (level0.length < width) level0.push(ZERO);
  const levels = [level0];
  for (let d = 0; d < ALLOWLIST_DEPTH; d++) {
    const below = levels[d];
    const up: string[] = [];
    for (let i = 0; i < below.length; i += 2) up.push(await nodeHash(below[i], below[i + 1]));
    levels.push(up);
  }
  return levels;
}

async function allowlistRoot(leaves: string[]): Promise<string> {
  return (await buildLevels(leaves))[ALLOWLIST_DEPTH][0];
}

async function pathFor(leaves: string[], index: number): Promise<{ leaf: string; path: PathEntry[] }> {
  const levels = await buildLevels(leaves);
  const path: PathEntry[] = [];
  let i = index;
  for (let d = 0; d < ALLOWLIST_DEPTH; d++) {
    const goesLeft = i % 2 === 0;
    path.push({ sibling: levels[d][goesLeft ? i + 1 : i - 1], goesLeft });
    i = Math.floor(i / 2);
  }
  return { leaf: levels[0][index], path };
}

/** The fold the circuit performs — recompute the root from a leaf + siblings. */
async function pathRoot(proof: { leaf: string; path: PathEntry[] }): Promise<string> {
  let acc = proof.leaf;
  for (const { sibling, goesLeft } of proof.path) {
    acc = goesLeft ? await nodeHash(acc, sibling) : await nodeHash(sibling, acc);
  }
  return acc;
}

// ── controller ───────────────────────────────────────────────────────────────

export class MockFactory implements UmbraFactory {
  readonly mode: UmbraMode = "mock";
  #listeners = new Set<(s: FactoryState) => void>();
  #secretKey: string;
  #organiserSecret: string;
  #memberLeaf = "";
  /** Local-only record of this voter's picks, for UI feedback. */
  #choices = new Map<string, number>();

  #state: FactoryState = {
    polls: [],
    selectedId: null,
    contractAddress: null,
    connected: false,
    busy: false,
    mode: "mock",
    memberLeaf: "",
  };

  constructor() {
    this.#secretKey = localStorage.getItem(SK_KEY) ?? randomHex(32);
    localStorage.setItem(SK_KEY, this.#secretKey);
    this.#organiserSecret = localStorage.getItem(ORG_KEY) ?? randomHex(32);
    localStorage.setItem(ORG_KEY, this.#organiserSecret);
  }

  getState(): FactoryState {
    return this.#state;
  }

  subscribe(listener: (s: FactoryState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  #set(patch: Partial<FactoryState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const l of this.#listeners) l(this.#state);
  }

  #load(address: string): Stored {
    const raw = localStorage.getItem(storeKey(address));
    return raw ? (JSON.parse(raw) as Stored) : { polls: [] };
  }

  #save(address: string, s: Stored): void {
    localStorage.setItem(storeKey(address), JSON.stringify(s));
  }

  /** Project stored polls into the view model, resolving per-voter facts. */
  async #refresh(address: string, select?: string | null): Promise<void> {
    const stored = this.#load(address);
    const auth = await organiserAuth(this.#organiserSecret);
    const summaries: PollSummary[] = [];
    for (const p of stored.polls) {
      const tag = await voterNullifier(p.id, this.#secretKey);
      summaries.push({
        id: p.id,
        question: p.question,
        options: p.options,
        tallies: p.tallies,
        totalVotes: p.totalVotes,
        gated: p.gated,
        open: p.open,
        hasVoted: (p as StoredPoll & { nullifiers?: string[] }).nullifiers?.includes(tag) ?? false,
        eligible: !p.gated || p.members.includes(this.#memberLeaf),
        myChoice: this.#choices.get(p.id) ?? null,
        canClose: p.closeAuth === auth,
      });
    }
    this.#set({
      polls: summaries,
      contractAddress: address,
      selectedId: select !== undefined ? select : (this.#state.selectedId ?? summaries[0]?.id ?? null),
    });
  }

  async connect(): Promise<void> {
    this.#memberLeaf = await memberLeaf(this.#secretKey);
    this.#set({ connected: true, memberLeaf: this.#memberLeaf });
  }

  async deploy(): Promise<string> {
    this.#set({ busy: true });
    try {
      await new Promise((r) => setTimeout(r, 400)); // pretend to submit a tx
      const address = "0x" + randomHex(20);
      this.#save(address, { polls: [] });
      await this.#refresh(address, null);
      return address;
    } finally {
      this.#set({ busy: false });
    }
  }

  async join(address: string): Promise<void> {
    if (!localStorage.getItem(storeKey(address))) {
      throw new Error("No Umbra factory found at that address (in this browser)");
    }
    await this.#refresh(address, null);
  }

  async createPoll({ question, options, allowlist }: NewPoll): Promise<string> {
    const { contractAddress } = this.#state;
    if (!contractAddress) throw new Error("Deploy or join a factory first");
    const q = question.trim();
    if (!q) throw new Error("A poll needs a question");
    const opts = options.map((o) => o.trim()).filter(Boolean).slice(0, MAX_OPTIONS);
    if (opts.length < MIN_OPTIONS) throw new Error("Umbra: a poll needs at least two options");

    const members = [...new Set((allowlist ?? []).map((m) => m.trim().toLowerCase()).filter(Boolean))];
    const gated = members.length > 0;
    if (gated && members.some((m) => !/^[0-9a-f]{64}$/.test(m))) {
      throw new Error("Every allowlist entry must be a 64-character hex member leaf");
    }

    this.#set({ busy: true });
    try {
      await new Promise((r) => setTimeout(r, 500)); // pretend to prove + submit
      const stored = this.#load(contractAddress);
      const id = randomHex(32);
      stored.polls.unshift({
        id,
        question: q,
        options: opts,
        tallies: opts.map(() => 0),
        totalVotes: 0,
        gated,
        allowRoot: gated ? await allowlistRoot(members) : "",
        members,
        open: true,
        closeAuth: await organiserAuth(this.#organiserSecret),
      });
      this.#save(contractAddress, stored);
      await this.#refresh(contractAddress, id);
      return id;
    } finally {
      this.#set({ busy: false });
    }
  }

  async vote(pollId: string, option: number): Promise<void> {
    const { contractAddress } = this.#state;
    if (!contractAddress) throw new Error("Deploy or join a factory first");
    const stored = this.#load(contractAddress);
    const poll = stored.polls.find((p) => p.id === pollId) as
      | (StoredPoll & { nullifiers?: string[] })
      | undefined;
    if (!poll) throw new Error("Umbra: no such poll");
    if (!poll.open) throw new Error("Umbra: poll is closed");
    if (option < 0 || option >= poll.options.length) throw new Error("Umbra: option out of range");

    // Eligibility, exactly as the circuit checks it: recompute the root from a
    // path whose leaf must be THIS voter's leaf.
    if (poll.gated) {
      const index = poll.members.indexOf(this.#memberLeaf);
      const proof = index >= 0 ? await pathFor(poll.members, index) : null;
      const ok = proof !== null && proof.leaf === this.#memberLeaf && (await pathRoot(proof)) === poll.allowRoot;
      if (!ok) throw new Error("Umbra: not on this poll's allowlist");
    }

    const tag = await voterNullifier(pollId, this.#secretKey);
    poll.nullifiers ??= [];
    if (poll.nullifiers.includes(tag)) throw new Error("Umbra: this voter has already voted");

    this.#set({ busy: true });
    try {
      await new Promise((r) => setTimeout(r, 500)); // pretend to prove + submit
      poll.nullifiers.push(tag);
      poll.tallies[option] += 1;
      poll.totalVotes += 1;
      this.#choices.set(pollId, option);
      this.#save(contractAddress, stored);
      await this.#refresh(contractAddress);
    } finally {
      this.#set({ busy: false });
    }
  }

  async closePoll(pollId: string): Promise<void> {
    const { contractAddress } = this.#state;
    if (!contractAddress) throw new Error("Deploy or join a factory first");
    const stored = this.#load(contractAddress);
    const poll = stored.polls.find((p) => p.id === pollId);
    if (!poll) throw new Error("Umbra: no such poll");
    if (!poll.open) throw new Error("Umbra: poll is already closed");
    if (poll.closeAuth !== (await organiserAuth(this.#organiserSecret))) {
      throw new Error("Umbra: not the poll organiser");
    }
    poll.open = false;
    this.#save(contractAddress, stored);
    await this.#refresh(contractAddress);
  }

  select(pollId: string | null): void {
    this.#set({ selectedId: pollId });
  }
}
