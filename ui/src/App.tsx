import { useEffect, useMemo, useState } from "react";
import { MockFactory } from "./umbra/mock-factory";
import { CONTRACTS, INDEXER, NETWORK, fetchContractStatus, short as shortHex, type ChainStatus } from "./umbra/onchain";
import {
  MAX_OPTIONS,
  MIN_OPTIONS,
  type FactoryState,
  type PollSummary,
  type UmbraFactory,
} from "./umbra/factory-types";

// The mock factory makes the whole app runnable with no wallet. To run against
// Preprod, swap this for the Lace-backed factory once you've compiled the
// contract and started a proof server (see the UI README).
function useFactory(): UmbraFactory {
  return useMemo(() => new MockFactory(), []);
}

function useFactoryState(factory: UmbraFactory): FactoryState {
  const [state, setState] = useState<FactoryState>(factory.getState());
  useEffect(() => factory.subscribe(setState), [factory]);
  return state;
}

export default function App() {
  const factory = useFactory();
  const state = useFactoryState(factory);
  const [error, setError] = useState<string | null>(null);

  const run = (p: Promise<unknown>) => {
    setError(null);
    p.catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const selected = state.polls.find((p) => p.id === state.selectedId) ?? null;

  return (
    <div className="app">
      <header className="hero">
        <div className="brand">
          <span className="moon">🌓</span>
          <div>
            <h1>Umbra</h1>
            <p>Anonymous, verifiable polls on Midnight</p>
          </div>
        </div>
        <div className="badges">
          <span className={`badge mode-${state.mode}`}>
            {state.mode === "mock" ? "demo mode" : "Lace · Preprod"}
          </span>
          {!state.connected ? (
            <button className="btn primary" disabled={state.busy} onClick={() => run(factory.connect())}>
              Connect
            </button>
          ) : (
            <span className="badge ok">connected</span>
          )}
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      {!state.connected ? (
        <Welcome onConnect={() => run(factory.connect())} />
      ) : !state.contractAddress ? (
        <Start factory={factory} run={run} busy={state.busy} />
      ) : (
        <main className="layout">
          <PollList
            polls={state.polls}
            selectedId={state.selectedId}
            onSelect={(id) => factory.select(id)}
          />
          <div className="column">
            {selected ? (
              <Poll
                poll={selected}
                busy={state.busy}
                onVote={(option) => run(factory.vote(selected.id, option))}
                onClose={() => run(factory.closePoll(selected.id))}
              />
            ) : (
              <section className="card center">
                <p className="lede">No polls yet. Publish the first one.</p>
              </section>
            )}
            <NewPollForm factory={factory} run={run} busy={state.busy} myLeaf={state.memberLeaf} />
            <Identity address={state.contractAddress} memberLeaf={state.memberLeaf} />
          </div>
        </main>
      )}

      <OnChain />

      <footer className="foot">
        <span>Level 3 · First Quarter 🌓</span>
        <a href="https://github.com/itsgriznft/umbra-midnight" target="_blank" rel="noreferrer">
          umbra-midnight
        </a>
      </footer>
    </div>
  );
}

function Welcome({ onConnect }: { onConnect: () => void }) {
  return (
    <section className="card center">
      <p className="lede">
        Umbra keeps the <strong>tally public</strong> and the <strong>voter private</strong>. Each key votes once per
        poll — enforced by a zero-knowledge nullifier, never by revealing who you are. Private polls admit only members
        of an allowlist, and prove it without saying <em>which</em> member voted.
      </p>
      <button className="btn primary lg" onClick={onConnect}>
        Connect to start
      </button>
      <p className="hint">Demo mode runs entirely in your browser — no wallet needed.</p>
    </section>
  );
}

function Start({
  factory,
  run,
  busy,
}: {
  factory: UmbraFactory;
  run: (p: Promise<unknown>) => void;
  busy: boolean;
}) {
  const [joinAddr, setJoinAddr] = useState("");
  return (
    <section className="card">
      <h2>Deploy a poll factory</h2>
      <p className="hint">
        One contract holds many polls. Deploy your own, or join an existing factory by address.
      </p>
      <button className="btn primary" disabled={busy} onClick={() => run(factory.deploy())}>
        {busy ? "Deploying…" : "Deploy factory"}
      </button>

      <hr />

      <h3>…or join an existing factory</h3>
      <div className="joinrow">
        <input
          value={joinAddr}
          onChange={(e) => setJoinAddr(e.target.value)}
          placeholder="0x… contract address"
        />
        <button className="btn" disabled={!joinAddr || busy} onClick={() => run(factory.join(joinAddr.trim()))}>
          Join
        </button>
      </div>
    </section>
  );
}

function PollList({
  polls,
  selectedId,
  onSelect,
}: {
  polls: readonly PollSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="card polllist">
      <h2>
        Polls <span className="count-pill">{polls.length}</span>
      </h2>
      {polls.length === 0 ? (
        <p className="hint">Nothing published yet.</p>
      ) : (
        <ul className="polls">
          {polls.map((p) => (
            <li key={p.id}>
              <button
                className={`pollrow ${p.id === selectedId ? "active" : ""}`}
                onClick={() => onSelect(p.id)}
              >
                <span className="pollrow-q">{p.question}</span>
                <span className="pollrow-meta">
                  {p.gated ? <span className="tag gated">allowlist</span> : <span className="tag">open</span>}
                  {!p.open && <span className="tag closed">closed</span>}
                  {p.hasVoted && <span className="tag voted">voted</span>}
                  <span className="pollrow-count">{p.totalVotes}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function Poll({
  poll,
  busy,
  onVote,
  onClose,
}: {
  poll: PollSummary;
  busy: boolean;
  onVote: (option: number) => void;
  onClose: () => void;
}) {
  const total = Math.max(poll.totalVotes, 1);
  const blocked = poll.hasVoted || !poll.open || !poll.eligible || busy;

  return (
    <section className="card">
      <div className="pollhead">
        <h2>{poll.question}</h2>
        <div className="pollhead-tags">
          {poll.gated ? <span className="tag gated">allowlist</span> : <span className="tag">open</span>}
          {!poll.open && <span className="tag closed">closed</span>}
        </div>
      </div>

      <ul className="options">
        {poll.options.map((label, i) => {
          const votes = poll.tallies[i] ?? 0;
          const pct = Math.round((votes / total) * 100);
          const mine = poll.myChoice === i;
          return (
            <li key={i}>
              <button className={`option ${mine ? "mine" : ""}`} disabled={blocked} onClick={() => onVote(i)}>
                <span className="bar" style={{ width: `${poll.totalVotes ? pct : 0}%` }} />
                <span className="label">
                  {label} {mine && <span className="you">· your vote</span>}
                </span>
                <span className="count">
                  {votes} · {poll.totalVotes ? pct : 0}%
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="pollfoot">
        <span>{poll.totalVotes} ballot(s) cast</span>
        <span>{statusLine(poll)}</span>
      </div>

      {poll.canClose && poll.open && (
        <div className="organiser">
          <button className="btn ghost" disabled={busy} onClick={onClose}>
            Close poll
          </button>
          <span className="hint">
            You hold this poll's organiser secret. Closing proves that in zero knowledge — it does not reveal you.
          </span>
        </div>
      )}
    </section>
  );
}


/** Live proof, fetched in the visitor's browser, that the contracts are deployed. */
function OnChain() {
  const [statuses, setStatuses] = useState<Record<string, ChainStatus>>(
    () => Object.fromEntries(CONTRACTS.map((c) => [c.key, { state: "loading" } as ChainStatus])),
  );

  useEffect(() => {
    const ac = new AbortController();
    CONTRACTS.forEach((c) => {
      fetchContractStatus(c.address, ac.signal).then((s) =>
        setStatuses((prev) => ({ ...prev, [c.key]: s })),
      );
    });
    return () => ac.abort();
  }, []);

  return (
    <section className="card subtle onchain">
      <h3>On chain — Midnight {NETWORK}</h3>
      <p className="hint">
        The demo above runs in your browser so it needs no wallet. These contracts are real: the
        rows below are fetched live from Midnight's public indexer right now, from your machine.
      </p>
      {CONTRACTS.map((c) => {
        const s = statuses[c.key];
        return (
          <div className="chainrow" key={c.key}>
            <div className="chainhead">
              <strong>{c.label}</strong>
              {s.state === "loading" && <span className="hint">checking…</span>}
              {s.state === "ok" && <span className="ok">✓ {s.typename}</span>}
              {s.state === "error" && <span className="bad">{s.message}</span>}
            </div>
            <code className="addr" title={c.address}>{shortHex(c.address, 14, 8)}</code>
            {s.state === "ok" && (
              <span className="hint">
                tx <code>{shortHex(s.txHash, 10, 6)}</code> · block {s.block.toLocaleString()}
              </span>
            )}
          </div>
        );
      })}
      <p className="hint">
        Verify independently against <code>{INDEXER}</code> — the same query this page just ran.
      </p>
    </section>
  );
}

function statusLine(poll: PollSummary) {
  if (!poll.open) return <span className="hint">this poll is closed — the tally is final</span>;
  if (poll.hasVoted) return <span className="ok">✓ your anonymous ballot is in</span>;
  if (!poll.eligible) return <span className="hint">you are not on this poll's allowlist</span>;
  return <span className="hint">pick one — the choice is public, you are not</span>;
}

function NewPollForm({
  factory,
  run,
  busy,
  myLeaf,
}: {
  factory: UmbraFactory;
  run: (p: Promise<unknown>) => void;
  busy: boolean;
  myLeaf: string;
}) {
  const [question, setQuestion] = useState("Which lunar phase should Umbra ship on?");
  const [options, setOptions] = useState<string[]>(["New Moon", "First Quarter", "Full Moon", "Supermoon"]);
  const [gated, setGated] = useState(false);
  const [allowlist, setAllowlist] = useState("");

  const setOption = (i: number, v: string) => setOptions((o) => o.map((x, j) => (j === i ? v : x)));
  const addOption = () => setOptions((o) => (o.length < MAX_OPTIONS ? [...o, ""] : o));
  const removeOption = (i: number) =>
    setOptions((o) => (o.length > MIN_OPTIONS ? o.filter((_, j) => j !== i) : o));

  const submit = () =>
    run(
      factory.createPoll({
        question,
        options,
        allowlist: gated ? allowlist.split(/[\s,]+/).filter(Boolean) : [],
      }),
    );

  return (
    <section className="card">
      <h2>Publish a poll</h2>
      <label className="field">
        <span>Question</span>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask something…" />
      </label>

      <div className="opts">
        {options.map((o, i) => (
          <label className="field" key={i}>
            <span>Option {i + 1}</span>
            <div className="optrow">
              <input value={o} onChange={(e) => setOption(i, e.target.value)} placeholder={`Option ${i + 1}`} />
              <button
                className="btn tiny ghost"
                disabled={options.length <= MIN_OPTIONS}
                onClick={() => removeOption(i)}
                aria-label={`Remove option ${i + 1}`}
              >
                ×
              </button>
            </div>
          </label>
        ))}
      </div>
      <button className="btn tiny" disabled={options.length >= MAX_OPTIONS} onClick={addOption}>
        + option
      </button>
      <p className="hint">
        {MIN_OPTIONS}–{MAX_OPTIONS} options. Empty ones are ignored.
      </p>

      <label className="check">
        <input type="checkbox" checked={gated} onChange={(e) => setGated(e.target.checked)} />
        <span>Restrict to an allowlist</span>
      </label>

      {gated && (
        <label className="field">
          <span>Member leaves (one per line)</span>
          <textarea
            rows={4}
            value={allowlist}
            onChange={(e) => setAllowlist(e.target.value)}
            placeholder={myLeaf}
          />
          <div className="optrow">
            <button
              className="btn tiny"
              disabled={allowlist.includes(myLeaf)}
              onClick={() => setAllowlist((a) => (a.trim() ? `${a.trim()}\n${myLeaf}` : myLeaf))}
            >
              {allowlist.includes(myLeaf) ? "✓ you are on the list" : "+ add me"}
            </button>
          </div>
          <span className="hint">
            Only the tree's <strong>root</strong> is published. Members prove they belong with a private path, so a
            ballot never says which of them cast it.
          </span>
        </label>
      )}

      <button className="btn primary" disabled={busy} onClick={submit}>
        {busy ? "Publishing…" : "Publish poll"}
      </button>
    </section>
  );
}

/** A shortened value that copies itself in full when clicked. */
function Copyable({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      () => {},
    );
  };
  return (
    <button className="addr copyable" onClick={copy} title={`${value}\n(click to copy)`} aria-label={`Copy ${label}`}>
      {copied ? "✓ copied" : short(value)}
    </button>
  );
}

function Identity({ address, memberLeaf }: { address: string; memberLeaf: string }) {
  return (
    <section className="card subtle">
      <h3>This device</h3>
      <dl className="kv">
        <dt>Factory</dt>
        <dd>
          <Copyable value={address} label="the factory address" />
        </dd>
        <dt>Member leaf</dt>
        <dd>
          <Copyable value={memberLeaf} label="your member leaf" />
        </dd>
      </dl>
      <p className="hint">
        Your member leaf is public — hand it to an organiser to be added to an allowlist. Your secret key never leaves
        this device, and no ballot is ever linked to it.
      </p>
    </section>
  );
}

const short = (a: string | null) => (a ? `${a.slice(0, 8)}…${a.slice(-6)}` : "");
