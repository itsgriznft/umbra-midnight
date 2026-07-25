/**
 * The Level 3 controller seam — one contract, many polls.
 *
 * Level 2's {@link ./types.ts UmbraController} drove a single fixed poll. The
 * Level 3 contract (contracts/umbra_polls.compact) is a factory: polls are
 * created inside one deployed contract, each one optionally gated by a Merkle
 * allowlist. The UI depends only on this interface, so the in-browser demo and
 * the real Preprod wiring stay interchangeable.
 */

export type UmbraMode = "mock" | "lace";

/** Upper bound baked into the contract (`optionCount <= 8`). */
export const MAX_OPTIONS = 8;
/** Lower bound baked into the contract (`optionCount >= 2`). */
export const MIN_OPTIONS = 2;
/** Depth of the allowlist tree — 2^10 members. */
export const ALLOWLIST_DEPTH = 10;

export type PollSummary = {
  /** 32-byte poll id, hex encoded. */
  readonly id: string;
  readonly question: string;
  /** Option labels. The contract tallies by index. */
  readonly options: readonly string[];
  /** Public per-option counts. */
  readonly tallies: readonly number[];
  readonly totalVotes: number;
  /** Gated polls admit only members of the published allowlist. */
  readonly gated: boolean;
  readonly open: boolean;
  /** Whether this browser's voter has already cast a ballot here. */
  readonly hasVoted: boolean;
  /** Whether this voter can vote: open poll, or on the allowlist. */
  readonly eligible: boolean;
  /** The option this voter picked, or null. Local only — never on-chain. */
  readonly myChoice: number | null;
  /** Whether this browser holds the organiser secret that can close it. */
  readonly canClose: boolean;
};

export type FactoryState = {
  readonly polls: readonly PollSummary[];
  readonly selectedId: string | null;
  /** Address of the deployed factory contract, or null before deploy/join. */
  readonly contractAddress: string | null;
  readonly connected: boolean;
  readonly busy: boolean;
  readonly mode: UmbraMode;
  /**
   * This voter's member leaf, hex encoded. It is public and derived from the
   * secret key — an organiser adds it to an allowlist to grant eligibility.
   * The key itself never leaves the device.
   */
  readonly memberLeaf: string;
};

export type NewPoll = {
  readonly question: string;
  readonly options: readonly string[];
  /** Member leaves (hex) to gate on. Empty or absent means an open poll. */
  readonly allowlist?: readonly string[];
};

export interface UmbraFactory {
  readonly mode: UmbraMode;
  getState(): FactoryState;
  /** Subscribe to state changes; returns an unsubscribe function. */
  subscribe(listener: (state: FactoryState) => void): () => void;
  /** Connect the wallet (Lace) or initialise the local voter (mock). */
  connect(): Promise<void>;
  /** Deploy a fresh factory contract; resolves with its address. */
  deploy(): Promise<string>;
  /** Join an already-deployed factory by contract address. */
  join(contractAddress: string): Promise<void>;
  /** Publish a new poll; resolves with the new poll id. */
  createPoll(poll: NewPoll): Promise<string>;
  /** Cast one anonymous ballot. */
  vote(pollId: string, option: number): Promise<void>;
  /** Close a poll to further ballots (organiser only). */
  closePoll(pollId: string): Promise<void>;
  /** Focus a poll in the UI. */
  select(pollId: string | null): void;
}
