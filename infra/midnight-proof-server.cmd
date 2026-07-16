@echo off
rem Auto-start the Midnight proof server (Umbra Level 2) at Windows logon.
rem No admin needed. Copy this file into your Startup folder (shell:startup), or
rem let infra/wsl-import.ps1 install it. It starts the Docker daemon inside the
rem MidnightUbuntu WSL2 distro; the proof-server container then auto-restarts
rem (restart=unless-stopped) and listens on http://127.0.0.1:6300.
wsl.exe -d MidnightUbuntu -u root /usr/local/sbin/midnight-docker-up.sh
