# Gluely

**An open-source GTM brain.** Your agent does the thinking. Gluely keeps the memory, the rules and the learning loop.

Gluely isn't an outbound tool, and it doesn't pick your vendors. Bring any scraper, sequencer, CRM, data store and agent. We can recommend, but we never require. Every GTM motion runs the same loop, so Gluely is the base you build on, and your outcomes keep improving your ICP, personas and messaging.

![The Gluely loop](docs/flow.svg)

Green works today, yellow has started, blue is next, grey is a later phase, and white is your own tool or team. [The statecharts](docs/charts/README.md) show how the send gates, Person 360, play arbitration and learning are meant to behave.

## Try it

Gluely is not on the npm registry yet. From a checkout:

```bash
git clone <this-repo> gluely && cd gluely && npm install

npx . cookbooks
npx . init ../my-brain --company "Acme" --domain acme.example --motion sales_led
cd ../my-brain
npx ../gluely cookbooks start find-accounts
```

`find-accounts` is the first cookbook. It asks who belongs on a target-account list, how many accounts, and which research tool to use. Any tool name works. The answers land in `plays/find-accounts.yaml`, and an empty `lists/find-accounts.csv` is the list your agent fills after you approve the cost. Commit both in that private repo when you want to keep them. Gluely does not call the research tool, host the list, or open a pull request.

`npm link` inside the checkout puts `gluely` on your PATH, so the same commands work without `npx`.

Then open your agent in that folder and run `/setup-gluely`. It maps your stack, asks for read-only connections, analyzes your real deals and challenges your ICP before it writes anything. `gluely flow` draws the loop from the workspace's real state.

## How it works

**The brain asks, your agent reasons, the brain validates.** The CLI never calls a model, and it never sends a message.

| Layer | What it is | Who owns it |
|---|---|---|
| Skills | `/setup-gluely`, `/gtm-mode`, `/check-cost`, playbooks, principles | Open source |
| CLI | Rules, checks and tests. Every command supports `--json` | Open source |
| Brain | `context/`, `plays/`, `tests/`, `learning/`, `prices.yaml` | You, in a private repo |

**Every correction becomes a test.** At startup volume, rates are mostly noise, but corrections aren't. Tell the brain it got something wrong and it keeps the lesson:

```bash
gluely test add --kind reply --input "Who else uses this?" --expect question
gluely test          # compares this context version with the last, and fails on a regression
```

**Set up a play one question at a time.** `gluely cookbooks` lists the short paths, and `gluely plays start` walks any playbook: a target-account list, job switch, post engagers, hiring signal, inbound demo request or own network. At each step it shows your options, saves your answer and tells you the honest arithmetic. If you stop, it picks up where you left off. Agents use the same steps with `gluely plays next` and `gluely plays answer --json`.

**Waterfalls are recipes, not calls.** At the contact step, name several tools in order, such as `Findymail, Hunter, Treg`. The play stores the order and the stop rule, `gluely cost` prices each try, and your agent runs it through your own connections after approval. Gluely still makes no calls.

**Know the cost before you spend a credit.** `gluely cost <play>` works out the monthly bill from your own prices, which stay in your workspace. A missing price stays missing and is never counted as free. It warns you when most of the money goes before your ICP filter, and when a kill rule would take too long to trigger. Spending needs a budget and a person's approval in a terminal, and that approval lapses when a price or the volume changes. `/check-cost` is the skill your agent runs first. Gluely can't stop a tool from spending, so this is a check your agent follows, not a lock on your accounts.

**It learns how you write.** Each play answer and test correction lands in `learning/log.jsonl` on its own, and your agent logs each edit and preference with `gluely log add`. `gluely recall --area voice` gives your agent those lessons before it writes, and `--scope` keeps each person's voice separate. `gluely learn` shows what keeps coming up, so you can promote it into a rule that `gluely check draft` enforces. You approve every promotion.

```bash
gluely log add --kind correction --area voice --scope can \
  --before "Quick question" --after "One question" --why "Too salesy"
gluely recall --area voice --scope can
gluely learn
```

**A tool library that ranks nobody.** `gluely tools` lists tools by the job they do, in alphabetical order, with yours first. Add your own with `gluely tools add`, or type any tool at any step. The library holds no prices and no scores.

**Keep your stack.** `gluely stack set store Snowflake` works, and so does `gluely stack set store "a spreadsheet"`. See [docs/stack.md](docs/stack.md) for options and [docs/store-contract.md](docs/store-contract.md) for how any data store will plug in.

**Build on it.** Add your own signals in `workspace.yaml`, your own plays in `plays/`, and your own tests in `tests/`, with no change to core.

## Landing page

Open `site/index.html`. It uses no outside scripts. The bricks swap their own tools, and clicking one swaps it yourself. `site/data.js` is generated from `library/` with `node scripts/site-data.mjs`, so the page shows what the CLI really offers.

## Status

Phase 0 of 5: the brain pack. [Cargo](docs/peers/cargo.md) is a peer product. This note is about that product, not Habitat workshops. The cookbook above is the part of their install-to-list demo Gluely does in the open.

| Phase | Adds | Status |
|---|---|---|
| 0 | Stack map, onboarding, context, guided plays, tool library, cost checks, decision log, skills, brain tests | Working |
| 1 | The ledger on any store: Person 360, content, imports, read-only MCP | Next |
| 2 | Work queue, excuses linked to signals, opt-outs | Planned |
| 3 | Conversations, BDR drafts, reply-to-demo rate | Planned |
| 4 | CRM, transcripts, won and lost, the full loop | Planned |

## Install the skills only

```text
/plugin marketplace add <this-repo>
/plugin install gluely@gluely
```

## License

MIT
