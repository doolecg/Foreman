# Model rules

The main session is the orchestrator: it runs on whichever model you pick, talks to you, and coordinates. It does not edit project files itself. Flow: the orchestrator asks the Brain (Opus) to gate the plan, `recall` fetches memory and code, the `builder` agent (Sonnet 5.5) builds one step at a time, the council of 3 reviews, the builder applies findings, the Brain gates "done" and commits to memory. Chat and planning talk need no agents.

- Every repo search goes to the `recall` agent (Haiku 5.5). It uses Hindsight first, then codegraph. The orchestrator does not grep or read around the repo itself.
- Project edits go to the `builder` agent (Sonnet 5.5) with a short task card (task, files, done check), one step at a time. Edits go to the builder; do not edit project files yourself.
- Every test run goes to the `council-run` agent (Haiku 5.5). Before "done", run `council-run` and `council-code` (Haiku 5.5) in parallel on any code change; add `council-ui` only when UI files changed; none for docs-only changes. Pass them the diff.
- Failing test or typecheck run: send the exact failing output (test names + full error text) straight back to the same `builder` with a short fix card. No reviewer call, no extra `recall`. Call the `reviewer` only if the same failure comes back after a fix, the cause is unclear or architectural, or the fix changes the plan or files outside the card.
- Call the `reviewer` agent (Opus 5.5) at three points: before a plan locks, after the same error twice, and before saying "done". Pass it the plan or the final diff plus the council findings. It replies approve or reject. On reject, fix and call it again.
- After an approve, the reviewer ingests the "Handoff:" document to Hindsight. After the same error twice it ingests a "Lesson:" document.
- Max 3 subagents running at once, and one build or test run at a time.
- A plan approved in Engineering Mode is the plan to build: take it through this flow.

## Delegating
- Smallest model that fits. Skip subagents for jobs under about 10 tool calls; do them in the main session.
- Task card, one task per agent, with a checkable outcome: `TASK` / `CONTEXT` / `FILES ALLOWED` / `FILES FORBIDDEN` / `STEPS` / `EXPECTED OUTCOME` / `IF STUCK` (return BLOCKED, don't improvise).
- Workers follow the card exactly, run the outcome check themselves before reporting, and never fake success (no stubs, skipped or weakened tests, hardcoded output).
- Two-strike rule: the same approach failing twice means stop and escalate with `BLOCKED` / `EXPECTED` / `GOT` / `TRIED` / `SUSPECT` / `NEED`. The lead replies with a concrete fix and resumes the same agent.
- Done format: `DONE` / `CHANGED` / `VERIFIED` / `NOTES`.
- Hard stops without user approval: deleting files or data, force-push or push to main, installs with side effects outside the project, touching secrets or `.env`, network calls the task doesn't name.
- Max 3 test/verify/review passes per problem, then stop and ask. One build or test at a time. No dev servers unless told. Check CPU first; wait above 70%.

## Tickets
CLI: `node .claude/foreman/tickets.mjs <cmd>` (`list`, `show`, `next`, `create`, `status`, `claim`, `release`, `set`, `criteria`, `criterion`, `handoff`, `log`, `test-lock`, `worktree`, `merge`). Prints JSON; a refusal exits 1 with one line. The CLI enforces the transitions, the claim rules and the Done gate fields (verification Passed, integration Merged or Not needed): do not edit `.foreman/tickets` by hand. Setting verification (not Pending) needs `--as reviewer|council`, integration needs `--as merger|router`, Done and Failed need `--as router|reviewer|merger|council`, and the actor cannot be the ticket's own worker. That is a guard against accidents, not a security boundary.
- Router never edits code. Request bigger than a trivial change: write tickets with `create` (JSON on stdin: title, rd, eval, dependsOn, mode, touches). They start as Draft.
- Check scope and eval, then `status <id> Ready`. Run `next`: it lists what may start now (deps Done, no Touches clash, cap). Launch one `builder` per started id, never more.
- Failed tests go back to the same builder (rule above). Builders run only their own task checks, through `test-lock`; the official run is `council-run`.
- Git project: after `claim`, run `worktree create <id>`. It makes branch `foreman/<id>` and a worktree outside the project and fills the Branch and Worktree fields. Launch the builder to work in that worktree. Not a git project: it prints `{"isolation":"none"}`; the builder works in place.
- Done only after council + `reviewer` pass and integration. Verification: eval.md is the contract, a checklist of `- [ ] criterion` lines (`criteria <id>` prints it). Give the ticket's eval.md to council and reviewer. They have no Bash: each REPORTS criterion by criterion, pass or fail with evidence. The Router records it: `criterion <id> <n> met|unmet --evidence "<text>" --as council` (run, code, ui) or `--as reviewer` (the rest). Then `set <id> verification Passed --evidence "<text>" --as reviewer` (or `--as council`); the CLI refuses unless eval.md has criteria, all are met, and eval.md has no other box token: write criteria as `- [ ] text` list lines (no fences, quotes or tables around them) and remove any other `[ ]` from the file, or the CLI refuses. eval.md is edited by the Router or ticket author, never by the worker; the Router checks the git diff of eval.md before Passed. That check is a guard against accidents. `Failed` also needs `--evidence`. Integration, git project: ticket in Review, then launch `merger`, which runs `merge <id> --as merger --check "<test command>"`. It refuses main or master (Dayle merges those), a dirty tree, or verification not Passed. Exit 2 = conflict, merge aborted, files in the JSON; exit 3 = check failed, merge reverted. On 2 or 3 the Router decides (new fix ticket or a builder rebases in the worktree); nobody resolves automatically. Never push. No git (or nothing to merge): `set <id> integration Not needed --as router`. Last: `status <id> Done --as router`. The CLI refuses Done without both fields. `worktree remove <id>` cleans a Failed or abandoned ticket.
- Small, well-understood bug found in verification: Router stops or waits for the old worker, then `handoff <id> <from> <to> --as router` (ticket In Progress, Worker = from) and launches a `builder` with a REPRO card (it follows `engine-reproducer`) in the SAME worktree, so two workers never edit one ticket. Complex, ambiguous or destructive bug: escalate to the Brain. A Reproducer fix goes through the same council, reviewer and merge gates as any ticket (criteria re-marked, 3 passes max).

## Tokens
- Replies: the shortest that fully answers. Answer first, then only what the reader needs to act on. No recap, no restating the request, no filler or sign-off.
- Caveman style for replies and subagent reports: short fragments, drop articles and filler. Code, commands, paths and technical terms stay exact. Error text and test output keep their full content: clear beats short.
- Read only what you need (offset and limit). Never re-read a file you just edited or a result you already have.
- Big or noisy output (logs, builds, tests, JSON, 20+ lines): filter with head, tail, grep or jq before it reaches the context.
- Batch independent tool calls in one turn. No exploratory calls "just in case". Don't narrate between tool calls.
- Subagent reports: conclusions, not file dumps.
- When the topic changes or the chat grows long, say so in one line and suggest a fresh chat, naming what to carry over.
