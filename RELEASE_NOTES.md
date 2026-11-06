# Foreman 4.4.0

**Install:** download the file for your system from the assets below. Foreman keeps itself up to date from these releases.

## New
- **Lite sessions.** A Lite button beside New thread starts Claude with only the MCP servers and plugins you allow in Settings > Lite sessions. It also skips your user hooks and settings.
- **Ticket board.** The Board is now a kanban of tickets, with a column for each status. Drag a ticket to move it, or use Move to. A New ticket form adds tickets. If the board file has unreadable lines, Foreman shows a warning.
- **Ticket-driven Model Engine.** Work is split into tickets, kept in a ticket store, and run by a scheduler. It comes with a tickets CLI, worktrees and a Merger, and a watchdog.
- **Tool calls collapse in chat.** Long runs of tool calls fold into one line, so the chat is easier to read.

## Changed
- **Tiles and Plans are gone from the top nav.** The Engineering task list has no replacement for now.

---

# Foreman 4.3.2

**Install:** download the file for your system from the assets below. Foreman keeps itself up to date from these releases.

## New
- **Reinstall latest.** Settings > General has a Reinstall latest button when you are up to date. It downloads the newest release and installs it even if it is the version you already have.

## Fixed
- **Update loop.** The 4.3.1 installer carried an app that still said 4.3.0, so it kept offering 4.3.1. This release is built from a clean build and reports its own version. If you are on 4.3.1, press Restart to update once more.

---

# Foreman 4.3.1

**Install:** download the file for your system from the assets below. Foreman keeps itself up to date from these releases.

## Fixed
- **The 4.3.0 installer was built before the last changes.** This release is built from the final 4.3.0 work: the Small and Large graph views, the wider side panel, rounded graph links, the new Orchestration graph layout in the narrow panel, and the token rules in the kit.

---

# Foreman 4.3.0

**Install:** download the file for your system from the assets below. Foreman keeps itself up to date from these releases.

## New
- **The Orchestration graph.** The Agents panel has a List | Graph switch. The graph shows the Orchestrator, Brain, Recall, Builder, Council and Freelancers as cards with links between them. Links light up only when something is moving along them, and a running card gets marching dashes round its edge.
- **Small and Large graph views.** Small is one narrow column. Large is two columns and needs more room, so the side panel can now be dragged wider (up to 900 px, never so wide that the chat is squeezed out). The graph can also pop out into its own window.
- **Find in thread.** Ctrl+F opens a find bar with "n of N", Enter and Shift+Enter to step, Esc to close.
- **Diff panel.** "Show changes" opens a side panel with the files Claude changed, a "This turn" or "All changes" switch, Viewed ticks and find in the diffs. "Open diff" on the changed-files card now opens this panel.
- **Queue or steer while a turn runs.** Enter queues, Ctrl+Enter steers into the running turn, Ctrl+Shift+Enter sends the first queued message now. A refused steer now says so and queues the message.
- **Plan cards show where they come from.** A plan has a status chip (waiting, approved, denied, expired), and permission, question and plan cards say which agent asked.
- **The Model Engine stops early "done".** With Orchestration on, a stop hook blocks "done" if files were edited and no council agent ran after the last edit.
- **Token rules in the kit.** The rules Foreman installs into each project now include short replies, reading only what is needed, and filtering big output.

## Changed
- **Bypass permissions is always selectable** in the chat mode picker and the Shift+Tab cycle.

## Fixed
- **The graph in the narrow panel.** The links are drawn between the cards with rounded corners, and the running-card border no longer shows uneven blocks.

---

# Foreman 4.2.0

**Install:** download the file for your system from the assets below. Foreman keeps itself up to date from these releases.

## New
- **Orchestration mode installs the Model Engine kit into the project.** Its agents, skills and model rules go into the project's own `.claude` folder, so plain `claude` loads them without any Foreman flag. Files the project already has are never overwritten: a different version is kept as it is, and a changed `CLAUDE.md` is backed up to `.claude/.foreman-backup` first. The kit is installed when you switch Orchestration on, when you move the project folder, and when a tile starts.
- **Orchestration adds no extra tokens to each turn** compared with plain `claude`. Its tiles load the project's own kit and nothing else of Foreman's: no Foreman plugin, no mod plugins, and the browser MCP is off.
- **The Orchestration graph state comes from Foreman's own event stream.** Each session's state (the main thread, the builder, the reviewer, the council and the helpers) is worked out from the hook events Foreman already receives. The panel that shows it comes in a later release.
- **Start new project.** A setup dialog with a preset picker (eight presets) suggests agents, MCPs, skills and plugins for your project prompt, and writes the ones you tick into the project folder.
- **The Orchestrator skill names its helpers,** picks a model for each tier, and uses task cards.

## Changed
- **Orchestrator Mode is now called Orchestration** in the top bar, the chat chip and Settings.
- **The name is Foreman.** Operant is now Foreman in the window, the messages and the installers.
- **Foreman no longer learns on its own,** and no longer installs, starts or sets up Hindsight or CodeGraph. They cost tokens and are yours to manage. Add them as ordinary MCPs if you want them. Old settings and backups still load.
- **The hooks stay quiet.** The extra hooks for counting recall calls run only for Orchestration, and the kit writes a line to the log only when it changed something.

## Fixed
- **MCP status marks on Windows.** `claude mcp list` prints a root sign and a times sign there, and the status parser now reads them.

---

# Operant 3.6.1

**Install:** download the file for your system from the assets below. Operant keeps itself up to date from these releases.

