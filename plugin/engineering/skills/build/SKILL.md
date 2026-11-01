---
name: build
description: Build an approved task one slice at a time, test first, with the project compiling after every slice and a short local commit each time. Use when a slice list exists and it is time to write the code.
---
This skill turns an approved slice list into working code, one small slice at a
time. The one rule that matters most: finish and prove one slice before you start
the next, and never leave the project broken between slices.

## Use when
- A slice list exists at `.foreman/engineering/<task-name>/slices.html` and the
  user has approved it.
- The next unticked slice is ready to be coded.
- The user says to build, implement or continue the task.
- Skip when there is no approved slice list (use slice first), or the change is a
  one-line fix.

## Steps
1. Open `.foreman/engineering/<task-name>/slices.html`. Pick the first slice that
   is not ticked. State it in one line: what it adds and how you will know it
   works.
2. Check the working tree holds only this task's changes. Check you are on the
   current dev-<version> branch. Do not switch branches.
3. Write the check first, using the test-first skill. Run that one test file and
   watch it fail for the right reason.
4. Make the smallest change that turns the check green. Match the style of the
   code around it.
5. Run the compiler or type check, then the one relevant test file. Repeat steps
   3 to 5 until the slice does what it said.
6. Check CPU load. If it is above about 70 percent, wait. Then run the full test
   suite once, on its own. Quote the result.
7. Tick the slice off in `slices.html`. Add anything you noticed but did not touch
   to the "noticed but not touching" list in
   `.foreman/engineering/<task-name>/notes.html`.
8. Make one local commit for the slice with a short plain message, such as "Add
   retry limit to export". No AI attribution line.
9. Move to the next slice. When all are ticked, report in a few lines: what was
   built, what was run and its result, what was not checked, and one line naming
   the noticed-but-untouched items.

## Rules
- One slice at a time. If a slice grows, stop and split it in the slice list
  before you go on.
- The project must compile and the full suite must pass at the end of every
  slice. A red slice is never committed.
- Run one build or test command at a time, never in parallel. Do not start a dev
  server unless the user asked.
- Do not touch unrelated code. No reformatting, renaming or tidying outside the
  slice. A bug under 5 lines in any file may be fixed; report it in one line.
- No stubs, no TODO placeholders, no fake data, no hard-coded results to get a
  check green.
- Commits are local only, on the current dev-<version> branch. Leave publishing
  to the user.
- Do not add a feature, option or setting the slice did not ask for. Mention the
  idea in one line instead.
- Anything visual: take a screenshot before and after the change. Mark anything
  not seen in the running app as unverified.

## Stop and ask
- The same check has failed three verify passes in a row (one pass is one run of
  checks plus the fix).
- The slice needs a file or change outside the approved scope.
- The next step is risky or cannot be undone: deleting data, changing a stored
  format, touching secrets.
- A wrong guess would be costly: an unclear spec, or two readings that mean
  different work.
- A new dependency or tool seems needed. Ask the user before adding anything.

## Excuses and answers
| Excuse | Answer |
|---|---|
| "I will test it all at the end." | A bug in slice 1 makes slices 2 to 5 wrong. Prove each slice before the next. |
| "These slices are small, I can do two at once." | Then they were one slice. Do one, commit, then the next. |
| "The suite is slow, I will skip it this time." | The full run once per slice is the deal. Run it, alone, and quote the result. |
| "That nearby code is ugly, I will fix it while I am here." | Write it on the noticed list. The slice stays about one thing. |
| "I will commit everything at the end." | One commit per slice keeps each step easy to undo and easy to read. |
| "It compiles, so it works." | Compiling is the floor. The check you wrote first is the proof. |
