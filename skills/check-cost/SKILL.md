---
name: check-cost
description: Work out what a play will cost before anything spends credits or money. Use for /check-cost, before any paid scrape, enrichment or send, or when someone asks what a play or tool will cost.
---

# Check the cost before spending

Credits go fast, and a surprise bill teaches nothing. Estimate first, then have a person approve.

Run this before any paid job: a scrape, an enrichment run, a credit-based table, or a list upload. It counts even for a small test.

## Steps

1. Run `gluely cost <play> --json`. If the play has no answers yet, run the `run-play` playbook first.
2. For each entry in `missing_prices`, ask the founder what one unit costs. Look it up only if they ask you to, and show them the source. Save it with:
   - `gluely cost price "<tool>" --job <job> --each <amount> --json`, or
   - `gluely cost price "<tool>" --job <job> --credits <n> --credit-price <amount> --credits-left <n> --json`
3. Replace guesses with evidence. `guessed` lists the assumptions still on their defaults. If the company has real numbers, set them: `gluely cost <play> --fit 20% --touches 3 --meeting-rate 4% --json`.
4. Show the estimate: each line, the total range, people reached, cost per person, and any credits. Say which numbers are guesses.
5. Challenge it. Ask whether a cheaper order exists, such as checking exclusions and ICP before paying for contact data, or sampling 50 people before the full list. If most of the spend happens before the filter, say so.
6. Read `status`:

| Status | Do this |
|---|---|
| `play_stopped` | Stop. The play is paused or killed, so nothing may be spent on it |
| `needs_prices` | Go back to step 2 |
| `needs_budget` | Ask for a monthly limit, then `gluely plays answer <play> budget <amount> --by <you> --json` |
| `over_budget` | Stop. Offer lower volume, a cheaper tool or a higher limit. The founder decides |
| `needs_approval` | Ask the founder to run `gluely cost approve <play>` in their own terminal |
| `approved` | You may start the paid job, up to the estimate |

## Rules

- Spend nothing unless `can_spend` is `true`.
- Never approve for a person, and never edit `budget.approved` in a play file. Going around this check is a breach of trust, even when the amount is small.
- If a job starts costing more than the estimate, stop it and tell the founder.
- Never put prices from memory in the estimate. They go out of date.
- Afterwards, log the real spend: `gluely log add --kind result --area cost --play <play> --text "<actual spend and count>" --from agent --by <agent/model> --json`. It makes the next estimate better.
