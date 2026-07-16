# Create an isolated Ubuntu 24.04 WSL2 distro dedicated to Umbra's infra.
# Run in PowerShell (no admin needed if WSL2 is already installed):
#
#   powershell -ExecutionPolicy Bypass -File infra/wsl-import.ps1
#
# Then install Docker + the proof server:
#
#   wsl -d MidnightUbuntu -u root -- bash /mnt/<drive>/.../umbra/infra/setup-proof-server.sh preprod

$ErrorActionPreference = "Stop"
$distro = "MidnightUbuntu"
$dst    = "$env:LocalAppData\wsl\$distro"
$tar    = Join-Path $env:TEMP "ubuntu-base-24.04.tar.gz"
$url    = "https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/ubuntu-base-24.04.4-base-amd64.tar.gz"

if ((wsl -l -q) -contains $distro) {
  Write-Host "$distro already exists."
  return
}

Write-Host "Downloading Ubuntu 24.04 base rootfs..."
Invoke-WebRequest -UseBasicParsing $url -OutFile $tar -TimeoutSec 300

New-Item -ItemType Directory -Force -Path $dst | Out-Null
Write-Host "Importing as $distro (WSL2)..."
wsl --import $distro $dst $tar --version 2

Write-Host "Done. Distro '$distro' is ready (root user)."
wsl -d $distro -u root -- head -1 /etc/os-release

# Install a no-admin logon auto-start so the proof server comes back after a reboot.
$startup = [Environment]::GetFolderPath('Startup')
Copy-Item -Force (Join-Path $PSScriptRoot 'midnight-proof-server.cmd') (Join-Path $startup 'midnight-proof-server.cmd')
Write-Host "Installed logon auto-start -> $startup\midnight-proof-server.cmd"
