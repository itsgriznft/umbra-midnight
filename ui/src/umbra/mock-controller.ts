/**
 * In-browser reference implementation of {@link UmbraController}.
 *
 * It mirrors the on-chain rules of contracts/umbra.compact so the UI is fully
 * demoable without a wallet or proof server:
 *   • a random 32-byte "secret key" is generated per browser (like the witness),
 *   • a nullifier derived from it enforces ONE ballot per key,
 *   • per-option tallies + a total are kept as the public state.
 *
 * Poll state is persisted in localStorage keyed by contract address so a refresh
 * (or a second tab) keeps the same poll.
 */
import { MAX_OPTIONS, type PollState, type UmbraController, type UmbraMode } from "./types";

type Persisted = {
  question: string;
  options: string[];
  tallies: number[];
  totalVotes: number;
  nullifiers: string[];
};

const SK_KEY = "umbra:sk";
const pollKey = (address: string) => `umbra:poll:${address}`;

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const randomHex = (n: number) => {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return toHex(b);
};

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

export class MockController implements UmbraController {
  readonly mode: UmbraMode = "mock";
  #listeners = new Set<(s: PollState) => void>();
  #secretKey: string;
  #nullifier = "";
  #state: PollState = {
    question: "Which lunar phase should Umbra ship on?",
    options: ["New Moon", "First Quarter", "Full Moon", "Supermoon"],
    tallies: [0, 0, 0, 0],
    totalVotes: 0,
    hasVoted: false,
    myChoice: null,
    contractAddress: null,
    connected: false,
    busy: false,
    mode: "mock",
  };

  constructor() {
    this.#secretKey = localStorage.getItem(SK_KEY) ?? randomHex(32);
    localStorage.setItem(SK_KEY, this.#secretKey);
  }

  getState(): PollState {
    return this.#state;
  }

  subscribe(listener: (s: PollState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  #set(patch: Partial<PollState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const l of this.#listeners) l(this.#state);
  }

  #load(address: string): Persisted | null {
    const raw = localStorage.getItem(pollKey(address));
    return raw ? (JSON.parse(raw) as Persisted) : null;
  }

  #save(address: string, p: Persisted): void {
    localStorage.setItem(pollKey(address), JSON.stringify(p));
  }

  #applyPersisted(address: string, p: Persisted): void {
    const voted = p.nullifiers.includes(this.#nullifier);
    this.#set({
      question: p.question,
      options: p.options,
      tallies: p.tallies,
      totalVotes: p.totalVotes,
      hasVoted: voted,
      myChoice: null,
      contractAddress: address,
    });
  }

  async connect(): Promise<void> {
    this.#nullifier = await sha256Hex("umbra:nullifier:v1" + this.#secretKey);
    this.#set({ connected: true });
  }

  async deploy(question: string, options: string[]): Promise<string> {
    const opts = options.map((o) => o.trim()).filter(Boolean).slice(0, MAX_OPTIONS);
    if (opts.length < 2) throw new Error("A poll needs at least two options");
    if (!question.trim()) throw new Error("A poll needs a question");
    this.#set({ busy: true });
    await new Promise((r) => setTimeout(r, 400)); // pretend to submit a tx
    const address = "0x" + randomHex(20);
    const persisted: Persisted = {
      question: question.trim(),
      options: opts,
      tallies: opts.map(() => 0),
      totalVotes: 0,
      nullifiers: [],
    };
    this.#save(address, persisted);
    this.#applyPersisted(address, persisted);
    this.#set({ busy: false });
    return address;
  }

  async join(address: string): Promise<void> {
    const p = this.#load(address);
    if (!p) throw new Error("No poll found at that address (in this browser)");
    this.#applyPersisted(address, p);
  }

  async vote(option: number): Promise<void> {
    const { contractAddress } = this.#state;
    if (!contractAddress) throw new Error("Deploy or join a poll first");
    const p = this.#load(contractAddress);
    if (!p) throw new Error("Poll state missing");
    if (option < 0 || option >= p.options.length) throw new Error("Umbra: option out of range");
    if (p.nullifiers.includes(this.#nullifier)) throw new Error("Umbra: this voter has already voted");

    this.#set({ busy: true });
    await new Promise((r) => setTimeout(r, 500)); // pretend to prove + submit
    p.nullifiers.push(this.#nullifier);
    p.tallies[option] += 1;
    p.totalVotes += 1;
    this.#save(contractAddress, p);
    this.#set({
      tallies: p.tallies,
      totalVotes: p.totalVotes,
      hasVoted: true,
      myChoice: option,
      busy: false,
    });
  }
}