## New
- **Orchestrator Mode replaces the fixed Factory levels.** The thread you talk to does the work itself and hands a part to a helper agent only when that saves context or time. No roles to start, no Task Cards. Helpers use the same model, and a chip shows how many are running.
- **`/clear` starts a fresh conversation** in the same thread.
- **The Commands menu runs commands.** A command without arguments has a Run button. Commands that only exist on Claude Code's own screen open the matching Settings page where there is one (`/config`, `/theme`, `/memory`, `/usage`, `/hooks`, `/plugin`).
- **Helpers working in the background are shown.** After the main turn ends, the status line says how many helpers are still working, and the thread, sidebar and Board read Working instead of Idle.

## Changed
- **The usage badge says plan limits are off** (with where to turn them on) instead of "no usage data".
- **The Research preset uses Sonnet** instead of Haiku. A cheaper model that gets it wrong costs more in fixes than it saves.
- **The learning prompts are stricter.** One fact or rule per lesson, user corrections kept first, stale or contradicted lessons replaced, and no secrets, temporary status or raw output.
- **The name is Operant** in the window, the welcome screen, messages and the README. The installer file names are unchanged so updates keep working.
- **The README has a new look and screenshots.**

---

# Operant 3.6.0

**Install:** download the file for your system from the assets below. Operant keeps itself up to date from these releases.

## New
- **Shells open in a drawer at the bottom,** like the Console, and show only the shells of the current project. A Shells button in the sidebar footer shows or hides it. Shells no longer take up a tile.
- **The browser opens at the side** of the thread, as a panel you can drag to any width, with Pop out and Close buttons.
- **The Stop button glows** while Claude is working, in place of the spinning wheel.

## Fixed
- **Helpers start with far less context.** A Leader used to begin at about 115k tokens (77% of its limit) before it did anything, because every tool from your own MCP servers was loaded in full. Helpers (Leader, Builder, Reviewer, Scout, Tester, Design, Release, Learn) now load only Operant's own MCP servers and skip your user-level hooks, plugins and settings. They start at about 13k.

---

# Operant 3.5.0

**Install:** download the file for your system from the assets below. Operant keeps itself up to date from these releases.

## New
- **A new look and layout.** Chats are now threads. The top bar switches between Thread, Board, Plans and Tiles. The sidebar lists each project's threads with a search box, a New thread button and a Settled shelf: a closed chat is kept and can be opened again where it left off. The chat has no frame, with the title and the stage and Factory chips on one line, and a warm Focus theme is the default.
- **Board and Plans.** The Board shows the threads of all your projects as cards: what each is doing, who needs you, and a box to message the selected one. Plans lists the Engineering tasks of every project with their stage.
- **A right rail with Plan, Files and Agents.** The Plan panel shows the plan gate, the slices and the spec. Files lists the changed files and opens the diff. Agents is the old panel.
- **Engineering Mode and Subagent Factory Mode.** Two switches per project in the top bar. Engineering Mode runs a task through frame, spec, slices, plan OK, build and ship, with a stage chip that shows where it is. Factory Mode adds Leader, Builder, Reviewer, Scout and Tester helpers with a Start button for each, and stops a chat from running more than three at once.
- **Edit from here.** Rewind a chat, and optionally the files, to before a message.
- **Compact button and image chips.** When the context is nearly full a Compact button shows; the next message compacts first unless you click to keep the full history. Images show as small chips with a name and size.
- **One Tools and installs page.** Every program, skill and MCP server in one place with where it lives. If Operant cannot find a program it looks in the usual folders, then lets you point at it, also at first start.
- **New keys.** Ctrl+Shift+N starts a thread and Ctrl+K searches threads. Both can be changed in Settings.

---

## Changed
- **The Claude and OpenCode switch is gone from the top bar.** Set your main CLI in Settings, Terminals; each project's menu can start either one.
- **Plan limits are off until you turn them on.** Reading your Claude plan limits sends your Claude Code login token to Anthropic, which its terms may not allow, so it is now a switch in Settings, Tokens and budgets. Until it is on, the plan rings show no figure.
- **Much smaller install.** CodeGraph and the dictation libraries are no longer packed into the installer (about 600 MB less). Install CodeGraph from Settings, Install.
- **Mods are just Mods.** The Claude mods got one list page; Dictation moved to General.
- **Updates check more.** An update needs a checksum from GitHub and a plain version tag, and downloads to your own folder.
- **The README now says what Operant runs and what leaves your computer.** The licence and disclaimer wording in the app, the first-start window and the README now match.

---

## Fixed
- **Indexing no longer freezes the window.** CodeGraph runs in its own thread with a 10 minute limit, so a locked index cannot hang Operant. Index buttons now say when indexing starts, ends or fails, and hide when CodeGraph is not installed.
- **No jump when a chat turn ends.**
- **No crash message when you quit during a turn.**
- **Documents from outside a project are served more safely.** Only pictures, styles and fonts load beside them, and the page cannot fetch other files.
- **More file types are shown in the file manager instead of being run:** `.pyw`, `.rdp`, `.scf`, `.msix`, `.appinstaller` and a few more.
- **Factory Mode no longer blocks every helper after one crashed.** A helper that started more than 15 minutes ago and never stopped is no longer counted.
- **The Agents panel no longer closes itself** when you switch threads, and opening a closed chat twice no longer makes two tabs.

---

# Operant 3.4.2

**Install:** download the file for your system from the assets below. Operant keeps itself up to date from these releases.

## Changed
- **The first-start setup says what Operant runs.** The setup window now explains that most installs run an npm, winget or pip command that puts the tool on your computer, outside Operant. On Windows it also says that Operant runs its own PowerShell scripts with `-ExecutionPolicy Bypass` for media controls and updates. This only applies to those scripts and does not change your computer's execution policy.
- **The README lists what Operant runs on your machine**, so you can read it before you install.

---

# Operant 3.4.1

**Install:** download the file for your system from the assets below. Operant keeps itself up to date from these releases.

