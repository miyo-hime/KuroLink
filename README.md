# KuroLink

Terminal emulator for people who think Windows Terminal is fine but wish it looked like a mecha command console. Built with Tauri 2.

[![Primary Repo](https://img.shields.io/badge/primary-Forgejo-orange?logo=forgejo)](https://codex.kurobox.me/miyo-rin/KuroLink)
[![GitHub Mirror](https://img.shields.io/badge/mirror-GitHub-gray?logo=github)](https://github.com/miyo-hime/KuroLink)
![Version](https://img.shields.io/badge/v0.6.1-cyan)
![License](https://img.shields.io/badge/license-Apache%202.0-blue)
![Built with Tauri](https://img.shields.io/badge/Tauri%202-24C8D8?logo=tauri&logoColor=white)

## what is this

A terminal app. Local shells, SSH connection profiles, live system stats, tabs you can drag around. The UI looks like NERV headquarters because I wanted it to.

**local terminals:**
- PowerShell, CMD, WSL - launch from the connection screen or open new tabs on the fly

**SSH:**
- connect to remote servers with saved profiles, get a terminal
- SSH agent support (OpenSSH on Windows, Pageant fallback) - agent mode is default
- key file auth with optional encrypted passphrase storage (AES-256-GCM, tied to install)
- host key verification (TOFU, checks `~/.ssh/known_hosts`, yells at you if the key changes)
- connection drop detection - knows when your link dies instead of sitting there pretending everything is fine

**terminal:**
- xterm.js with WebGL rendering
- PuTTY-style clipboard (select to copy, right-click to paste), clickable URLs, search, font zoom, 10k scrollback
- multi-tab with drag reorder, dropdown menu, context menus, middle-click to close
- keyboard shortcuts: `Ctrl+Tab`/`Ctrl+Shift+Tab` (cycle), `Ctrl+1-9` (jump), `Ctrl+Shift+W` (close), `Ctrl+Shift+T` (reopen)

**stats:**
- local tabs show local system stats (CPU, memory, disk) via sysinfo
- SSH tabs show remote stats (CPU temp, memory, disk, network) pulled over the connection
- same UI either way, it just knows which machine to ask

**misc:**
- portable - single `.exe`, config saves next to it, no installer
- ~15MB binary because Tauri exists
- window state persistence (size, position, maximized)
- connection profiles auto-save

## download

Grab the latest `.exe` from [Releases](https://codex.kurobox.me/miyo-rin/KuroLink/releases) (or from the [GitHub mirror](https://github.com/miyo-hime/KuroLink/releases)). Run it. That's the whole install process.

Config saves as `kurolink.json` next to the exe. Move the folder wherever you want.

## usage

Run it. You get a connection screen. From there you can:

- **open a local shell** - hit PowerShell, CMD, or WSL in the LOCAL panel
- **connect to a server** - fill in host/port/username, pick your auth mode, hit CONNECT

Once you're in, the `+` button clones whatever your current tab is. The dropdown arrow next to it gives you the full menu - local shells and saved SSH profiles. Mix and match. Each tab is independent.

Profiles auto-save. The app remembers your last connection and auto-probes it on launch. SSH agent is the default auth mode - if you have keys loaded in your system agent, it just works.

## host requirements (SSH only)

The live stats on remote connections are pulled by running standard Linux commands over SSH. Your target machine needs:

- `free`, `df`, `awk`, `uptime` - if you're running any normal Linux distro these are already there
- `/sys/class/thermal/thermal_zone*/temp` - CPU temperature. auto-detects the right zone. if your device doesn't have one, it just won't show up
- network interface auto-detected via `ip route show default`

tl;dr if it's a Raspberry Pi running Raspberry Pi OS, everything just works. if it's something else, most things will work and the rest will gracefully not show up. local shells don't need any of this obviously.

## building from source

Most people should just download the release. If you want to build it yourself:

- Node.js 18+, Rust stable, Visual Studio Build Tools (C++ workload)
- `npm install && npx tauri build`
- go make coffee

> **Windows note:** We use the `ring` crypto backend because the default (`aws-lc-rs`) needs NASM installed. If you have NASM, you can switch back in `Cargo.toml`. You probably won't notice the difference.

## roadmap

- [x] Local shells (PowerShell, CMD, WSL)
- [x] SSH terminal with multi-tab
- [x] Independent tabs with drag reorder, dropdown, keyboard shortcuts
- [x] Connection profiles with SSH agent support
- [x] Live system stats (local + remote)
- [x] NERV/Gundam command console aesthetic
- [x] Host key verification, connection drop detection, encrypted passphrase storage
- [ ] SFTP file browser / transfers
- [ ] Custom window chrome (the titlebar deserves the mecha treatment too)
- [ ] VNC desktop mode (noVNC embedded) - the plumbing is there, the pixels are not
- [ ] Split panes, session restore, command palette

## license

Apache 2.0 - do whatever, just keep the notice.
