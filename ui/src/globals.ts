// Node polyfills the Midnight SDK expects when running in the browser.
// Import this FIRST (before any @midnight-ntwrk/* import) in main.tsx when you
// switch to the Lace controller. Requires: npm i buffer
import { Buffer } from "buffer";

// @ts-expect-error - some third-party libs read process.env.NODE_ENV in the browser
globalThis.process = { env: { NODE_ENV: import.meta.env.MODE } };
globalThis.Buffer = Buffer;
