# KuroLink

SSH client that doesn't suck (I hope). Built with Tauri 2.

![License](https://img.shields.io/badge/license-Apache%202.0-blue)

## what is this

A desktop SSH client that looks like a mecha command console. Connect to your servers, get a terminal, see system stats. That's it.

- **xterm.js** terminal with WebGL rendering
- **Multi-tab** terminals on a single SSH connection
- **Live system stats** - CPU temp, memory, disk, network
- **Connection profiles** - save your servers, auto-probe on launch
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
- `/sys/class/thermal/thermal_zone0/temp` -CPU temperature. works on Raspberry Pi OS out of the box. if your device doesn't have a thermal zone, CPU temp just won't show up. it's fine
- `/sys/class/net/eth0/statistics/` -network throughput. currently hardcoded to `eth0` because it was 4am when I wrote this. if you're on WiFi (`wlan0`), network stats will read zero. sorry

tl;dr if it's a Raspberry Pi running Raspberry Pi OS, everything just works. if it's something else, most things will work and the rest will not show up.

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
- [ ] VNC desktop mode (noVNC embedded)
- [ ] File browser / SCP transfers
- [ ] WireGuard tunnel management

## license

Apache 2.0 - do whatever, just keep the notice.
