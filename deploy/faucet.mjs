// Fund a Midnight testnet address from the faucet, driving a real browser over
// the Chrome DevTools Protocol. Defaults to Preview; pass a Preprod faucet URL
// as the second argument to target Preprod instead.
//
//   CDP_PORT=9333 node faucet.mjs <mn_addr_preview1...>
//
// Why not @midnight-ntwrk/testkit-js's FaucetClient? It POSTs to the faucet URL
// *root* with a hardcoded dummy captcha header:
//
//     axios.post(faucetUrl, {recipientAddress, amount}, {headers: {'X-Captcha-Token': 'XXXX.DUMMY.TOKEN.XXXX'}})
//
// Against the public faucets that hits the single-page app, which
// answers HTTP 200 with its HTML. The client logs "Faucet response: OK" and
// nothing is ever requested — a silent no-op that looks like success. The real
// API is:
//
//     POST /api/request-tokens    {address, captchaToken}  -> requestId
//     GET  /api/request-status/:id -> {status: scheduled|in_progress|success|failure}
//
// and captchaToken must be a genuine Cloudflare Turnstile token. So we load the
// faucet page in a CDP-controlled Chrome, let its Turnstile widget solve the
// challenge the way it does for any visitor, and use the token it produces.
// Chrome must already be running with --remote-debugging-port=<CDP_PORT>.
export const DEFAULT_FAUCET = "https://faucet.preview.midnight.network";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (u) => (await fetch(u)).json();

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let idc = 0;
    const api = {
      send(method, params) {
        const id = ++idc;
        return new Promise((res, rej) => {
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params: params ?? {} }));
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

async function evaluate(api, expression) {
  const out = await api.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (out.exceptionDetails) {
    throw new Error(out.exceptionDetails.exception?.description ?? JSON.stringify(out.exceptionDetails));
  }
  return out.result.value;
}

/**
 * Ask the faucet for tokens and wait for the request to reach a terminal state.
 *
 * @returns {Promise<{transactionIdentifier: string}>} on success
 * @throws if Chrome is unreachable, the captcha never solves, or the faucet fails
 */
export async function requestTokens(address, { faucet = DEFAULT_FAUCET, cdpPort = process.env.CDP_PORT ?? "9333", log = console.log } = {}) {
  if (!/^mn_addr_/.test(address ?? "")) throw new Error(`not a Midnight address: ${address}`);
  const base = `http://127.0.0.1:${cdpPort}`;

  let targets;
  try {
    targets = await getJson(base + "/json");
  } catch {
    throw new Error(
      `no Chrome listening on CDP port ${cdpPort}. Start one with --remote-debugging-port=${cdpPort}.`,
    );
  }

  let page = targets.find((t) => t.type === "page" && t.url.startsWith(faucet));
  if (!page) {
    // A fresh tab, so we never disturb the user's existing ones. Recent Chrome
    // only accepts PUT on /json/new.
    await fetch(`${base}/json/new?${faucet}`, { method: "PUT" }).catch(() => {});
    for (let i = 0; i < 20 && !page; i++) {
      await sleep(500);
      page = (await getJson(base + "/json")).find((t) => t.type === "page" && t.url.startsWith(faucet));
    }
  }
  if (!page) throw new Error("could not open a faucet tab");

  const api = await connect(page.webSocketDebuggerUrl);
  try {
    await api.send("Page.enable");
    await api.send("Runtime.enable");
    // Turnstile tokens are single-use: reusing one the tab solved earlier gets
    // rejected as "timeout-or-duplicate". Force a real reload so the widget
    // issues a fresh one, and wait until the field is actually empty first.
    await api.send("Page.navigate", { url: faucet });
    await sleep(1500);
    await api.send("Page.reload", { ignoreCache: true });
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      if (await evaluate(api, "document.readyState === 'complete'").catch(() => false)) break;
    }
    for (let i = 0; i < 20; i++) {
      const stale = await evaluate(
        api,
        `(() => { const el=document.querySelector('[name="cf-turnstile-response"]');
                  return !!(el && el.value && el.value.length > 20); })()`,
      ).catch(() => false);
      if (!stale) break;
      await sleep(500);
    }

    // Turnstile drops its token into a hidden input once solved. That is
    // normally automatic; a managed challenge may need a click in the window.
    log("Waiting for the Turnstile widget to produce a token...");
    let token = null;
    for (let i = 0; i < 120 && !token; i++) {
      token = await evaluate(
        api,
        `(() => { const el = document.querySelector('[name="cf-turnstile-response"]');
                  const v = el && el.value; return v && v.length > 20 ? v : null; })()`,
      ).catch(() => null);
      if (token) break;
      if (i === 20) log("  still waiting — if a checkbox is showing, tick it in the Chrome window.");
      await sleep(1000);
    }
    if (!token) throw new Error("no Turnstile token after 120s (solve the captcha in the Chrome window and retry)");

    // The two testnets run different faucet services:
    //   preprod  POST /api/request-tokens {address, captchaToken} -> id
    //            GET  /api/request-status/:id -> {status: success|failure}
    //   preview  POST /api/drips {recipientAddress, amount}, captcha in the
    //            X-Captcha-Token header                          -> {dripId}
    //            GET  /api/drips/:id -> {status: PENDING|CONFIRMED|FAILED}
    const isPreview = /faucet\.preview\./.test(faucet);

    // Issued from inside the page: same origin, so no CORS to negotiate.
    const posted = await evaluate(
      api,
      isPreview
        ? `(async () => {
             const res = await fetch(${JSON.stringify(faucet)} + '/api/drips', {
               method: 'POST',
               headers: {'Content-Type': 'application/json', 'X-Captcha-Token': ${JSON.stringify(token)}},
               body: JSON.stringify({recipientAddress: ${JSON.stringify(address)}, amount: '1000000000'})
             });
             return { status: res.status, body: await res.text() };
           })()`
        : `(async () => {
             const res = await fetch(${JSON.stringify(faucet)} + '/api/request-tokens', {
               method: 'POST', headers: {'Content-Type': 'application/json'},
               body: JSON.stringify({address: ${JSON.stringify(address)}, captchaToken: ${JSON.stringify(token)}})
             });
             return { status: res.status, body: await res.text() };
           })()`,
    );
    if (posted.status < 200 || posted.status >= 300) {
      throw new Error(`faucet rejected the request (HTTP ${posted.status}): ${posted.body.slice(0, 300)}`);
    }

    const parsed = JSON.parse(posted.body);
    const requestId = isPreview ? (parsed.dripId ?? parsed.id ?? parsed) : parsed;
    log(`Faucet accepted the request (${requestId}). Waiting for it to settle...`);

    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      const statusUrl = isPreview
        ? `${faucet}/api/drips/${requestId}`
        : `${faucet}/api/request-status/${requestId}`;
      const res = await fetch(statusUrl, { headers: { "Content-Type": "application/json" } });
      const status = await res.json();
      const state = String(status.status ?? "").toLowerCase();
      if (state === "success" || state === "confirmed") {
        const value = status.value ?? status;
        log(`Faucet paid out. tx=${value.transactionIdentifier ?? value.txId ?? "(id not reported)"}`);
        return value;
      }
      if (state === "failure" || state === "failed") {
        throw new Error(`faucet failed: ${JSON.stringify(status.error ?? status)}`);
      }
    }
    throw new Error("faucet request never settled");
  } finally {
    api.close();
  }
}

// CLI
if (import.meta.filename === process.argv[1]) {
  requestTokens(process.argv[2])
    .then((v) => { console.log("FAUCET_OK: " + v.transactionIdentifier); process.exit(0); })
    .catch((e) => { console.error("FAUCET_FAILED: " + (e?.message ?? e)); process.exit(1); });
}
