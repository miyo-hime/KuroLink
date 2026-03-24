# KuroLink

SSH client that doesn't suck (I hope). Built with Tauri 2.

![License](https://img.shields.io/badge/license-Apache%202.0-blue)

## what is this

A desktop SSH client with a cyberpunk terminal aesthetic. Connect to your servers, get a terminal, see system stats. That's it.

- **xterm.js** terminal with WebGL rendering
- **Multi-tab** terminals on a single SSH connection
- **Live system stats** - CPU temp, memory, disk, network
- **Connection profiles** - save your servers, switch between them
- **~15MB binary** because Tauri exists

The whole thing looks like it belongs in a cyberdeck. Cyan glows, scanlines, clip-path borders. You know the vibe.

## stack

| what | why |
|------|-----|
| Tauri 2 | small binary, native performance, not electron |
| React 19 | frontend framework, already knew it |
| Rust | backend, SSH handling, system-level stuff |
| russh | async SSH client, no shelling out to system ssh |
| xterm.js | terminal emulator, industry standard |

## building

You need:
- Node.js 18+
- Rust (stable)
- Windows: Visual Studio Build Tools (C++ workload)

```bash
npm install
cargo tauri dev
```

First build takes a while. Rust is compiling ~400 crates. Go make coffee.

> **Windows note:** We use the `ring` crypto backend because the default (`aws-lc-rs`) needs NASM installed. If you have NASM, you can switch back in `Cargo.toml` for slightly better crypto performance. You probably won't notice the difference.

## usage

1. Open KuroLink
2. Fill in your server details (host, port, username, SSH key path)
3. Hit CONNECT · CLI
4. You have a terminal now

Profiles auto-save. The app remembers your last connection. `~/.ssh/id_ed25519` is the default key path.

## host requirements

The live stats (CPU temp, memory, disk, network) are pulled by running standard Linux commands over SSH. Your target machine needs:

- `free`, `df`, `awk`, `uptime` - if you're running any normal Linux distro these are already there. if they're not, something has gone wrong and you have bigger problems than KuroLink
- `/sys/class/thermal/thermal_zone0/temp` - CPU temperature. works on Raspberry Pi OS out of the box. if your device doesn't have a thermal zone, CPU temp just won't show up. it's fine
- `/sys/class/net/eth0/statistics/` - network throughput. currently hardcoded to `eth0` because it was 4am when I wrote this. if you're on WiFi (`wlan0`), network stats will read zero. sorry

tl;dr if it's a Raspberry Pi running Raspberry Pi OS, everything just works. if it's something else, most things will work and the rest will not show up.

## roadmap

- [x] SSH terminal with multi-tab
- [x] Connection profiles
- [x] Live system stats
- [ ] VNC desktop mode (noVNC embedded)
- [ ] File browser / SCP transfers
- [ ] WireGuard tunnel management

## license

Apache 2.0 - do whatever, just keep the notice.
