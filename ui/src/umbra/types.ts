/**
 * The UI depends only on this controller interface. Two implementations exist:
 *   - MockController  — in-browser, enforces the same rules as the contract
 *                        (one ballot per key, public tally). Runs with no wallet.
 *   - LaceController  — real Midnight SDK + Lace wallet, deploys/votes on Preprod.
 *
 * Keeping the UI behind this seam means the whole interface is testable and
 * demoable offline, while the on-chain wiring lives in one swappable file.
 */

export type UmbraMode = "mock" | "lace";

export type PollState = {
  readonly question: string;
  /** Option labels (1–4). The contract tallies by index. */
  readonly options: readonly string[];
  /** Public per-option vote counts. */
  readonly tallies: readonly number[];
  readonly totalVotes: number;
  /** Whether *this* local voter (secret key) has already voted. */
  readonly hasVoted: boolean;
  /** The option index this voter picked, or null. */
  readonly myChoice: number | null;
  /** Deployed contract address, or null before deploy/join. */
  readonly contractAddress: string | null;
  readonly connected: boolean;
  readonly busy: boolean;
  readonly mode: UmbraMode;
};

export interface UmbraController {
  readonly mode: UmbraMode;
  getState(): PollState;
  /** Subscribe to state changes; returns an unsubscribe function. */
  subscribe(listener: (state: PollState) => void): () => void;
  /** Connect the wallet (Lace) or initialise the local voter (mock). */
  connect(): Promise<void>;
  /** Deploy a fresh poll; resolves with the new contract address. */
  deploy(question: string, options: string[]): Promise<string>;
  /** Join an already-deployed poll by contract address. */
  join(contractAddress: string): Promise<void>;
  /** Cast one anonymous ballot for the given option index. */
  vote(option: number): Promise<void>;
}

export const MAX_OPTIONS = 4;