## Fixed
- **Claude Code and OpenCode found again after an update.** When the installer reopened Operant after an update, Settings > CLI capabilities said both were "not on PATH", even though they were installed. Operant now adds your own PATH folders back when it starts.
- **Retry looks again properly.** The Retry button under CLI capabilities now reads your PATH again first, so a CLI you just installed shows up without restarting Operant.

---

# Operant 3.4.0

**Install:** download the file for your system from the assets below. Operant keeps itself up to date from these releases.

## New
- **Import cookies from your browser.** Settings > Browser has a button that copies the cookies from your default browser into Operant's browser, so sites you are signed in to stay signed in. It asks once first. Firefox and Chromium browsers (Chrome, Edge, Brave) are supported. Cookies that Chrome locks to itself are skipped, and Operant says how many. If the browser is open and holding its cookie file, Operant asks you to close it and try again.

---

## Changed
- **The Implement role runs on Opus.** It used to run on Sonnet. If you picked a different model for it yourself, that is kept.
- **Enhance prompt sizes the helpers.** When it suggests splitting work into subagents, it now says which model fits each part: Haiku for very small jobs, Sonnet for small edits, Opus for a feature or a normal fix.

---

## Fixed
- **Updates on Windows install properly.** Opening Operant while an update was installing made the update fail and roll back, so you stayed on the old version. Operant now says "Operant 3 is installing an update" and closes again, and the update reopens it when done.
- **One admin prompt per update.** An update that had to wait for another install could ask for admin rights again and again. It now asks once.
- **Failed updates say why.** If an update does not go in, Settings shows the reason next to "Restart to update" the next time Operant starts.

---

# Operant 3.3.0

**Install:** download the file for your system from the assets below. Operant keeps itself up to date from these releases.

## New
- **Messages show when Claude has read them.** A message you send while Claude works says "Queued", then "Seen" the moment Claude reads it.
- **Steer reads your queued messages now.** While messages are waiting, the Steer pill reads "Steer (2 queued)". One click makes Claude stop its current step, read them, and carry on.
- **To-do list above the prompt.** When Claude keeps a to-do list, a card above the prompt shows "To-do" with one bar for the whole list and a line with its own bar for each task. Done tasks are solid green. It is built from Claude's own list, so it uses no tokens.
- **Info row above the prompt.** The context window as a pixel meter with the tokens used, your 5-hour and 7-day usage, and how many agents are running.
- **Artifacts under Right Now.** Everything Claude made in the session is listed: pages, images, documents and links. Click to open images in Operant, pages and links in Operant's browser, and anything else in its usual app. The "..." menu has the other choices.
- **Pixel bars.** A moving pixel bar shows Claude is working, the context meter in the tile header is a pixel meter, and each agent in the Agents panel has a bar: moving while it runs, solid green when done, red when it failed.

---

## Changed
- **A better Enhance prompt.** The rewrite now lists the files to change, the context, what to keep in mind, the skills to load, what to ask you first and when it is done. It also reads the branch and changed files, the last few messages and your soul.md. It shows how many memories and code matches it used, has a Cancel button while it works, and Undo stays until you send. If you type while it works, your text is kept and you choose "Use rewrite" or "Discard".

---

## Fixed
- **Pages Claude saves outside the project open in the browser.** An HTML or Markdown file written to another folder used to be refused; it now opens in Operant's browser.

---

# Operant 3.2.2

**Install:** download the file for your system from the assets below. Operant keeps itself up to date from these releases.

## Fixed
- **"Choose file" works in the browser.** Once an AI had used a project's browser, clicking a page's file upload button opened nothing. It now opens the normal file dialog. The AI still handles file pickers itself while it is acting on the page.

---

# Operant 3.2.1

**Install:** download the file for your system from the assets below. Operant keeps itself up to date from these releases.

## New
- **See what learning costs.** The Learn row in the chat ends with the tokens it used, and the cost when Claude reports it, for example "24.1k tokens ($0.0031)". OpenCode and local models show an estimate marked "about".
- **Learn every N messages.** A new setting in Settings, Learning. Operant learns from a session on its own only after you send this many new messages since its last learn. The default is 10. Set it to 0 to learn after every turn. Closing a tile and Learn now still learn straight away.

---

## Changed
- **Learning reads only what's new.** Each learn reads a session from where the last one stopped, so long sessions aren't sent again and again.
- **Tidy-up runs less often.** Merging and tightening lessons runs when a project has 40 or more lessons, at most once a day, instead of after every learn. Consolidate now still runs it any time.
- **Learn usage counts toward the daily limits.** Learning's tokens and cost now add to the daily totals, so the daily call and spend limits apply to it.

---

## Fixed
- **Long sessions are learned from again.** Message counts on long sessions stopped growing, so automatic learning could stop for them.
- **Learning remembers where it stopped after a restart.**

---

# Operant 3.2.0

**Install:** download the file for your system from the assets below. Operant keeps itself up to date from these releases.

## New
- **Info icons in Settings.** Every setting has a small info icon. Hover it to read what the setting does and what changes when you turn it on or off.
- **Move and resize tiles.** Each tile header has a grip. Drag it onto another tile to swap places, including the browser tile. Drag the gap between tiles to resize them, and double-click the gap to reset.
- **Pop out any tile.** Shells, Claude Code, OpenCode and the browser can each open in their own window with the same live session. Pop back in from the window or the tile.
- **Documents open in the browser.** HTML and Markdown plans, docs and artifacts that Claude creates open in the project's browser. Click a file in Right now to open it. A new "Open documents in the browser" setting turns the automatic opening off.
- **Stop button on subagents.** Each running subagent has a Stop button. In the Chat view it stops just that subagent. Elsewhere it says it stops the whole turn.
- **Running servers list.** A Servers button lists the dev servers your tiles started, with Open in browser and Copy address.
- **Soft two-line shell prompt.** New shell tiles show the folder and git branch on one line and a soft arrow on the next. The arrow turns red when a command fails. A new setting turns it off.
- **Learning shows in the chat.** A "Learn" row appears in the Chat view while Operant learns from the session, then shows what it saved.

