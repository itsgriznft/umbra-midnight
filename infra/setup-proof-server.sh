#!/usr/bin/env bash
# Prepare the local Midnight infrastructure for Umbra (Level 2, Preprod):
# install Docker Engine inside this Linux env and run the Midnight proof server
# on http://127.0.0.1:6300. Designed for a minimal Ubuntu 24.04 WSL2 distro
# running as root (no systemd).
#
#   sudo bash setup-proof-server.sh
set -euo pipefail

PORT=6300
IMAGE="midnightnetwork/proof-server"
NAME="midnight-proof-server"

log() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }

log "Installing Docker Engine + prerequisites"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends ca-certificates curl iptables docker.io

log "Switching iptables to legacy (required for Docker networking under WSL2)"
update-alternatives --set iptables /usr/sbin/iptables-legacy  || true
update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy || true

log "Starting the Docker daemon"
mkdir -p /var/log
if ! docker info >/dev/null 2>&1; then
  nohup dockerd >/var/log/dockerd.log 2>&1 &
  for i in $(seq 1 40); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
fi
docker version --format 'Docker {{.Server.Version}} ready' || { echo "dockerd failed to start; see /var/log/dockerd.log"; tail -n 30 /var/log/dockerd.log || true; exit 1; }

# NOTE: Docker's default bridge network corrupts the proof server's large TLS
# parameter downloads under WSL2 (they come back empty — hash of "" — and fail).
# Running on the host network uses WSL's own (working) networking and fixes it.

log "Pulling the Midnight proof server image ($IMAGE)"
docker pull "$IMAGE"

log "Starting the proof server on 127.0.0.1:$PORT"
docker rm -f "$NAME" >/dev/null 2>&1 || true
# The image's default command runs `midnight-proof-server --port 6300`; no extra
# args are needed. On first run it downloads + verifies the ZK public parameters.
docker run -d --name "$NAME" --restart unless-stopped --network host "$IMAGE"

sleep 3
log "Status"
docker ps --filter "name=$NAME" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo
echo "Proof server URL:  http://127.0.0.1:$PORT   (reachable from Windows via WSL2 localhost forwarding)"
echo "Logs:              docker logs -f $NAME"
