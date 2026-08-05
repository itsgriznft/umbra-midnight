// Drive the Midnight Preview faucet through its own UI: focus the address
// field, type the address as real key events, then click "Request tokens".
//
// Typing rather than assigning `.value` matters — the page is framework-driven
// and ignores a value set behind its back. Letting the page submit also means
// its Turnstile widget runs the way it does for any visitor, instead of us
// trying to lift a token out of it.
//
//   CDP_PORT=9333 node faucet-ui.mjs <address>
const CDP_PORT = process.env.CDP_PORT || "9333";
const CDP_BASE = "http://127.0.0.1:" + CDP_PORT;
const ADDRESS = process.argv[2];
const FAUCET = process.argv[3] || "https://faucet.preview.midnight.network/";

if (!ADDRESS) { console.error("usage: node faucet-ui.mjs <address>"); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (u) => (await fetch(u)).json();

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let idc = 0;
    const api = {
      send(m, p) {
        const id = ++idc;
        return new Promise((res, rej) => {
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method: m, params: p || {} }));
        });
      },
      close() { try { ws.close(); } catch {} },
    };
    ws.addEventListener("open", () => resolve(api));
    ws.addEventListener("error", (e) => reject(new Error("WS " + (e.message || e.type))));
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    });
  });
}

const ev = async (api, e) => {
  const o = await api.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (o.exceptionDetails) throw new Error(o.exceptionDetails.exception?.description ?? "eval failed");
  return o.result.value;
};

// The page is client-rendered, so an element can be missing for a second or two
// after load. Poll rather than assuming it is there on the first look.
async function clickCentre(api, selectorExpr, label, tries = 20) {
  let raw = null;
  for (let i = 0; i < tries && !raw; i++) {
    raw = await ev(api, `(() => { const el = ${selectorExpr};
        if (!el) return null; el.scrollIntoView({block:'center'});
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return null;
        return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2}); })()`).catch(() => null);
    if (!raw) await sleep(700);
  }
  if (!raw) { console.error(`${label}: not found`); return false; }
  const { x, y } = JSON.parse(raw);
  const base = { x, y, button: "left", clickCount: 1 };
  await api.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...base });
  await api.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
  await api.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
  return true;
}

(async () => {
  let targets = await getJson(CDP_BASE + "/json");
  let page = targets.find((t) => t.type === "page" && t.url.startsWith(FAUCET));
  if (!page) {
    await fetch(`${CDP_BASE}/json/new?${FAUCET}`, { method: "PUT" }).catch(() => {});
    for (let i = 0; i < 20 && !page; i++) {
      await sleep(700);
      page = (await getJson(CDP_BASE + "/json")).find((t) => t.type === "page" && t.url.startsWith(FAUCET));
    }
  }
  if (!page) { console.error("could not open a faucet tab"); process.exit(1); }

  const api = await connect(page.webSocketDebuggerUrl);
  await api.send("Page.enable");
  await api.send("Runtime.enable");
  await api.send("Page.bringToFront");
  await sleep(1500);

  if (!(await clickCentre(api, "[...document.querySelectorAll('input')].find(i => i.type === 'text')", "address field"))) process.exit(1);
  await sleep(400);
  await api.send("Input.insertText", { text: ADDRESS });
  await sleep(600);

  const typed = await ev(api, "([...document.querySelectorAll('input')].find(i => i.type === 'text')||{}).value || ''");
  if (!typed.startsWith("mn_addr")) { console.error("address did not land in the field: " + typed.slice(0, 40)); process.exit(1); }
  console.log("address entered");

  // Give Turnstile a moment; it usually solves on its own.
  for (let i = 0; i < 30; i++) {
    const tok = await ev(api, `(() => { const el=document.querySelector('[name="cf-turnstile-response"]');
        return !!(el && el.value && el.value.length > 20); })()`).catch(() => false);
    if (tok) { console.log("turnstile solved"); break; }
    if (i === 12) console.log("  waiting on turnstile — tick the checkbox in the Chrome window if one is showing");
    await sleep(1000);
  }

  await clickCentre(api, `[...document.querySelectorAll('button')].find(b => /request tokens/i.test(b.textContent||''))`, "request button");
  console.log("clicked Request tokens");

  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const text = await ev(api, "document.body.innerText").catch(() => "");
    if (/success|sent|dispatch|confirmed|on its way|requested/i.test(text)) {
      console.log("FAUCET_OK: " + text.replace(/\s+/g, " ").slice(0, 200));
      break;
    }
    if (/error|failed|invalid|too many|rate/i.test(text)) {
      console.error("FAUCET_ERR: " + text.replace(/\s+/g, " ").slice(0, 250));
      break;
    }
  }
  api.close();
  process.exit(0);
})().catch((e) => { console.error("ERR:" + (e?.message ?? e)); process.exit(1); });