---

## Changed
- **Terminals work like a normal terminal.** Selecting text copies it. Right click copies a selection or pastes. Ctrl+Shift+C and Ctrl+Shift+V, Shift+Insert, Ctrl+Insert and Ctrl+Shift+A work. Shift+PageUp, PageDown, Home and End scroll. A new "Right click pastes" setting turns the right click off.
- **Copy on select is on by default.**

---

# Operant 3.1.3

**Install:** download the file for your system from the assets below. Operant keeps itself up to date from these releases.

## New
- **Learning uses your project's memory.** The learn step runs in the project folder, pulls what Hindsight already knows about the project so it doesn't repeat it, and can look things up in CodeGraph when it's on.
- **Hindsight restarts itself.** If Operant's own Hindsight server stops answering, the next recall or save starts it again and retries once. A server hosted elsewhere is never touched.

---

## Changed
- **Simpler Learning settings.** A "What learning did" card at the top, one "When to learn" choice, and the limits folded into a closed group.
- **Simpler Memory settings.** Hindsight and CodeGraph sit together in one Tools card, recall options are folded away, and Export and Reset sit in a Danger zone at the bottom.
- **Memory page.** The status panel opens with one plain line, and lessons are listed newest first.

---

## Fixed
- **OpenCode free models.** Free models such as Big Pickle refused every run Operant started (tiles, jobs and learning), because Operant made session ids OpenCode didn't accept. They now work.
- **Hindsight address shown twice** in the Memory settings.

---

# Operant 3.1.2

**Install:** download the file for your system from the assets below. Operant keeps itself up to date from these releases.

## New
- **Mouse buttons as shortcuts.** Side mouse buttons can now be bound to shortcuts in Settings.
- **Hold to talk.** Dictation can be held down to talk and released to stop.

---

## Changed
- **Faster tidy after learning.** Lessons are tidied and merged more quickly.
- **No waiting for review.** Lessons and skill drafts apply on their own.

---

## Fixed
- **Learning edge cases.** Small fixes to how lessons are stored and merged.

---

# Operant 3.1.1

**Install:** download the file for your system from the assets below. Operant keeps itself up to date from these releases.

## New
- **Learning runs on its own.** Nothing waits for your approval any more. Lessons, skill drafts and fixes to installed skills apply themselves, and every change is recorded so it can be undone.
- **Learning on close.** Closing a terminal learns from it at once. The "learn from this?" question is gone.
- **Tidy after every learn.** After each learn step, lessons whose files are gone are marked stale, stale lessons and rejected drafts older than 14 days are deleted, and similar lessons are merged and tightened.

---

## Changed
- **Merging has no waiting period.** It no longer waits for 40 lessons or 24 hours. Lessons that mention a command or "always" or "never" are kept and merged like the rest.
- **Skills install themselves.** In the default advanced mode, waiting skill drafts and skill fixes are installed.
- **Waiting lessons apply.** Lessons left waiting by an earlier run are activated on the next learn, unless review is set to queue or the mode to suggest.

---

## Fixed
- **A safety check replaces review.** A lesson or skill that holds a download, a pipe into a shell, `sudo`, `rm -rf`, or an order to ignore earlier rules is refused and logged. Links are removed from kept text.

---

# Operant 3.1.0

**Install:** download the file for your system from the assets below. Operant keeps itself up to date from these releases.

**Windows installer change.** The Windows installer now puts Operant in `C:\Program Files\Operant 3` and asks for administrator permission, and it no longer offers another drive. If you installed an earlier version for your user only, the first update to 3.1.0 may not finish by itself. If it does not, download the .msi from this page and run it. After the update the old copy is removed. Your projects, settings and memory are kept.

## New
- **Browser panel.** Each project can open a browser tile with tabs, a toolbar, a pop-out window, an inspector, page prompts and downloads. AI agents can drive it too (open pages, click, read text, cookies, storage, scripts). In confirm mode you approve each action, or choose Allow all for that tile's session.
- **Install page.** Settings has a new Install page that lists every tool Operant can use, with its status and an Install button: Claude Code, OpenCode, uv, Node.js, the Hindsight memory server, CodeGraph, Playwright with the Git, Playwright and CodeGraph MCP servers, the Superpowers skills pack and the dictation speech model. Install shows the exact command and asks you to confirm. A feature whose tool is missing stays hidden.
- **First-start setup.** A one-time window offers the optional tools to install. You can open it again from the Install page.
- **Dictation.** A microphone button under the chat box turns your speech into text, also with Alt+D. It uses a speech model that runs on your computer. The first use downloads the model (about 75 to 150 MB), then it works offline. Dictation has its own settings.
- **Notes.** Sticky notes for each project sit beside your terminals and chats (button under the chat box, or Alt+N). Notes have colours, bold, italic, lists and checklists, and they are saved between sessions.
- **Learn and Steer.** A Learn button teaches Operant from the session you are in right now. Steer sends Claude a short note while it works, without stopping it.
- **A glow and a spinner.** The chat box glows softly, and a small spinner shows, while Claude works or dictation runs.
- **Tokens on every answer.** The Done and Thought lines show how many tokens were used.
- **Click an image to enlarge it.** Images in chat open in a viewer with zoom, copy and save.
- **Screenshots in the chat.** `operant shot <file>` saves a screenshot in the project's screenshots folder and shows it in the chat, where a click opens it large. The end-to-end test screenshots do the same.
- **Currencies.** Choose a currency and type your own rate. Costs and budgets show in that currency.
- **Tidier lessons.** Lessons that say nearly the same thing are merged and tightened into one, related lessons are linked, and what is sent to Hindsight is capped at 20 items a project a day. There is a Consolidate now button on the Memory page, and every merge can be undone from the learning records.
- **Memory from the first message.** With Hindsight and CodeGraph switched on in Settings, Memory, each Claude or OpenCode session starts with your recalled lessons and CodeGraph.
- **OpenCode as the default.** Learning on close, recalled lessons, CodeGraph and the Install page all follow OpenCode when it is your default. OpenCode tiles have no Chat view.
- **Agent names from TV and film.** Agents get names such as R2-D2 and Marvin. Hover a name to see where it is from.
- **Diamond logo.** The diamond is now the program icon, the top bar mark, the welcome screen and the README logo.
- **Dev update channel.** Pushes to dev branches publish a pre-release that only the Dev channel offers.
- **Learning line in the Right now card.** It shows what learning is doing for the current session.
- **Appearance noise setting** and a bundled Figtree font.

