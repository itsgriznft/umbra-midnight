/**
 * Witness wiring for the Umbra contract.
 *
 * A Compact `witness` is a callback into local TypeScript that supplies private
 * inputs to a circuit. `localSecretKey()` hands the voter's secret key to the
 * proof generator so it can derive the anonymous nullifier — the key itself
 * never appears in the transaction or on-chain.
 *
 * The return shape `[newPrivateState, value]` is the Midnight witness contract:
 * the first element is the (possibly updated) private state, the second is the
 * value handed to the circuit.
 */
import type { UmbraPrivateState } from "./types.js";

export type { UmbraPrivateState } from "./types.js";

/** Build the local private state from a freshly generated 32-byte key. */
export const createUmbraPrivateState = (secretKey: Uint8Array): UmbraPrivateState => {
  if (secretKey.length !== 32) {
    throw new Error(`Umbra secret key must be 32 bytes, got ${secretKey.length}`);
  }
  return { secretKey };
};

/**
 * The witness object passed to the generated contract at deploy/call time.
 * Kept structurally typed so it type-checks without the compiler-generated
 * artifacts present (those land in `contracts/managed/` after `compact:build`).
 */
export const witnesses = {
  localSecretKey: (
    context: { privateState: UmbraPrivateState },
  ): [UmbraPrivateState, Uint8Array] => [context.privateState, context.privateState.secretKey],
};
