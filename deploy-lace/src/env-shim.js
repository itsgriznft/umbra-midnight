// Must be imported before anything from @midnight-ntwrk.
//
// The SDK's configuration goes through an Effect ConfigProvider that reads the
// environment first — constant-cased, `_` delimited — and only then falls back
// to JSON. A browser has no environment, and an empty `process.env` shim makes
// `keys.signingKind` read as undefined, which fails schema validation instead
// of being treated as unset. Vite's `define` does not reach inside pre-bundled
// dependencies, so the value is set on the real global here.
//
// With `signingKind` present, `keys.signing` stays absent (it is optional) and
// the SDK samples its own contract maintenance authority key.
const env = {
  KEYS_SIGNING_KIND: "schnorr",
  NETWORK_ID: "preprod",
};

if (typeof globalThis.process === "undefined") {
  globalThis.process = { env: { ...env } };
} else {
  globalThis.process.env = { ...(globalThis.process.env ?? {}), ...env };
}

export {};
