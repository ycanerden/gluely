# Weekly learning

This is the recursive loop: outcomes change context, tests protect it, and the next round is compared with the last.

1. Run `gluely doctor --json`, `gluely test --json` and `gluely learn --json`.
2. Gather the week's evidence: review rejections, reply labels, call notes, won and lost reasons. Add each play's numbers with `gluely results add <play> --on <YYYY-MM-DD> --touches <n> --replies <n> --positive <n> --meetings <n> --spent <n> --json`, one batch for each day that had activity, using the sender's daily stats. A whole week added as one batch lands on one day in `gluely dashboard`. Skip days already added, and read `warnings` if one repeats. Then read `gluely results <play> --json`.
   - `check_deliverability` or `fix_deliverability` comes first. Zero replies is often spam placement, not bad copy.
   - `kill` is a suggestion. Show the numbers and the range the rate could really be, and the founder sets `status: killed`.
3. Separate what's solid (repeated corrections, the same objection in several calls) from noise (small rate differences).
4. Propose at most three context changes, on a branch, each with its evidence and the test that proves it.
5. Run the brain tests on the branch. A change that makes a test worse doesn't ship.
6. The founder merges. The next context version starts collecting results.
7. Finish with `gluely flow`, and say what changed in one sentence.
