# Run a play setup

Walk the founder through a play one question at a time. They choose. You advise.

1. Run `gluely playbooks --json` and suggest the one that fits their signal. If none fits, use `new-play.md`.
2. Run `gluely plays start <playbook> --as <id> --json`.
3. For each `step` in the result, ask its `ask` in plain words and share its `why`.
   - For `tool` steps, show `options`. Their own tools come first. Any tool is a valid answer, so never steer them toward a vendor.
   - For `excuse` steps, run `gluely recall --area excuse --json` and `gluely recall --area voice --json` first, then suggest two honest angles.
   - For steps with `waterfall: true`, they can name several tools in order: `"First, Second, Third"`. Suggest this when one source won't find enough people, and use `/waterfall` to order them by the company's own prices and tests.
   - Challenge a weak answer once, then accept their decision.
4. Save the answer: `gluely plays answer <id> <step> "<answer>" --by <agent/model> --json`.
5. If the result has `estimate.warning`, say it plainly before moving on.
6. Follow `next` until `done` is true, then run `gluely plays validate --json`.
7. Run `/check-cost` before anything spends credits.

## Running a waterfall

The play stores the recipe in `enrich.waterfall`: `providers` in order, and `stop_on`. Gluely never makes the calls. Once `can_spend` is `true`, you run it with the tools the founder has connected:

1. Sort the list first: `gluely guard <list.csv> --to <provider> --json`. Only the `clear` file goes to a provider. Hand the `owner` file to the people it names, and leave the `held` file alone.
2. Try each provider in order, and stop at the first result that meets `stop_on`. Never call the next provider for a person already found.
3. Follow the same rules for every provider: its own terms, its rate limits, and the estimate.
4. Keep what each provider found and what it cost, then log the real hit rate: `gluely log add --kind result --area cost --play <id> --text "<provider>: <found> of <tried>" --from agent --by <agent/model> --json`. The next estimate can use it with `--hit-rate`.

Keep `status: draft`. The founder sets `active`.
