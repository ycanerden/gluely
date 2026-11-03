# Gluely

**Open-source GTM architecture.** Your agent does the thinking. Gluely keeps the memory, the rules and the learning loop.

Data got cheap. Search, scraping and enrichment cost cents now. The hard part is the play: who to reach, why now, what to say, when to stop, and what you learned. Gluely is the architecture for that part, and it works the same for B2B and B2C, sales-led and product-led, a founder alone or a whole team.

Gluely isn't an outbound tool, and it doesn't pick your vendors. Bring any scraper, sequencer, CRM, data store and agent. We can recommend, but we never require. Every GTM motion runs the same loop, so Gluely is the base you build on, and your outcomes keep improving your ICP, personas and messaging.

![The Gluely loop](docs/flow.svg)

> **Early preview.** Gluely is at version 0.0.1, phase 0 of 5. The brain works: context, plays, cost checks, draft checks, the customer-data guard, play results, the decision log and brain tests. Signals, the Person 360 database, replies and CRM sync don't exist yet. See [Status](#status).

Green works today, yellow has started, blue is next, grey is a later phase, and white is your own tool or team. [The statecharts](docs/charts/README.md) show how the send gates, Person 360, play arbitration and learning are meant to behave.

## Try it

```bash
git clone https://github.com/ycanerden/gluely.git gluely && cd gluely && npm install && npm link

gluely init ../my-brain --company "Acme" --domain acme.example --market b2b --motion sales_led
cd ../my-brain
gluely            # your home screen
gluely flow       # the loop, drawn from your real state
```

Then open your agent in that folder and run `/setup-gluely`. It maps your stack, asks for read-only connections, analyzes your real deals and challenges your ICP before it writes anything.

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

**A claim earns its weight.** Every proof point and objection says how sure the brain is: `hunch`, `repeated` or `measured`. `repeated` needs two independent sources listed in the file, and `measured` needs the number. An active play can only lean on proof that is repeated or measured, so one good call can't become your whole pitch. `gluely context check` also warns about claims nobody has reviewed in a while, and about "last quarter" where a date belongs.

```yaml
evidence: repeated
sources: [deal-2026-03, call-2026-04]
```

**Customer data stays home.** Before any list goes to an enrichment tool, a scraper or a sender, `gluely guard` sorts it. Customers (anyone who trialed, paid or churned) and look-alike names are held. Investors, people at customers and close relationships go to the teammate who owns them. Only the `clear` file leaves. In B2C it checks people against your user export instead of companies.

```bash
gluely guard exports/list.csv --to "your enrichment tool"
```

**Plays are judged by what they produced.** `gluely results add` records touches, replies, meetings and spend. `gluely results` shows the range a rate could really be, the cost per meeting, and a verdict: under 50 touches it's too early, from 50 a play with no positive reply can die, and at 100 its kill rule decides. Zero replies on email asks where the emails landed before anyone blames the copy. A person makes the final call.

**Product-led too.** The product lifecycle playbook answers a trial ending, a cancel or a downgrade with a stage-specific note. A work address gets a founder's plain note, a personal one gets the brand.

**Set up a play one question at a time.** `gluely plays start` walks you through a playbook: job switch, post engagers, hiring signal, inbound demo request or own network. At each step it shows your options, saves your answer and tells you the honest arithmetic. If you stop, it picks up where you left off. Agents use the same steps with `gluely plays next` and `gluely plays answer --json`.

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

## Your data

- **Your brain stays yours.** It's a private git repo on your machine. `gluely init` refuses to create one inside this public repo, and `exports/` and `transcripts/` are ignored by git. Keep the brain's remote private.
- **The CLI calls nothing.** It never calls a model or another service, and never sends a message. Its only outside command is `git`, run on your own files.
- **Your agent sees what you connect.** When `/setup-gluely` reads your CRM or deals, it reads them through your agent and its model provider. Gluely can't see or limit that, so connect only what you'd show that provider, and keep connections read-only.
- **Most rules are instructions to your agent.** The skills tell it to treat prospect text as data, ask before it sends and never spend without approval. A good agent follows them, but Gluely can't force it. The one hard lock is spending: only a person in a terminal can approve it, and `gluely cost` reports `can_spend: false` until they do.

## Landing page

Open `site/index.html`. It uses no outside scripts. The bricks swap their own tools, and clicking one swaps it yourself. `site/data.js` is generated from `library/` with `node scripts/site-data.mjs`, so the page shows what the CLI really offers.

## Status

Phase 0 of 5: the brain pack.

| Phase | Adds | Status |
|---|---|---|
| 0 | Stack map, onboarding, context, guided plays, tool library, cost checks, decision log, skills, brain tests, customer-data guard, play results | Working |
| 1 | The ledger on any store: Person 360 and Account 360 with buying committees, freshness on every enrichment, content, imports, read-only MCP | Next |
| 2 | Work queue, excuses linked to signals, opt-outs | Planned |
| 3 | Conversations, BDR drafts, reply-to-demo rate | Planned |
| 4 | CRM, transcripts, won and lost, the full loop | Planned |

## Install the skills only

```text
/plugin marketplace add ycanerden/gluely
/plugin install gluely@gluely
```

## License

MIT
