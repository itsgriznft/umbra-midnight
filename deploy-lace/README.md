# deploy-lace — deploying the poll factory through Lace

A single page that connects the **Lace Midnight** wallet and deploys
`contracts/umbra_polls.compact` to **Preprod**. It exists because the headless
route in [`../deploy/`](../deploy/) cannot finish: the Node wallet SDK stalls
partway through syncing Preprod (see the README's *Current status* section), so
this hands the wallet's job to Lace instead.

```bash
npm install
cp -r ../contracts/managed/umbra_polls public/managed/   # the compiled circuits
npm run dev                                              # http://localhost:5180
```

Then open the page in a browser with the Lace Midnight extension, wallet
unlocked and pointed at **Preprod** with its proof server set to
`http://localhost:6300` (Settings › Midnight), and press *Connect Lace & deploy*.

## Notes for anyone retrying this

Things that cost time and are not obvious:

- **Vite needs help with the SDK.** `vite-plugin-wasm` + `vite-plugin-top-level-await`,
  a `Buffer`/`global` shim, and — because the wasm packages are excluded from
  pre-bundling — their CommonJS dependencies (`object-inspect`, `side-channel`,
  `get-intrinsic`) must be named in `optimizeDeps.include`, or the browser gets
  *"does not provide an export named 'default'"*.
- **`connect()` takes a lowercase network id.** `preprod`, not `Preprod`;
  the accepted set is `mainnet | preprod | preview | qanet | undeployed`.
- **The extension injects late.** `window.midnight` is undefined until the page
  is reloaded after the extension is installed.
- **Lace asks for the password twice** — once to unlock the wallet, then again to
  confirm the transaction. They are different modals.
- **Speed matters.** Lace's MV3 service worker idles out after roughly 30
  seconds and takes the connector channel with it, surfacing as
  `RemoteApiShutdownError: Remote API with channel 'midnight-wallet' was
  shutdown`. Anything that stalls the flow — a password prompt left open, or
  stealing window focus back from Lace's signing tab — triggers it.

## Why not midnight-js 5.x

`midnight-js@5.0.0-beta.6` is published and was tried end-to-end. It cannot run
this contract, and the reason is structural rather than a configuration mistake:

- `compact-runtime@0.16` re-exports **`onchain-runtime-v3`**;
  `compact-runtime@0.18` (which 5.x depends on) re-exports **`onchain-runtime-v4`**.
- The newest released Compact compiler, **0.31.1**, emits code that declares
  `expects 0.16.0`, so it targets v3. Loading it against 5.x fails immediately
  with `Version mismatch: compiled code expects 0.16.0, runtime is 0.18.0-rc.1`.
- Pinning `compact-runtime` to `0.16.0` via npm `overrides` gets the contract to
  load, but then `compact-js` — written against v4 — hands
  `signatureVerifyingKey` a tagged `{tag, value}` key that v3's function does not
  accept, and the deploy dies in `createMaintenanceAuthority`.

So 5.x needs a contract compiled by a compiler that targets onchain-runtime v4,
and no such compiler has shipped (`compact list` tops out at 0.31.1). This page
therefore stays on `midnight-js@4.1.1`, which matches runtime 0.16/v3.

Two 5.x quirks worth writing down for whenever the compiler does catch up:

- `FetchZkConfigProvider`'s second argument became an options object
  (`{ fetchFunc, verify }`) instead of the fetch function, and it verifies every
  artifact against a compiler-emitted integrity manifest. Without one, pass
  `{ verify: 'warn' }`.
- `signingKey` has to be passed to `deployContract` explicitly. midnight-js only
  writes `KEYS_SIGNING`/`KEYS_SIGNING_KIND` into the runtime config map when that
  option is set, yet reads `keys.signingKind` as *required* — so omitting it
  fails schema validation rather than letting the SDK sample its own key. Its own
  fallback is broken too: it calls `sampleSigningKey('schnorr').value`, but that
  function returns a plain string, so `.value` is `undefined`.

## Where it currently stops

Connection, configuration and signing all succeed. After the transaction is
confirmed in Lace, the flow does not progress past `balanceUnsealedTransaction`,
and the local proof server logs **no proving requests at all** — so the
transaction is never proved or submitted, and no contract address is produced.

That is the same shape of problem as the headless attempt: the published
tooling and the current Preprod network do not line up. Recorded here rather
than quietly dropped, because the next person will otherwise spend the same
hours rediscovering it.
