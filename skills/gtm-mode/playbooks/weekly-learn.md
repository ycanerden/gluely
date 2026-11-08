# Weekly learning

This is the recursive loop: outcomes change context, tests protect it, and the next round is compared with the last. `gluely retro` does the bookkeeping. You do the reasoning, and the founder decides.

## 1. Bring the week in

Add each play's numbers from the sender's daily stats, one batch per day that had activity:

```bash
gluely results add <play> --on <YYYY-MM-DD> --touches <n> --replies <n> --positive <n> \
  --meetings <n> --unsubscribes <n> --spent <n> [--variant <v>] --json
```

- Pass `--variant` when the sender split the play's excuse variants, one batch per variant. Without it, nothing can be said about which variant works.
- Skip days already added, and read `warnings` if one repeats. A whole week as one batch lands on one day in the dashboard.
- Label new replies with `triage-replies.md` first. A positive count you guessed makes everything after it wrong.

## 2. Read the retro

Run `gluely retro --json`. It writes nothing. It returns:

- `for_you`: decisions for the founder, ranked and numbered. Each has `why`, `evidence` and `actions`, and each action names who approves it (`needs`) and the command (`next`).
- `for_your_agent`: your work first, such as tests to re-answer after a context change.
- `collecting`: plays with too few touches to say anything, and how many more they need.
- `held_back`: context changes past this week's limit of three.

Do `for_your_agent` before you show the founder anything. If `brain-tests.md` changes the result, run the retro again.

## 3. Prepare each decision, don't make it

Go through `for_you` in order. For each one:

- **Fix a regression.** Find which part of the last context change broke the case, propose the fix or the revert on a branch, and show the failing case.
- **Check or fix deliverability.** Ask where the test emails landed. No verdict on the play until that's answered.
- **Decide on a play.** Show the numbers, the range the rate could really be, and what Gluely suggests. Ask the founder for the verdict and the reason in their words, then run `gluely plays close <play> --verdict <kept|paused|killed> --why "<their reason>" --json`. Never choose the verdict yourself.
- **Scale a play.** More volume changes the cost, so run `gluely cost <play> --json` with the new volume. Only the founder can approve, in a terminal.
- **Change variants or fix a play.** Draft the new copy, check it with `gluely check draft`, and show it next to the losing version. The founder approves the copy.
- **Ban a word, or write lessons into context.** Propose the smallest change on a branch with the evidence listed, add a test with `gluely test add`, and run `gluely test --json` on the branch. A change that makes a test worse doesn't ship. After the founder merges, promote the lessons with `gluely log promote <id> --to <file> --json`.
- **Review claims.** Ask whether each one still holds. Never raise a claim's evidence so a play can use it.

Read `principle-small-samples-lie` before you say anything is working. If the retro calls something `unclear` or puts it under `collecting`, say that out loud instead of guessing.

## 4. Close the week

1. After the founder merges, re-answer the cases with `gluely test pending --json`, then `gluely test --json`. The next context version starts collecting results.
2. Run `gluely retro --json` once more. Decided plays drop out until new numbers arrive, so what remains is what is still open.
3. Finish with `gluely flow`, and tell the founder what the brain changed its mind about this week in one sentence.
