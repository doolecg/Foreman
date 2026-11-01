<p align="center">
  <img src="docs/logo.png" alt="Foreman" width="160">
</p>

<h1 align="center">Foreman</h1>

<p align="center">
  <strong>A home for your coding agents. Claude Code and OpenCode side by side, with memory and skills kept per project.</strong><br>
  Every project gets its own threads, shells and browser. Lessons from finished sessions are kept, so the next session starts smarter.<br>
  Your projects and chats stay on your computer. No account, no analytics.
</p>

<p align="center">
  <a href="https://github.com/doolecg/Foreman/actions/workflows/build.yml"><img alt="CI" src="https://github.com/doolecg/Foreman/actions/workflows/build.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/doolecg/Foreman/releases"><img alt="Release" src="https://img.shields.io/github/v/release/doolecg/Foreman?style=flat-square&color=da7756&labelColor=1f1c1a"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-da7756?style=flat-square&labelColor=1f1c1a"></a>
  <img alt="Windows, macOS, Linux" src="https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-da7756?style=flat-square&labelColor=1f1c1a">
  <img alt="Node 24" src="https://img.shields.io/badge/node-24-da7756?style=flat-square&labelColor=1f1c1a">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#why-foreman">Why Foreman</a> ·
  <a href="#features">Features</a> ·
  <a href="#what-foreman-runs-on-your-machine">What it runs</a> ·
  <a href="#privacy-what-leaves-your-computer">Privacy</a> ·
  <a href="#development">Development</a> ·
  <a href="https://github.com/doolecg/Foreman/releases">Releases</a>
</p>

<p align="center">
  <img src="docs/images/hero.jpg" alt="Foreman: a home for your coding agents" width="100%">
</p>

---

Coding agents are strong, but they live in a terminal window with no memory of last week, no view of your other projects and no way to see what ten of them are doing at once. **Foreman is a desktop app that hosts Claude Code and OpenCode per project and keeps what they learn.** It does not orchestrate work for you: each agent is the real CLI, running with your account, in your folder.

## Quick start

