---
name: waterfall
description: Build an enrichment waterfall from the tools a company already has, ordered by its own prices and its own blind tests. Use for /waterfall, before any enrichment run, or when someone asks which data tool to use first.
---

# Build a waterfall

A waterfall tries tools in order and stops at the first good result, so each tool only pays for the people the last one missed. Gluely never calls these tools. You run them through the company's own connections, after `/check-cost`.

Read `../principle-recommend-never-require/SKILL.md` and `../principle-customer-data-stays-home/SKILL.md` first.

## Steps

1. Ask what the job is: contact details (`contact-data`), people and job moves (`person-data`), signals (`signal-data`), the web (`web-research`) or hiring (`hiring-data`).
2. Run `gluely waterfall <job> --json`. It lists the tools the company already named. If it has none, ask which tools they have or pay for. Their company may already have contracts, so ask before suggesting anything. Pass them with `--tools "First, Second, Third"`. Only if they have nothing, show `gluely tools <job> --json`. It's alphabetical, and you never rank it.
3. For each step in `next`:
   - **Price.** Ask what one lookup costs them, and save it with `gluely cost price`. Never use a price from memory.
   - **Blind test.** Put the same 20 people through each tool, from a list that `gluely guard` cleared. For each tool, count `right` (the current company's address or record), `wrong` (an old employer) and `unprovable` (accept-all domains, which no verifier can confirm). Record it: `gluely waterfall test "<tool>" --job <job> --tried 20 --right <n> --wrong <n> --unprovable <n> --json`. Don't let one tool see the others' results first.
4. Run `gluely waterfall <job> --json` again. `order` is ranked by what one real find costs this company, and nothing else. Show `per_person` and `found_share`, and say they assume the tools miss different people.
5. Save the order into the play: run the `save` command with the play's id, then `/check-cost`.
6. When it runs, follow `rules`. Skip people already enriched within the refresh window. Guard the list first. Give each tool only the misses. Verify with `verify_with` before anything counts as found.
7. Re-test every quarter or when a price changes. Data vendors change fast, and so do their hit rates.

## Rules

- The order comes from the company's numbers. Never reorder it because a tool is famous or because you used it before.
- A tool with no test is unproven, not bad. Say so.
- Log the real hit rate after a run: `gluely waterfall test` with the run's counts.
