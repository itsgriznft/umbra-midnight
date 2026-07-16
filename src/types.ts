/**
 * Shared types for the Umbra dApp.
 *
 * These describe the *off-chain* private state that the Compact `witness`
 * functions read from. Nothing here is ever written to the ledger.
 */

/** A voter's local private state — the 32-byte secret key stays on-device. */
export type UmbraPrivateState = {
  readonly secretKey: Uint8Array;
};

/** Human-readable poll definition used by the UI/CLI (Level 2+). */
export type PollConfig = {
  readonly question: string;
  /** 1–4 option labels; the on-chain contract tallies by index. */
  readonly options: readonly string[];
};

/** A snapshot of the public tally read back from the ledger. */
export type PollResults = {
  readonly question: string;
  readonly totalVotes: bigint;
  readonly tallies: readonly bigint[];
};