---

## Changed
- Lessons now apply by themselves. Only a lesson with a command, a link, or the words always or never waits for your OK. Learning needs at least 500 tokens of conversation.
- Closing a Claude tile asks whether to learn from it, unless you already pressed Learn.
- Learning also starts after a tile has been idle for a set time.
- In the chat box, Learn and the keep-warm line sit on the right, above the box. The microphone sits at the bottom, next to the attachment button.
- Tile headers, info bars and the sidebar footer wrap onto a second row when they get narrow, so no button is cut off.
- A tile now says "Waiting on subagents" while sub-agents are still running, not "Done".
- The chat activity box is gone; its information now lives in the Right now card.
- The bottom terminal drawer that showed over Settings and Memory is gone.
- The Design Picker mod is removed.

---

## Fixed
- After an update with the MSI installer, if the app file was missing, Operant now reinstalls all files.
- The text of long keep-warm lines is no longer cut off.

---

# Operant 3.0.3

Operant no longer runs jobs for you. It is now a home for your coding terminals, with Claude Code and OpenCode side by side, memory that is kept per project, and backups.

**Install:** download the file for your system from the assets below (same files as 3.0.2, with the new version in the name). Operant 3 keeps itself up to date from these releases.

## New
- **Terminals for Claude Code and OpenCode.** Each project opens its agent terminals as tiles. Operant checks which CLI is installed and what it can do, and each tile shows its model and how full its context is.
- **Claude Mods.** A Claude Code tile shows an info bar under its title, and a Subagent Panel lists the sub-agents it starts, running or completed.
- **Soul Bank and project memory.** Keep reusable guidance in the Soul Bank and see what each project remembers, with controls to edit, export and reset it.
- **Learning with modes and rollback.** Learning from a finished session has four modes: Off, Suggest, Controlled and Advanced. Every change it makes can be rolled back, and a Run now button learns from the Claude session you are looking at.
- **Budgets for helper models.** Set limits on the calls and tokens that Learning and the other helper models may use, with a daily dollar cap.
- **Backups and restore.** Make a backup of your data at any time, and restore one from the Settings page.
- **Built-in presets.** Start a terminal from a ready-made preset, or save your own.
- **Superpowers detection.** Operant shows whether the Superpowers plugin is installed for Claude Code.
- **Settings reset.** Put every setting back to its default in one step.
- **Commands menu in the Chat view.** A Commands button lists every slash command. /status, /mcp and /doctor show their results right there, and the commands that only run on Claude Code's own screen say so instead of failing. You can switch it off in Settings, Claude Mods.
- **Activity box.** A small box in the corner of a chat shows when learning is running, and which Hindsight memories and CodeGraph symbols the last prompt enhance used.
- **Deny a plan.** A plan from Claude can be denied, with or without a comment. If you type a message while a plan is waiting, it is sent as the comment, so Claude reads it first.
- **Recover an enhanced prompt.** Right-click Enhance prompt to bring back the last enhanced prompt.
- **Projects flash when Claude waits for you.** A project's row pulses amber while one of its Claude tiles needs an answer.
- **Skills learned from your sessions.** A procedure that worked becomes a skill draft. Approved skills install to your global Claude skills folder, so every session can use them. When a session shows an installed skill is wrong, Operant drafts a fix, and rolling it back restores the old text.
- **Plan usage rings.** The sidebar shows Claude's 5-hour and weekly usage as two rings. Hover over them to see the reset times.

---

## Changed
- **No more Tasks, Master, Discord or operators.** Operant no longer orchestrates work. The Tasks board, the Master Terminal, the Discord bridge, jobs, seats and the operator views are gone, and their saved data is no longer shown.
- Learning talks about sessions instead of jobs.
- **Learning writes to the project's memory automatically** when Review is set to Automatic, with any number of lessons per session. Lessons that mention a command, a link, or always / never still wait for your review.
- Enhance prompt knows Operant's own skills, such as team work with its subagent limits, and never suggests a brainstorming skill.
- Tool calls in the chat have icons, and MCP tools have readable names, such as "CodeGraph · Explore".

---

## Fixed
- Learning notes say "session" instead of pointing at job numbers, which no longer exist.
- Text in a chat box is kept when you switch projects, Settings or Memory.
- Opening a terminal no longer leaves an empty panel at the bottom.
- The "Claude edited" colour shows in the Agents panel.
- The git pill in the sidebar no longer stretches across empty space.

---

# Operant 3.0.2

OpenCode now starts properly as the Master Terminal, finished sessions teach the project's memory on their own, and jobs read much better.

**Install:** download the file for your system from the assets below (same files as 3.0.1, with the new version in the name). Operant 3 keeps itself up to date from these releases.

