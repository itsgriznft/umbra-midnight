import { useEffect, useMemo, useState } from "react";
import { MockController } from "./umbra/mock-controller";
import { MAX_OPTIONS, type PollState, type UmbraController } from "./umbra/types";

// The mock controller makes the whole app runnable with no wallet. To run
// against Preprod, swap this for the Lace controller (see src/umbra/lace-controller.ts
// and the UI README) once you've compiled the contract and started a proof server.
function useController(): UmbraController {
  return useMemo(() => new MockController(), []);
}

function usePollState(controller: UmbraController): PollState {
  const [state, setState] = useState<PollState>(controller.getState());
  useEffect(() => controller.subscribe(setState), [controller]);
  return state;
}

export default function App() {
  const controller = useController();
  const state = usePollState(controller);
  const [error, setError] = useState<string | null>(null);

  const run = (p: Promise<unknown>) => {
    setError(null);
    p.catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="app">
      <header className="hero">
        <div className="brand">
          <span className="moon">🌑</span>
          <div>
            <h1>Umbra</h1>
            <p>Anonymous, verifiable polls on Midnight</p>
          </div>
        </div>
        <div className="badges">
          <span className={`badge mode-${state.mode}`}>{state.mode === "mock" ? "demo mode" : "Lace · Preprod"}</span>
          {!state.connected ? (
            <button className="btn primary" disabled={state.busy} onClick={() => run(controller.connect())}>
              Connect
            </button>
          ) : (
            <span className="badge ok">connected</span>
          )}
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      {!state.connected ? (
        <section className="card center">
          <p className="lede">
            Umbra keeps the <strong>tally public</strong> and the <strong>voter private</strong>. Each key votes once —
            enforced by a zero-knowledge nullifier, never by revealing who you are.
          </p>
          <button className="btn primary lg" onClick={() => run(controller.connect())}>
            Connect to start
          </button>
          <p className="hint">Demo mode runs entirely in your browser — no wallet needed.</p>
        </section>
      ) : state.contractAddress ? (
        <Poll state={state} onVote={(i) => run(controller.vote(i))} />
      ) : (
        <Setup controller={controller} run={run} />
      )}

      <footer className="foot">
        <span>Level 2 · Waxing Crescent 🌒</span>
        <a href="https://github.com/itsgriznft/umbra-midnight" target="_blank" rel="noreferrer">
          umbra-midnight
        </a>
      </footer>
    </div>
  );
}

function Poll({ state, onVote }: { state: PollState; onVote: (option: number) => void }) {
  const total = Math.max(state.totalVotes, 1);
  return (
    <section className="card">
      <div className="pollhead">
        <h2>{state.question}</h2>
        <code className="addr" title={state.contractAddress ?? ""}>
          {short(state.contractAddress)}
        </code>
      </div>

      <ul className="options">
        {state.options.map((label, i) => {
          const votes = state.tallies[i] ?? 0;
          const pct = Math.round((votes / total) * 100);
          const mine = state.myChoice === i;
          return (
            <li key={i}>
              <button
                className={`option ${mine ? "mine" : ""}`}
                disabled={state.hasVoted || state.busy}
                onClick={() => onVote(i)}
              >
                <span className="bar" style={{ width: `${state.totalVotes ? pct : 0}%` }} />
                <span className="label">
                  {label} {mine && <span className="you">· your vote</span>}
                </span>
                <span className="count">
                  {votes} · {state.totalVotes ? pct : 0}%
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="pollfoot">
        <span>{state.totalVotes} ballot(s) cast</span>
        {state.hasVoted ? (
          <span className="ok">✓ your anonymous ballot is in</span>
        ) : (
          <span className="hint">pick one — the choice is public, you are not</span>
        )}
      </div>
    </section>
  );
}

function Setup({ controller, run }: { controller: UmbraController; run: (p: Promise<unknown>) => void }) {
  const [question, setQuestion] = useState("Which lunar phase should Umbra ship on?");
  const [options, setOptions] = useState<string[]>(["New Moon", "First Quarter", "Full Moon", "Supermoon"]);
  const [joinAddr, setJoinAddr] = useState("");

  const setOption = (i: number, v: string) => setOptions((o) => o.map((x, j) => (j === i ? v : x)));

  return (
    <section className="card">
      <h2>Create a poll</h2>
      <label className="field">
        <span>Question</span>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask something…" />
      </label>
      <div className="opts">
        {options.map((o, i) => (
          <label className="field" key={i}>
            <span>Option {i + 1}</span>
            <input value={o} onChange={(e) => setOption(i, e.target.value)} placeholder={`Option ${i + 1}`} />
          </label>
        ))}
      </div>
      <p className="hint">Up to {MAX_OPTIONS} options. Empty options are ignored (min 2).</p>
      <button className="btn primary" onClick={() => run(controller.deploy(question, options))}>
        Deploy poll
      </button>

      <hr />

      <h3>…or join an existing poll</h3>
      <div className="joinrow">
        <input value={joinAddr} onChange={(e) => setJoinAddr(e.target.value)} placeholder="0x… contract address" />
        <button className="btn" disabled={!joinAddr} onClick={() => run(controller.join(joinAddr.trim()))}>
          Join
        </button>
      </div>
    </section>
  );
}

const short = (a: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
