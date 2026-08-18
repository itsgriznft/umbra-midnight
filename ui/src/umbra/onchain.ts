/**
 * A live, read-only look at the deployed contracts.
 *
 * The demo itself runs on an in-browser mock so anyone can click through it
 * without a wallet. That leaves a fair question — is any of this actually on a
 * chain? This module answers it from the visitor's own browser by querying
 * Midnight's public indexer for the deployed contracts. No wallet, no proof
 * server, no trust in what this page claims: the indexer either returns a
 * ContractDeploy for these addresses or it does not.
 */

export const INDEXER = "https://indexer.preview.midnight.network/api/v4/graphql";
export const NETWORK = "Preview";

export type DeployedContract = {
  key: "factory" | "single";
  label: string;
  address: string;
  source: string;
};

export const CONTRACTS: DeployedContract[] = [
  {
    key: "factory",
    label: "Poll factory",
    address: "7733833db4dc875b59ac36a29f25e73c35060a1135a9fa7b6b984a852fd12b7f",
    source: "contracts/umbra_polls.compact",
  },
  {
    key: "single",
    label: "Single poll",
    address: "a14fc086c54c448c87237dd1938f67c4065444de87ab5d2a22c28d1e96be6907",
    source: "contracts/umbra.compact",
  },
];

export type ChainStatus =
  | { state: "loading" }
  | { state: "ok"; typename: string; txHash: string; block: number }
  | { state: "error"; message: string };

const QUERY = `query ($address: HexEncoded!) {
  contractAction(address: $address) {
    __typename
    transaction { hash block { height } }
  }
}`;

export async function fetchContractStatus(address: string, signal?: AbortSignal): Promise<ChainStatus> {
  try {
    const res = await fetch(INDEXER, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { address } }),
      signal,
    });
    if (!res.ok) return { state: "error", message: `indexer returned ${res.status}` };
    const json = await res.json();
    if (json.errors?.length) return { state: "error", message: json.errors[0].message };
    const action = json.data?.contractAction;
    if (!action) return { state: "error", message: "not found on chain" };
    return {
      state: "ok",
      typename: action.__typename,
      txHash: action.transaction.hash,
      block: action.transaction.block.height,
    };
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") return { state: "loading" };
    return { state: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

export const short = (s: string, head = 10, tail = 6) =>
  s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