## New
- **Learning when a session ends.** When an OpenCode Master or one of a seat's Claude terminals finishes, Operant reads what happened and saves the lessons to Hindsight and CodeGraph notes, as it already did for finished jobs and the Claude Master. It follows the learning switch in Settings.
- **Pasted images show in the job.** Images you paste into a new task appear as thumbnails in the job window. Click one to enlarge it.
- **Nicer job pages.** The task, the review summary, your send-back note and the timeline are shown as formatted text, with headings, lists, code blocks and coloured diffs for code changes. The review box has more room.
- **Add to board.** The Master can put a card on the Workspace board with `operant run add <title>`. When you say "add to board", it uses this and no longer the old side-panel Board.

---

## Changed
- **Token limit pause.** A job that passes its team's token limit now says "Token limit reached... Continue, or stop?" with a Continue button, instead of "Master stopped". Cache reads no longer count toward the limit, so short jobs stop running into it.
- **Resume feedback.** The Resume button shows "Resuming..." while it works, and a job paused only for its limit goes straight back to working.
- **OpenCode seats.** The Master's instructions now tell OpenCode to use its Task tool for seats, which carry their preset prompts and the one model you set.
- OpenCode's tabs are switched off when it runs inside Operant. Your own OpenCode settings files are not changed.

---

## Fixed
- **OpenCode Master did not start its job.** The first line was typed before OpenCode had finished loading and was lost. Operant now waits for it to be ready.
- **"Needs you: resume" on a running OpenCode.** A Master that was running fine was marked as not started after a minute. It is now recognised as ready.

---

# Operant 3.0.1

The Workspace is now a task board with a review inbox, the old workspace is the Terminal view, and a job opens in a big, readable window.

**Install:** download the file for your system from the assets below (same files as 3.0.0, with the new version in the name). Operant 3 keeps itself up to date from these releases.

## New
- **Workspace board and inbox.** Your tasks sit in columns: queued, working, needs you, in review and done. An inbox beside it lists what needs you: questions, permission prompts, reviews and failures. The Workspace tab shows a count, you get a toast, and Windows shows a notification when Operant isn't the active window (switch it off in Settings > Top bar > Panels and notifications).
- **Terminal view.** The old workspace is now called Terminal and works like Operant 2.8.2: the Master Terminal is the main tile, subagents open as read-only tiles, and the project's own shells tile beside them. Layout, split, full screen, focus and close all have keys you can rebind. Settings has new Terminal and Tiles sections.
- **Big task window.** Click a task and it opens in a near-full-screen window with room to breathe. The outcome, review summary and question are shown as a readable document: larger type, tables, code blocks, long sections you can fold, and a Copy button.
- **Replies are remembered.** What you typed in the approval note, the send-back reason, a question answer or the New task box stays when you click away and come back, and after a restart.
- **Copy and paste like 2.8.2.** Ctrl+C copies when text is selected (otherwise it interrupts), Ctrl+V pastes, and an image on the clipboard is sent to Claude. Copy-on-select, Ctrl+click on file paths (files in the project open; programs are only shown in their folder, never run) and dropping files to type their paths are options in Settings.
- **Hide the sidebars.** Alt+B hides the project list, Alt+Shift+B hides the Terminal side panel or the Workspace inbox, Alt+Z hides or restores all of them. There are buttons in the top bar and the choice is remembered.
- **Memory for the Master.** `operant memory recall` and `operant memory retain` let the Master and its seats read and write the project's Hindsight memory.
- **Delegation check.** If a task had seats and the Master did the work without using any of them, the review shows a warning.

---

## Changed
- **OpenCode uses one model.** Seats on OpenCode run on the single model you set; there is no per-seat model, and a model you wrote in a project's `.opencode/opencode.json` is never overwritten.
- **Hindsight uses your server.** If Operant's own Hindsight address is empty, it now uses the self-hosted address from your agent plugins' `~/.hindsight/coding-agent.json`. When Hindsight can't be reached, the brief says where it tried.
- The top bar switches to its compact forms at slightly wider windows to fit the new buttons.

---

## Fixed
- Pasted task images are kept out of `git status` and are deleted when you delete the task or the project.
- Changing the main CLI in the New task box clears seats that belong to the other CLI.

---

# Operant 3.0.0

Operant 3 now starts work as runs: pick a project, press Plus, and its Master Terminal acts as your project manager. It runs the task with your seats, asks you questions, and asks you to review the result.

**Install:** download the file for your system.
- **Windows:** `Operant3-3.0.0-windows-x64.msi`. Run it; it installs per user, so there's no admin prompt.
- **macOS:** `Operant3-3.0.0-mac-arm64.dmg` (Apple silicon) or `Operant3-3.0.0-mac-x64.dmg` (Intel). Drag Operant 3 to Applications. The app isn't code-signed, so macOS blocks the first launch: choose *Open Anyway* in System Settings › Privacy & Security, or run `xattr -dr com.apple.quarantine "/Applications/Operant 3.app"` once.
- **Linux:** `Operant3-3.0.0-linux-x64.AppImage` (`chmod +x` it, then run it; Ubuntu 22.04 and later need FUSE 2 first: `sudo apt install libfuse2t64`, or `libfuse2` on 22.04) or `Operant3-3.0.0-linux-x64.deb` (`sudo apt install ./Operant3-3.0.0-linux-x64.deb`).

Masters need their command on your `PATH`: `claude` for Claude Code, or `opencode`. Operant 3 keeps itself up to date from these releases after you install.

**Upgrading from Operant 2:** there is nothing to uninstall first. Your data and settings carry over, and nothing is deleted. Updates arrive in the app from these releases. The old crew, squad and operator screens are gone (see Changed). On macOS the in-app update from Operant 2 can't finish (the app bundle has a new name), so download the DMG once by hand; after that, updates work. On Windows the app doesn't reopen by itself after the first update; start it from the Start menu.

