---
name: frame
description: Agree what is being built before any plan or code. Asks only the decisions that change the work, in one round, with a recommended answer each, then restates the goal. Use when a request is vague, has open choices, or could mean different work.
---

This skill turns a fuzzy request into an agreed goal. You look up every fact yourself and ask the user only for decisions. The rule that matters most: never start a spec or code until the user has said yes to a three-line restatement of the goal.

## Use when

- The request says what to build but not for whom, why, or how success is judged.
- Two or more reasonable designs exist and the choice changes the work.
- You catch yourself filling in a gap with a guess.
- Skip when the request is clear and small (a rename, a typo, a one-line fix) or the user has already given a full spec.

## Steps

1. Read first. Look in the code, the docs and the task folder for the facts. Anything you can find yourself is never a question.
   - Facts: what exists, what a command does, what the code does today. You find these.
   - Decisions: what the user wants, which trade-off they prefer, what to leave out. You ask these.
2. Write down your best reading of the goal in one sentence, and what is still missing: who it is for, why now, what success looks like, the binding limit.
3. List every open decision. Drop any whose answer would not change the work. Drop any you could settle by reading.
4. Ask the whole open set in one round. A decision that depends on another open one waits for the next round. Use this shape for each question, worded so a plain "yes" accepts the first option.
   ```
   Q1. <short title>: <the question in one or two sentences>
   a) <recommended answer> (recommended, with a one-line why)
   b) <option>
   c) <option>
   ```
5. Wait for the answers. Fold them in, then check whether new decisions opened up. Ask a second round only if they did.
6. Stop asking when you could predict the user's next three answers. If you cannot after three rounds, say what is missing and ask whether to step back.
7. Restate the agreed goal in three lines and ask for a clear yes.
   ```
   Build: <what, in one line>
   For: <who, and why it matters now>
   Done when: <the check that can fail>
   ```
   "Whatever you think" or "sounds good" is not a yes. Offer two concrete options instead.
8. Write the agreed goal into notes.html in the task folder `.foreman/engineering/<task-name>/`, with two short lists.
   - Assumptions: each one line, each something you chose without asking.
   - Not doing: the things you will leave out, so nobody expects them.
   Then hand over to `spec`.

## Rules

- Ask only what changes the work. A question with an obvious answer is noise.
- One round, not a drip of single questions. Never more than 4 options on a question.
- Facts are your job. Decisions are the user's. Never ask the user to look something up.
- Every question carries your recommended answer. Say in one line why you recommend it.
- If the user's idea looks weak, say so once with the concrete downside and a better option. If they answer "just do it", build it their way and note the risk in one line.
- Test a fuzzy term with one concrete example. If the user's words and the code disagree, point it out and ask which is right.
- Use the project's own words for things. Do not invent new names.
- Plain text only. No emoji markers, no headers on short answers.

## Stop and ask

- Three failed verify passes on the same problem.
- Anything risky or irreversible would follow from the answer.
- A wrong guess would be costly and you cannot find the fact yourself.
- The user's answers contradict each other or the code.
- The user has gone quiet or says "whatever you think" twice. Do not treat that as a yes.

## Excuses and answers

| Excuse | Answer |
| --- | --- |
| "I will ask one question at a time to be polite." | Ask the whole open set at once. It saves the user time. |
| "I will ask the user to check the config." | Read it yourself. Ask only decisions. |
| "I will list ten options so they can choose." | Four at most, best first. More options is a worse question. |
| "The request is clear enough, I will assume." | If a wrong guess costs real work, ask. If not, state the assumption and go. |
| "They said sounds good, so that is a yes." | Not a yes. Restate in three lines and get a clear one. |
| "More questions will make me surer." | If you can predict the next three answers, stop. |
