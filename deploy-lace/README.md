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

## Where it currently stops

Connection, configuration and signing all succeed. After the transaction is
confirmed in Lace, the flow does not progress past `balanceUnsealedTransaction`,
and the local proof server logs **no proving requests at all** — so the
transaction is never proved or submitted, and no contract address is produced.

That is the same shape of problem as the headless attempt: the published
tooling and the current Preprod network do not line up. Recorded here rather
than quietly dropped, because the next person will otherwise spend the same
hours rediscovering it.
