# 🛠️ Umbra infrastructure (Level 2 — Preprod)

To deploy/vote on **Preprod** you need three things locally:

| Piece | What it does | How |
| --- | --- | --- |
| **Proof server** | Builds the zero-knowledge proof for each vote, locally | Docker container on `127.0.0.1:6300` (automated here) |
| **Indexer + node** | Reads/writes the Preprod chain | **Public** Preprod services — the Lace wallet provides their URIs |
| **Lace wallet** | Signs & balances transactions, holds tDUST | Browser extension + Preprod faucet (you do this) |

The indexer/node are hosted by Midnight, so the only server you run is the
**proof server**. Everything it computes stays on your machine — only the finished
proof (an anonymous nullifier + the chosen option) is submitted.

---

## 1. Proof server (automated)

This repo sets up an **isolated Ubuntu 24.04 WSL2 distro** (`MidnightUbuntu`, kept
separate from any other distro) with Docker Engine and the Midnight proof server.

Reproduce from scratch:

```powershell
# a) create the isolated distro (no admin needed if WSL2 is already installed)
powershell -ExecutionPolicy Bypass -File infra/wsl-import.ps1

# b) install Docker + run the proof server (network: preprod)
wsl -d MidnightUbuntu -u root -- bash /mnt/f/Milad/Midnight/umbra/infra/setup-proof-server.sh preprod
```

Manage it:

```powershell
wsl -d MidnightUbuntu -u root -- docker ps
wsl -d MidnightUbuntu -u root -- docker logs -f midnight-proof-server
wsl -d MidnightUbuntu -u root -- docker restart midnight-proof-server
```

WSL2 forwards `localhost`, so the server is reachable from Windows (and the browser)
at **http://127.0.0.1:6300**.

> **First run downloads the ZK parameters** (~tens of MB, from a Midnight dev host)
> and verifies each one — this can take several minutes and the port only opens once
> it finishes. Watch progress with `docker logs -f midnight-proof-server`; look for
> `verified correct`. The container uses **host networking** on purpose: Docker's
> default bridge corrupts those large downloads under WSL2.

> If you have Docker Desktop instead, skip WSL and just run:
> `docker compose -f infra/docker-compose.yml up -d`

### Keeping it running

A minimal WSL distro has no systemd, so the daemon is started manually by the setup
script. If WSL shuts the distro down (e.g. after a reboot), restart the daemon +
container:

```powershell
wsl -d MidnightUbuntu -u root -- bash -c "pgrep dockerd >/dev/null || (nohup dockerd >/var/log/dockerd.log 2>&1 &); sleep 4; docker start midnight-proof-server"
```

---

## 2. Lace wallet + Preprod tDUST (you do this)

1. Install the **Midnight Lace** wallet browser extension and create/restore a wallet.
2. Switch the network to **Preprod**.
3. In Lace settings, set the **proof server** to `http://127.0.0.1:6300`.
4. Get test funds from the **Preprod faucet** (see the Midnight docs / Discord) so you
   have tDUST to pay for deploy + vote transactions.

I can't automate this step — it needs your wallet seed and a faucet claim tied to
your address.

---

## 3. Run Umbra against Preprod

```bash
cd ui
cp .env.example .env          # VITE_NETWORK_ID=Preprod
# enable the real controller (see ui/README.md): import ./globals first in main.tsx,
# swap MockController -> UmbraLaceController in App.tsx, install the SDK deps,
# and remove lace-controller.ts from tsconfig "exclude".
npm run dev
```

Connect Lace → deploy a poll → vote. The proof is built by your local proof server;
the anonymous ballot lands on Preprod. That completes the Level 2 milestone.

---

## Troubleshooting

- **`docker: command not found`** — re-run `setup-proof-server.sh`.
- **daemon not reachable** — start it: `wsl -d MidnightUbuntu -u root -- nohup dockerd &`, wait a few seconds.
- **port 6300 in use** — `wsl -d MidnightUbuntu -u root -- docker rm -f midnight-proof-server` then re-run.
- **iptables errors under WSL2** — the script switches to `iptables-legacy`; re-run it if Docker networking misbehaves.
- **wallet can't reach proof server** — confirm `http://127.0.0.1:6300` responds and Lace's proof-server setting matches.
