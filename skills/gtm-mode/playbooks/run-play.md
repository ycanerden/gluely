# Run a play setup

Walk the founder through a play one question at a time. They choose. You advise.

1. Run `gluely playbooks --json` and suggest the one that fits their signal. If none fits, use `new-play.md`.
2. Run `gluely plays start <playbook> --as <id> --json`.
3. For each `step` in the result, ask its `ask` in plain words and share its `why`.
   - For `tool` steps, show `options`. Their own tools come first. Any tool is a valid answer, so never steer them toward a vendor.
   - For `excuse` steps, run `gluely recall --area excuse --json` and `gluely recall --area voice --json` first, then suggest two honest angles.
   - Challenge a weak answer once, then accept their decision.
4. Save the answer: `gluely plays answer <id> <step> "<answer>" --by <agent/model> --json`.
5. If the result has `estimate.warning`, say it plainly before moving on.
6. Follow `next` until `done` is true, then run `gluely plays validate --json`.
7. Run `/check-cost` before anything spends credits.

Keep `status: draft`. The founder sets `active`.