## New
- **The Master Terminal is now your project manager.** Each project's Master answers to you. Tasks from the Plus menu or from Discord reach it as one fixed line. It runs them with your seats as its subagents, asks you questions when it needs an answer, and asks you to review the result with Approve and Send back (typing "approve" in its terminal also works). One task is active per project at a time; the rest wait in order, and a sent-back task goes first. The Master phase, questions and review show on the job cards and the job panel.
- **Close-out after you approve.** The cheap AI you picked does it: Claude Haiku, an OpenCode model or a local LM Studio or Ollama model. It writes the lessons, re-indexes CodeGraph and writes the outcome to Hindsight. Each step is tried on its own, and a failed step can be retried from the job.
- **Run in background.** The old headless run is still there as an opt-in switch on the Plus menu.
- **Playground.** A built-in workspace with no project of its own (folder in the app data folder, Ctrl+Shift+P). It has a Master, runs, review, close-out and a Discord channel like any project. It can't be deleted; "Clear history" empties it.
- **Discord is the Master's channel.** A message in a project's channel goes to that project's Master, and each request gets a named thread. Slash commands: `/newsolo`, `/newteam`, `/stop`, `/restart`, `/status`, `/queue`, `/approve`, `/sendback`, `/answer`, `/resume`, `/master`. Questions and reviews come with buttons. Updates are mirrored by code, so they cost no extra tokens (level: off, results or progress). Each bot has an admins list (only admins can stop, restart, send back or use `/master`) and its own AI choice for replies: Claude, OpenCode or a local server. Connection diagnostics explain problems such as the Message Content intent being off.
- **Built-in team presets.** Build and review, Full team, Research, Bug fix, Design to build and Quality pass. Duplicate, edit, reset or hide them; import and export teams. Save a team from the Plus menu.
- **Git tab.** Status, diffs (unified or side by side), stage and unstage, commit, history, branches, and pull and push. Nothing commits or pushes without a click.
- **One-row top bar and project panel.** A compact top bar with the project name, Workspace, Seats and Memory tabs, a branch chip and one status pill. The project panel follows Operant 2.8.2, with groups.
- **Themes.** All the Operant 2.8.2 themes plus Light, Dark and System, an accent colour, and custom themes you can save, copy, export and import. Terminals and charts follow the theme.
- **Main CLI.** Choose Claude Code or OpenCode in Settings > General; the Plus menu, the Master Terminal and the MCP dialog follow it.
- **OpenCode models** are grouped by provider, with free and not-connected hints, a filter and a Refresh button.
- **Learning AI.** Pick Claude, OpenCode or a local server for learning, with a model, effort and a Test button.
- **Dialogs and layout.** Large dialogs that are never cropped, a UI scale, and panels you can resize.
- **Hidden background windows on Windows.** Operant's own background commands, Claude and Hindsight no longer open console windows.
- **Markdown outcomes.** Job outcomes show as formatted Markdown, in the app and in Discord.
- **Workspace dashboard.** Projects on the left (numbered PRJ#, drag to reorder), a Master Terminal per project in the centre, and job cards on the right. Click a card for the job panel: actions, the agents it used, and a read-only view of each agent's log. The view refreshes every two seconds; it is not a live terminal.
- **Runs and teams.** The Plus menu starts a run, solo or with a team: task text, Master CLI, model and effort, and seats with a count and model each. Runs get a JOB# (from 20001) and move through queued, working, needs you, review, done or failed. Team limits (workers, top model, token budget) are checked and a run over them is refused or, for the token budget, held for you.
- **Claude and OpenCode Masters.** Model and effort lists follow the CLI in use.
- **Seats editor.** Seats (skills, Hindsight, CodeGraph, MCP servers, model, effort) and teams are edited in one page with a node view and a list view.
- **Seeded briefs.** Each run starts with a brief from CodeGraph and Hindsight for the task. If either is down, the job still runs and the brief says which part is missing.
- **Write-back and learning.** Each finished run's outcome goes to the project's Hindsight bank, tagged with files and symbols from the git diff, and CodeGraph re-syncs. A learning step reads the run and writes lessons to Hindsight, CodeGraph notes (kept in Operant's own table) and personal memory files. Lessons wait in a review queue by default. Skill drafts are only installed after you approve them.
- **Memory Manager.** One page to search, filter, edit, merge, mark stale, delete or move lessons, plus Hindsight entries, personal memory and skill drafts, with a learning status panel, a Learn now button and a header badge. Hindsight entries are read-only because Hindsight has no edit or delete call.
- **Hindsight hosting.** Local (as before), Shared (bound to a network adapter you pick, with an API key) or Remote (a URL).
- **MCP servers and status.** List, add, edit, enable, disable and remove servers for Claude and OpenCode, with status and masked secrets. Seats choose which servers they get.
- **Usage page.** Tokens and cost by day, project, job, seat, model and CLI, with filters, trends, per-job agent costs and CSV or JSON export. Daily, project and job budgets warn and hold the queue until you resume. Master runs are counted too.
- **Provider limits.** Claude plan windows (five hour and weekly), OpenCode usage per provider, and z.ai usage when a seat's base URL is z.ai or bigmodel.cn. A header badge shows at 80% or more.
- **Import from Operant 2.8.2.** Usage history, projects and role presets, with a preview, a skipped-rows list, and no duplicates if run twice. The old data is only read.
- **Projects.** Named groups (collapse, rename, drag in and out), delete with a clear note of what is and is not removed (files on disk are never touched), a right-click menu, row buttons, and open in your IDE. What used to be called a crew is now called a project.
- **Terminal and Console drawers.** A Terminal drawer opens a shell in the project folder. The Console drawer shows output from Operant's own background commands.
- **Media bar, clock and status pills.** Media controls on Windows (title, artist, art, progress, previous, play or pause, next, shuffle, volume), a clock and date pill, and an agent-counts pill.
- **Settings and scaling.** A settings gear and a close X (Esc also closes). The UI scales with the window, or set a UI scale from 80% to 200%; Ctrl+=, Ctrl+- and Ctrl+0 change it.
- **.env support.** Optional `.env` for the data folder, background mode, a Discord bot token (`DISCORD_BOT_TOKEN`, `DISCORD_TOKEN` or `BOT_TOKEN`) and a Hindsight URL and key. Secrets are moved into the encrypted store and never logged.
- **Tracker upkeep.** Give a project a tracker file and, when a run finishes, Operant adds it to one open "Update tracker" board job for the project manager (never a duplicate). Switch it off per project or for everything, or use "Update tracker now" in the project menu.

---

## Changed
- **Crew mode is gone.** The crew, squad and operator screens, operator terminals and the Cards, List, Graph and Tiles views are removed. Seats and teams replace them. The old data stays in the database, hidden.
- The Cost tab is replaced by the Usage page.
- Operant is now called Operant 3 and uses the original Operant logo and the orange diamond.
- Lessons wait in a review queue by default, even in automatic mode when a lesson mentions a command, a URL, "always" or "never".
- The built-in full team is now called "Full team".
- Every Plus menu and Discord task now goes to the Master. Use "Run in background" to start the old headless run.

---

## Fixed
- **Slow quit.** Quit now closes quickly: every process Operant started is stopped, working runs are marked interrupted, and no shutdown step waits more than three seconds.
- **Runs stuck after a crash.** Runs left working or needing you at startup now end as failed, the queue moves on, and leftover launch files are deleted. Master runs are recovered too: a task that was working when Operant closed waits for you with a Resume button.
- **A hung learning model** no longer blocks learning: model calls time out after two minutes and the queue continues.
- **Discord project channels.** Messages from allowed users now ask for confirmation before starting a job.
- **Discord outcomes** no longer break when a long outcome message has to be split into pieces.
- **Import validation.** Imported presets are checked against known agents and permission modes; risky settings are flagged in the preview and skipped rows say why.

---

## Known limits
Only tested with fakes, not live:
- Discord on a real server (permissions, thread rate limits, slash commands).
- OpenCode as a full Master, and a full job through OpenCode (checked against OpenCode 2.0.24 only for its commands and agent files).
- A real LAN or Tailscale connection from a second machine to a shared or remote Hindsight.
- The Master gate with a live Master from start to finish. Operant types one fixed line when the Master is idle; a Master that ignores it needs a Retry from you.
- The Claude plan limits and z.ai usage endpoints.
- Learning and close-out against a live Hindsight bank, and the media bar with real playing media.

Other limits:
- Windows hides the consoles Operant starts, but not those started by hooks of other tools in your own terminals.
- On macOS the in-app update from Operant 2 can't finish, so download the DMG once by hand. On Windows the app doesn't reopen by itself after the first update.

---

# Operant 2 2.0.0

The first release of Operant 2: run crews of coding agents as a team, with a live dashboard, a shared job board and a tight grip on token use.

**Install:** download the file for your system.
- **Windows:** `Operant2-2.0.0-windows-x64.msi`. Run it; it installs per user, so there's no admin prompt.
- **macOS:** `Operant2-2.0.0-mac-arm64.dmg` (Apple silicon) or `Operant2-2.0.0-mac-x64.dmg` (Intel). Drag Operant 2 to Applications. The app isn't code-signed, so macOS blocks the first launch: choose *Open Anyway* in System Settings › Privacy & Security, or run `xattr -dr com.apple.quarantine "/Applications/Operant 2.app"` once.
- **Linux:** `Operant2-2.0.0-linux-x64.AppImage` (`chmod +x` it, then run it; Ubuntu 22.04 and later need FUSE 2 first: `sudo apt install libfuse2t64`, or `libfuse2` on 22.04) or `Operant2-2.0.0-linux-x64.deb` (`sudo apt install ./Operant2-2.0.0-linux-x64.deb`).

Operators need their agent's command on your `PATH`: `claude` for Claude Code, or `codex`. Operant 2 keeps itself up to date from these releases after you install.

## New
- **Crews, squads and operators.** A crew is a team working in one project folder. Squads group its operators, and each operator is a Claude Code, Codex or shell session with a stable address such as `lead@shop`.
- **Four ways to see a crew.** Cards (the default), List, Graph (nodes and the messages and handoffs between operators, draggable, positions saved) and Tiles (your own quick terminals in a tiling layout). The choice is remembered per crew.
- **A job board agents can use.** You, your Master Terminal and operators create jobs; operators claim them atomically, with a lease that frees a job if its terminal dies. Jobs can depend on each other. A project manager operator reviews finished work by default, and only jobs with a long estimate wait for your go-ahead.
- **Operators talk to each other.** Each operator gets an `operant` command to message others, read its inbox, and work the job board. Messages are labelled with who sent them, and only the dashboard counts as you, so an agent can't pass on your consent.
- **Role presets.** Project manager, researcher, designer, implementor, senior implementor, tester and reviewer, each with its own model, effort, tools and a short role text. Edit, duplicate or reset any of them. Change a running operator's model or effort right on its card, with a warning about what it costs.
- **A Master Terminal per crew.** Your own Claude Code session with elevated rights on the job board.
- **Token use kept low.** Context size caps, a model chosen per role, only the tools each role needs, one blocking inbox call instead of polling, and per-operator and daily spend caps that pause an operator without killing it. The Cost tab splits spend by kind, model and operator, shows cache hit ratio and cold restarts, and flags waste.
- **Everything is editable.** Crews, squads, operators, presets, jobs, links, messages and scratch terminals can all be edited and deleted. Deleted operators keep their history and are purged once it's safe.
- **Activity, CodeGraph and settings.** A live activity feed, CodeGraph indexing of a crew's project, and settings for budgets, models, shell, updates and rebindable keyboard shortcuts, all applied as you change them.
- **Automatic updates** from GitHub releases on Windows, macOS and Linux.
