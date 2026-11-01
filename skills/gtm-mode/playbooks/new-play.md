# New play

A play is a hypothesis you can kill, not a campaign.

1. Get the idea in the founder's words.
2. Name the signal. If it's new, add it under `extensions.signals` in `workspace.yaml`.
3. Estimate volume honestly: how many people per month survive ICP and exclusions? Write the arithmetic down. If 100 touches would take more than a quarter, say so and suggest a stronger or wider signal.
4. Write the excuse. If you can't make it honest and specific, stop here.
5. Run `gluely plays new <id> --json`, then fill the file:
   - `hypothesis`: who, why now, what you expect
   - `audience`: personas and ICP band
   - `excuse.variants`: two at most
   - `action.tool`: whatever the founder already uses
   - `kill`: when to give up, decided now
6. Run `gluely plays validate --json` and fix every error.
7. Keep `status: draft`. The founder sets `active`.
