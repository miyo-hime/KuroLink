<div align="center">

# KuroLink

An SSH client and terminal for people who think Windows Terminal is fine but wish it looked like a mecha command console.

[![Primary Repo](https://img.shields.io/badge/primary-Kurobox-purple?logo=forgejo&style=flat-square)](https://codex.kurobox.me/miyo-rin/KuroLink)
[![GitHub Mirror](https://img.shields.io/badge/mirror-GitHub-gray?logo=github&style=flat-square)](https://github.com/miyo-hime/KuroLink)
![Version](https://img.shields.io/badge/v0.17.0-orange?style=flat-square)
![License](https://img.shields.io/badge/license-Apache%202.0-blue?style=flat-square)
![Built with Tauri](https://img.shields.io/badge/Tauri%202-24C8D8?logo=tauri&logoColor=white&style=flat-square)
![Svelte 5](https://img.shields.io/badge/Svelte%205-FF3E00?logo=svelte&logoColor=white&style=flat-square)

</div>

## what is this

a tool I built for myself and a friend. we've both got servers lying around and we're forever sshing in for small stuff - edit a config, tail a log, grab a file. VSCode Remote-SSH for that is a forklift hauling a coffee cup; PuTTY does the job but looks like 2003.

so: KuroLink. a terminal, an SFTP browser, and a real code editor in one small window that happens to look like a mecha cockpit.

**built and tested on Windows 11 only** - it leans on win11 bits for the glass, so on win10 it should run and just drop to a flat background (probably - nobody's checked). Apache 2.0; source's right there if you want it to go further.

## what it does

**a terminal, local or remote**
- local shells (PowerShell, CMD, WSL, Nu) and SSH sessions, side by side in tabs you can drag around
- the real Ghostty engine under the hood (compiled to wasm), so Nerd Fonts, emoji and CJK render properly instead of turning into question-mark soup
- select-to-copy / right-click-paste, clickable links, find-in-buffer, font zoom, 10k scrollback
- shortcuts: `Ctrl+Tab` to cycle, `Ctrl+1-9` to jump, `Ctrl+Shift+W` to close, `Ctrl+Shift+T` to reopen

**files, the part that replaced VSCode for us**
- an SFTP file browser in a side panel - browse the remote box, rename, delete, make folders
- open remote files in a proper editor right next to your terminals: syntax highlighting, multi-cursor, minimap, the works. `Ctrl+S` saves straight back over SSH
- view images inline, preview SVGs live as you edit
- drag-and-drop upload, file-picker upload, download - all with a progress tray you can cancel from

**ssh that behaves**
- saved connection profiles, three ways in - SSH agent by default (OpenSSH on Windows, Pageant fallback), a key file, or a password. saved passphrases and passwords go in the Windows credential vault, never the config file
- host-key checking that trusts on first use and yells if a key ever changes
- notices when the link drops instead of sitting there pretending everything's fine

**stats, whichever machine you're looking at**
- local tabs show your PC, SSH tabs show the remote box - CPU, temperature, memory, disk, network - same readout either way, it just knows who to ask

**looks worth keeping the lights on for**
- eight themes out of the box (kurolink, ink, phosphor, catppuccin mocha, monokai, dracula, nord, gruvbox dark), then tweak palette, font, glass and CRT effects from a settings drawer with a live preview
- picking a theme recolors the whole app, not just the terminal text

**and the boring-but-nice basics**
- a single portable exe, no installer, config saves right next to it (it's Tauri, not Electron, so it's megabytes, not a small country's worth of disk)
- remembers your window size, position, and last connection

## download

Grab the latest `.exe` from [Releases](https://codex.kurobox.me/miyo-rin/KuroLink/releases) (or the [GitHub mirror](https://github.com/miyo-hime/KuroLink/releases)). Run it. That's the whole install.

Config saves as `kurolink.json` next to the exe - move the folder wherever you like. Windows 11 is the tested target; see the note up top if you're on something older.

## first run

You land on a connection screen. From there:

- **open a local shell** - hit PowerShell, CMD, or WSL in the LOCAL panel
- **connect to a server** - fill in host / port / username, pick your auth mode, hit CONNECT

Once you're in, the `+` button clones your current tab and the dropdown arrow beside it opens the full menu - local shells and saved SSH profiles, mix and match. Every tab is independent.

Profiles auto-save, the app remembers your last connection and probes it on launch, and SSH agent is the default auth mode - if your keys are loaded in your system agent, it just works.

## ssh host requirements

The live stats on remote connections come from running a few standard Linux commands over SSH. Your target needs:

- `free`, `df`, `awk`, `uptime` - present on basically any normal distro already
- `/sys/class/thermal/thermal_zone*/temp` for CPU temperature (auto-detects the zone; if your device has none, it just won't show)
- network interface auto-detected via `ip route show default`

tl;dr if it's a Raspberry Pi on Raspberry Pi OS, everything works. anything else, most things work and the rest quietly don't show up. local shells need none of this, obviously.

## building from source

Most people should just download the release. If you'd rather build it:

- Node.js 18+, Rust stable, Visual Studio Build Tools (C++ workload)
- `npm install && npx tauri build`
- go make coffee

> **Windows note:** we use the `ring` crypto backend because the default (`aws-lc-rs`) wants NASM installed. if you have NASM, switch it back in `Cargo.toml`. you won't notice the difference.

## credits

the terminal core is [ghostty-web](https://github.com/coder/ghostty-web) by coder - a wasm build of [Ghostty](https://ghostty.org)'s VT engine by Mitchell Hashimoto and contributors. they did the genuinely hard part (parsing a terminal correctly, grapheme clusters and all); KuroLink just wraps it in a mecha costume. go give both a star.

also standing on [Tauri](https://tauri.app), [russh](https://github.com/Eugeny/russh), [russh-sftp](https://crates.io/crates/russh-sftp), [CodeMirror](https://codemirror.net), and [portable-pty](https://crates.io/crates/portable-pty) - open source is a relay race.

## license

Apache 2.0 - do whatever, just keep the notice.