Download the installer for your system from [Releases](https://github.com/doolecg/Foreman/releases): `.msi` for Windows, `.dmg` for macOS (Apple silicon or Intel), `.AppImage` or `.deb` for Linux. Foreman then updates itself.

You need [Claude Code](https://code.claude.com) (`claude`) or OpenCode (`opencode`) on your `PATH`.

Read [What Foreman runs on your machine](#what-foreman-runs-on-your-machine) before the first start, then add a project folder and press New thread.

## Why Foreman

**Your agents remember.** When a session ends, Foreman extracts the few lessons worth keeping: how the project does things, what failed and why, what you corrected. Useful procedures become skills you approve once, for every session. Memory is one fact per entry, de-duplicated, and stale entries are retired.

**See everything at once.** Threads per project in the sidebar, a Board of every thread across projects with who needs you, and Tiles to watch several agents side by side. Each thread shows its model, context use and state.

**Shells and a browser where you expect them.** Shells open in a drawer at the bottom, like the Console, and only show the current project's. The browser opens at the side of the thread. An AI agent can drive it when you allow it.

**One orchestrator, no fixed team.** Orchestrator Mode lets the thread you are talking to do the work itself and hand a part to a helper only when that saves context or time. No roles to configure, no coordination overhead.

**Built to be cheap on tokens.** Helpers start with only the tools they need and skip your global plugins and hooks, so they begin near 13k tokens instead of over 100k. A Compact button appears when the context is nearly full.

**Private by default.** No account, no analytics, no tracking. Your projects, chats, lessons and settings stay in Foreman's data folder. The [privacy section](#privacy-what-leaves-your-computer) lists every connection Foreman makes.

## Features

- **Threads, Chat and Terminal views.** Claude Code and OpenCode per project, in a Chat view or the real terminal, with model, effort and context on each.
- **Board and Plans.** The Board shows the threads of all your projects as cards. Plans lists the Engineering tasks of every project.
- **Engineering Mode.** A task goes through frame, spec, slices, plan approval, build and ship, with one approval gate: the plan.
- **Memory that sticks.** Lessons go to the project's Hindsight bank or memory folder. Facts about you are kept apart from facts about the project.
- **Mods.** An Agents panel for sub-agents, a Commands menu, and an activity box for learning and memory.
- **Usage at a glance.** Plan rings for the 5-hour and weekly limits (opt in), budgets and export.
- **Git, backups, presets and themes**, with settings applied live.
- **Edit from here.** Rewind a chat, and optionally the files, to before a message.
- **Dictation.** Speech turned into text on your computer.

## Screenshots

<p align="center">
  <img src="docs/images/threads-board-tiles.jpg" alt="Threads, Board and Tiles views" width="49%">
  <img src="docs/images/shell-drawer.jpg" alt="A shell in a drawer at the bottom of the window" width="49%">
</p>
<p align="center">
  <img src="docs/images/modes.jpg" alt="Orchestrator Mode and Engineering Mode switches in the top bar" width="49%">
  <img src="docs/images/memory-learning.jpg" alt="Learning settings: when and where lessons are kept" width="49%">
</p>
<p align="center">
  <img src="docs/images/mods.jpg" alt="Settings: Mods and token budgets" width="49%">
</p>

## What Foreman runs on your machine

Read this before the first start. By using Foreman you agree to it running the following.

- **PowerShell with `-ExecutionPolicy Bypass` (Windows only).** Foreman starts PowerShell for its own bundled scripts with `-ExecutionPolicy Bypass`: the media controls helper (`media-helper.ps1`, running in the background while Foreman is open) and the updater (which asks for admin rights through a Windows UAC prompt before it installs a new version). The bypass applies only to that one PowerShell process. Foreman does not change your machine's execution policy and does not run scripts other than its own this way.
- **Installs of optional tools, only when you ask.** On the first start a setup window offers optional tools (OpenCode, uv, CodeGraph, Playwright's Chromium and more). Nothing is ticked and nothing runs until you choose. Each install runs a normal package manager command such as `npm i -g @opencode/cli`, `winget install --id astral-sh.uv -e` or `npx playwright install chromium`, and Settings, Install shows the exact command before it runs. These install system-wide or for your user account, outside Foreman's folder.
- **Cookie import, only when you ask.** Settings, Browser can read your default browser's cookies through PowerShell after you confirm.

If you do not want any of this, do not install Foreman, or skip the setup window and leave Settings, Install alone. Without the optional tools the features that need them stay hidden and the console shows `ENOENT` lines for the missing commands; that is expected.

## Privacy: what leaves your computer

Foreman has no analytics, tracking or crash reporting, and no account of its own. Your projects, chats, lessons and settings stay in Foreman's data folder on your computer. These are the only connections Foreman makes, and why:

- **Updates.** At start and every few hours Foreman asks GitHub (`api.github.com`) for the latest release and downloads the installer from there. GitHub sees your IP address and that you run Foreman.
- **Claude Code, OpenCode and other AI tools.** They send your prompts and the files they read to their own services, under your account and their terms. Foreman does not see or control that traffic.
- **Claude plan limits (off by default).** If you turn this on in Settings, Tokens and budgets, Foreman sends the login token that Claude Code keeps on your computer to Anthropic (`api.anthropic.com`) every few minutes to read your 5-hour and weekly limits. Anthropic's terms may not allow other apps to use that login. Leave it off if you are not sure.
- **z.ai plan limits.** Only if you have set a z.ai key for Claude Code, Foreman asks z.ai for your plan usage with that key.
- **Memory (Hindsight).** By default it runs on your computer. If you point it at a LAN or remote server in Settings, the lessons Foreman saves go to that server.
- **Dictation.** Installing dictation downloads a speech model from Hugging Face (`huggingface.co`). Speech is turned into text on your computer.
- **Browser tile.** It loads the sites you open. Its default search is DuckDuckGo. If you turn on AI control, an AI agent can drive that browser; Foreman opens a debugging port on `127.0.0.1` (your own computer only) for this.
- **Tools you install.** Optional installs (OpenCode, uv, CodeGraph, Playwright's Chromium and more) download from npm, winget, PyPI and the tools' own sites when you choose to install them.

## Development

Needs Node.js 24.

```bash
npm install
npm run dev        # app with the Vite dev server
npm test           # unit tests
npm run dist       # installers for this system into dist/
```

Optional settings go in a `.env` (copy `.env.example`).

## License

Foreman is released under the [MIT License](LICENSE). Copyright © 2026 doolecg.

Foreman is provided "as is", without warranty of any kind. To the extent permitted by law, the authors are not liable for any claim, damages or other liability arising from its use. That includes what an AI agent does in a terminal you start in Foreman: agents can read, change and delete files and run commands with your permissions, so review what you let them do.

Claude Code, OpenCode, Hindsight, CodeGraph, Playwright and the other tools Foreman starts or installs are separate software under their own licenses and terms, which you accept with their makers when you install or use them. Claude Code is a product of Anthropic and is not open source. Foreman is not made by, endorsed by or affiliated with Anthropic or the makers of those tools; their names are used only to say what Foreman works with.

The Engineering Mode and Subagent Factory Mode skill packs (`plugin/engineering` and `plugin/factory`) are written fresh for Foreman. Their ideas draw on [mattpocock/skills](https://github.com/mattpocock/skills) (MIT, Matt Pocock) and [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (MIT, Addy Osmani). Their copyright notices are in `THIRD_PARTY_NOTICES.txt`.

Each installer ships `LICENSE.txt` and `THIRD_PARTY_NOTICES.txt` (the licenses of every package bundled with the app) in the `licenses` folder of the app's resources, alongside Electron's and Chromium's licenses. Settings, General, License opens that folder.

## Disclaimer

This software is provided "as is", without warranty of any kind, as set out in the [LICENSE](LICENSE). To the extent permitted by law, the authors are not liable for any loss or damage from using it, including lost data, lost work or damage to files or projects. Nothing here limits liability that cannot be limited by law, such as for death or personal injury caused by negligence.

Back up your work before using it. You use it at your own risk.

Claude Code, OpenCode and the other AI tools Foreman starts send your prompts and the files they read to their own services under your account and their terms. Foreman does not control that. Not affiliated with or endorsed by Anthropic. AI output can be wrong; check it before relying on it.

Foreman's browser tile and the cookie import can reach any website you point them at. You are responsible for following the terms of service of any site you use them with, and for copyright in anything you download. Use them only for content you have the right to access.

## Credits

Inspired by [OpenRig](https://github.com/mvschwarz/openrig) and [Paperclip](https://github.com/paperclipai/paperclip). Built with [CodeGraph](https://github.com/colbymchenry/codegraph) and [shadcn/ui](https://github.com/shadcn-ui/ui).
