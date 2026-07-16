/**
 * Binds the compiled Umbra contract to its witnesses, mirroring the official
 * `example-bboard` `contract/src/index.ts`.
 *
 * It imports the compiler-generated module under `contracts/managed/umbra`, so it
 * only resolves AFTER `npm run compact:build`. It is therefore excluded from the
 * default typecheck (see tsconfig.json) and consumed by the Lace controller for a
 * real Preprod run.
 */
import { Contract } from "../contracts/managed/umbra/contract/index.js";
import { witnesses } from "./witnesses.js";

export * from "../contracts/managed/umbra/contract/index.js";

/** A compiled Umbra contract instance wired to the local witnesses. */
export const CompiledUmbraContract = new Contract(witnesses);
export type CompiledUmbra = typeof CompiledUmbraContract;
