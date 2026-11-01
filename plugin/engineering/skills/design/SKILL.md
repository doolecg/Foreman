---
name: design
description: Shape modules, interfaces and names before building them. Use when adding a module, changing an interface, or when the code fights the change. Favours small interfaces with deep behaviour and a second option before anything public is fixed.
---

# Design

This skill is for deciding where code lives and what it exposes, before it is written. A good module has a small interface and does a lot behind it. The rule that matters most: design a public interface twice before you commit to it.

## Use when

- You are adding a new module, file group or public function.
- You are changing an interface that other code already calls.
- The code fights the change: every edit forces edits in five places.
- A name or term is unclear and people use two words for one thing.
- Skip when the change sits inside one function and touches no interface.

## Steps

1. Read the code around the change and the project's own words for its concepts.
   - Check the existing glossary first.
   - If there is none, keep a short one in `.foreman/engineering/<task-name>/notes.html`.
2. List what callers must know to use the module correctly, and make that list shorter.
   - Inputs, outputs, order of calls, errors, config and speed limits all count.
3. Apply the deletion test. Picture the module deleted.
   - If the complexity vanishes, it was a pass-through, so remove it.
   - If the complexity spreads to many callers, the module earns its place.
4. Place seams with care.
   - One adapter behind an interface is a hypothetical seam, so do not add it.
   - Two real adapters make a real seam. Pass dependencies in and return results instead of hiding side effects.
5. Design it twice. Sketch a second option that is quite different from the first.
   - Compare them on caller effort, where bugs would hide and how easy tests are.
   - Pick one and say why in one or two lines.
6. Set the contract: validate input at the boundary only, make changes additive so old callers keep working, and use one error format everywhere.
7. Record the plan in `.foreman/engineering/<task-name>/notes.html` as a short HTML page.
   - Put in the chosen interface, the rejected option and any new terms.
8. Write a decision note only when the choice is hard to reverse, surprising to a future reader and a real trade-off.
   - If any of the three is missing, skip the note.
9. Hand the interface to the build step. Tests will cross the same interface, so check it is easy to test.
   - Accept dependencies instead of creating them inside the module.
   - Return results instead of changing hidden state.
   - Fewer functions and fewer parameters mean fewer tests.

## Rules

- Name things with the project's own words. Do not invent a second word for an existing concept.
- The interface is the test surface. If you must test past it, the module has the wrong shape.
- No seam, option or setting for a case that does not exist yet.
- Keep the glossary to terms and meanings. No implementation detail in it.
- Do not rename or move existing code unless the task needs it.
- Match the surrounding structure and style of the repo.
- A public interface is a promise. Prefer adding over changing, and never remove without asking.
- Write the notes as a plain HTML page, not markdown, and keep them short.

## Stop and ask

- Three verify passes failed on the same problem.
- Two designs are close and the choice changes the work. Give a recommendation first.
- The change breaks callers or a public interface.
- Anything risky or irreversible, such as removing or renaming something others use.
- A wrong guess would be costly.

## Excuses and answers

| Excuse | Answer |
|---|---|
| I will add an interface now in case we need a second one. | One adapter is a guess. Add the seam when a second one exists. |
| The first design is fine. | Sketch a different second one. It takes minutes and often wins. |
| A wrapper makes the code tidy. | If deleting it moves nothing to callers, delete it. |
| I will name it my way. | Use the project's words so the next reader finds it. |
| Every choice needs a decision note. | Only hard-to-undo, surprising, real trade-offs. Others are noise. |
| I will validate input in every layer. | Validate at the boundary once. Inside, trust the parsed value. |
