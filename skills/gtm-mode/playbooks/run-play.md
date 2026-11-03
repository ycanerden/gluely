# Run a play setup

Walk the founder through a play one question at a time. They choose. You advise.

1. Run `gluely cookbooks --json` and `gluely playbooks --json`. For a target-account list, use the `find-accounts` cookbook. Otherwise suggest the playbook that fits their signal. If none fits, use `new-play.md`.
2. Run `gluely cookbooks start <id> --json` for a cookbook, or `gluely plays start <playbook> --as <id> --json` for any other playbook. The questions after that are the same.
3. For each `step` in the result, ask its `ask` in plain words and share its `why`.
   - For `tool` steps, show `options`. Their own tools come first. Any tool is a valid answer, so never steer them toward a vendor.
   - For `excuse` steps, run `gluely recall --area excuse --json` and `gluely recall --area voice --json` first, then suggest two honest angles.
   - For steps with `waterfall: true`, they can name several tools in order: `"First, Second, Third"`. Suggest this when one source won't find enough people.
   - Challenge a weak answer once, then accept their decision.
4. Save the answer: `gluely plays answer <id> <step> "<answer>" --by <agent/model> --json`.
5. If the result has `estimate.warning`, say it plainly before moving on.
6. Follow `next` until `done` is true, then run `gluely plays validate --json`. If the result has `list`, that file is only a header. Leave the rows empty until a person approves the cost.
7. Run `/check-cost` before anything spends credits. After `can_spend` is true, the agent may fill `list.file` with the columns in `list.columns`. Gluely still makes no calls. Commit `plays/<id>.yaml` and the list only when the founder asks.

## Running a waterfall

The play stores the recipe in `enrich.waterfall`: `providers` in order, and `stop_on`. Gluely never makes the calls. Once `can_spend` is `true`, you run it with the tools the founder has connected:

1. Skip excluded companies first: `gluely check company <domain> --json`.
2. Try each provider in order, and stop at the first result that meets `stop_on`. Never call the next provider for a person already found.
3. Follow the same rules for every provider: its own terms, its rate limits, and the estimate.
4. Keep what each provider found and what it cost, then log the real hit rate: `gluely log add --kind result --area cost --play <id> --text "<provider>: <found> of <tried>" --from agent --by <agent/model> --json`. The next estimate can use it with `--hit-rate`.

Keep `status: draft`. The founder sets `active`.
