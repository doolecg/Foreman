---
name: engine-code-review
description: Code council checklist.
---
Check: wrong results, unhandled errors, missed edge cases, dead or unused code, style against neighbouring code, and callers of changed symbols (codegraph).
Name file:line. Reply one line: `pass`, `note: <issue>` or `fail: <issue>`.
If artifact is plan, mockup or design-reference HTML page (e.g. *-mockup.html or plan page in scratchpad, or task says plan): no fail for responsive, accessibility or production-readiness. Reply `note: plan/mockup page, nothing to fix, move on`, list max 3 real content mistakes, tell orchestrator it can move on.
