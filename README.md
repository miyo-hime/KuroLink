# KuroLink

SSH client that doesn't suck (I hope). Built with Tauri 2.

![License](https://img.shields.io/badge/license-Apache%202.0-blue)

## what is this

A desktop SSH client that looks like a mecha command console. Connect to your servers, get a terminal, see system stats. That's it.

- **xterm.js** terminal with WebGL rendering
- **Multi-tab** terminals on a single SSH connection
- **Live system stats** - CPU temp, memory, disk, network
- **Connection profiles** - save your servers, auto-probe on launch, delete the ones you regret
- **Host key verification** - TOFU model, checks `~/.ssh/known_hosts`, yells at you if the key changes
- **Connection drop detection** - knows when your SSH dies and tells you about it instead of sitting there like nothing happened
- **Portable** -single `.exe`, config saves next to it, no installer
- **~15MB binary** because Tauri exists

The whole UI looks like NERV headquarters. This is a feature.

## download

Grab the latest `.exe` from [Releases](https://github.com/miyo-hime/KuroLink/releases). Run it. That's the whole install process.

Config saves as `kurolink.json` next to the exe. Move the folder wherever you want.

## usage

1. Run KuroLink.exe
2. Fill in your server details (host, port, username, SSH key path)
3. Hit CONNECT · CLI
4. You have a terminal now

Profiles auto-save. The app remembers your last connection and auto-probes it on launch. `~/.ssh/id_ed25519` is the default key path. SSH key auth only -no password login.

## host requirements

The live stats (CPU temp, memory, disk, network) are pulled by running standard Linux commands over SSH. Your target machine needs:

- `free`, `df`, `awk`, `uptime` -if you're running any normal Linux distro these are already there. if they're not, something has gone wrong and you have bigger problems than KuroLink
- `/sys/class/thermal/thermal_zone*/temp` -CPU temperature. auto-detects the `cpu-thermal` zone now (I finally fixed the hardcode). if your device doesn't have a thermal zone at all, CPU temp just won't show up. it's fine
- network interface -auto-detected via `ip route show default`. works on eth0, wlan0, whatever your default route uses. the 4am `eth0` hardcode is gone, you're welcome

tl;dr if it's a Raspberry Pi running Raspberry Pi OS, everything just works. if it's something else, most things will work and the rest will gracefully not show up.

## building from source

Most people should just download the release. If you want to build it yourself, you already know what you're doing, but:

- Node.js 18+, Rust stable, Visual Studio Build Tools (C++ workload)
- `npm install && npx tauri build`
- go make coffee

> **Windows note:** We use the `ring` crypto backend because the default (`aws-lc-rs`) needs NASM installed. If you have NASM, you can switch back in `Cargo.toml`. You probably won't notice the difference.

## roadmap

- [x] SSH terminal with multi-tab
- [x] Connection profiles
- [x] Live system stats
- [x] NERV/Gundam command console aesthetic
- [x] Host key verification (TOFU)
- [x] Connection drop detection + reconnect
- [x] Auto-detect network interface and thermal zone (no more hardcodes at 4am)
- [ ] VNC desktop mode (noVNC embedded) -the plumbing is there, the pixels are not
- [ ] File browser / SCP transfers
- [ ] WireGuard tunnel management

## license

Apache 2.0 - do whatever, just keep the notice.
