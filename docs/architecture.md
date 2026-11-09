# Architecture

Status: draft for discussion. Each part says whether it **works**, is **partial**, or is **proposed**.

Gluely is to GTM what dbt is to data. dbt stores no data and runs no compute, but it gives every company's messy, custom data work one project shape, one vocabulary and tests. Gluely stores your GTM memory in your own repo, holds the rules, and makes every play a test you can learn from. Your agent does the thinking, and your tools do the work.

## The whole thing on one page

```text
                 YOUR AGENT  (any agent you already use)
                 reads skills, reasons, proposes
                        │ ▲
             asks, runs │ │ answers, validates
                        ▼ │
  ┌─────────────────── GLUELY ────────────────────┐
  │                                               │
  │  CLI      every verb, --json, same for humans │
  │  RULES    gate · checks · cost · judge · tests│
  │  WORDS    the fixed vocabulary                │
  │                                               │
  │  WORKSPACE (your private git repo)            │
  │   context/  plays/  tests/  learning/         │
  │                                               │
  │  IN DOOR: mapping        OUT DOOR: gate       │
  └──────▲───────────────────────────┬────────────┘
         │ your data, mapped         │ only what's clear
         │                           ▼
     CRM, product, exports     enrichment, scrapers, senders
     (your tools)              (your tools)
```

Gluely makes no calls. The agent carries data through the two doors with your own connections. Gluely decides what may pass.

## Six parts, one job each

| Part | Job | Where | Status |
|---|---|---|---|
| **Vocabulary** | The fixed nouns every company shares | `src/vocab.js` | Partial |
| **Workspace** | The company's memory, versioned in git | your private repo | Works |
| **In door: mapping** | Turns your custom CRM into the vocabulary | `mapping.yaml` | Proposed |
| **Out door: gate** | Decides what may leave, and holds when in doubt | `src/guard.js` | Works. Holds when in doubt, and reads columns by a heuristic until the mapping exists |
| **The loop** | Runs every experiment the same way, and keeps what it taught | plays, results, log, tests | Works for plays, partial for experiments |
| **Skills** | Tell any agent how to think about GTM | `skills/` | Works |

If a feature doesn't fit one of these six, it belongs in a workspace or an extension, not in core.

## 1. Vocabulary: small and fixed

These are the nouns Gluely understands. Every company maps its own world onto them, and nothing company-specific is added to them.

| Noun | Meaning | Status |
|---|---|---|
| `person`, `company` | Who | Partial: only as rows in lists and exclusions |
| `signal` | Why now. A company can add its own under `extensions.signals` | Works |
| `claim` | Something the brain believes, with evidence `hunch`, `repeated` or `measured` | Works |
| `play` | A hypothesis you can kill. **An experiment is a play** | Works |
| `touch`, `reply`, `meeting` | What happened | Partial: counts per play, not per person |
| `case` | A test: an input and the answer a human expects | Works |
| `lesson` | A human correction, waiting to become a rule | Works |
| `stage` | Where a person or company stands: `lead`, `in_conversation`, `customer`, `former_customer` | Proposed |
| `relationship` | Who owns the contact with someone, which isn't always the CRM record owner | Proposed |

Two nouns are proposed, because the tryout's HubSpot mapping found nothing to map deal stages and "in a conversation with sales" onto. The test for adding a noun: can three very different companies all use it? If only one can, it goes in their workspace.

## 2. Workspace: the memory

```text
my-brain/                    private git repo, one per company
  workspace.yaml             company, market, motion, stack, extensions
  mapping.yaml               PROPOSED: your fields → the vocabulary
  team.yaml                  PROPOSED: people, roles, what each can approve
  context/                   what the brain believes (claims). A human approves changes
    company.md icp.md positioning.md
    personas/ proof/ objections/ messaging/ exclusions/
  plays/                     experiments, one YAML each
  tests/                     cases: every correction becomes one
  learning/                  append-only ledgers, never edited
    log.jsonl                decisions, corrections, lessons
    plays.jsonl              what each play produced
    results.jsonl            agent answers to test cases
  prices.yaml                your own prices. The library holds none
  exports/                   lists in and out. Ignored by git
```

Three rules hold the memory together:

- **Context is versioned.** The context version is the git hash of `context/`. Every record in `learning/` is stamped with the version it was made under and `by` (who or which model). That's how Gluely can say "this change made the brain better".
- **Ledgers are append-only.** Promoting or dropping a lesson adds an event and never edits one.
- **Context changes need a human.** The agent proposes on a branch, and a person merges.

## 3. The in door: mapping (proposed)

Every company's CRM is custom. That isn't a problem to fix, it's the reason Gluely exists. A company doesn't change its CRM for Gluely. It writes a mapping once, and everything downstream speaks the vocabulary.

```yaml
# mapping.yaml: written by the agent from your real schema, approved by a human
source: hubspot-contacts
identity: { email: Email, domain: "Company Domain", company: "Company Name", owner: Owner }
stage:
  from: "Lifecycle Stage"
  values:
    "SQL - Qualified v2": in_conversation
    "Customer": customer
    "Former Customer": former_customer
signal:
  from: "Source Detail"
  values:
    "LinkedIn comment on CEO post": signal.post_engagement
    "Signed up for free trial": signal.inbound_signup
unmapped: hold        # anything not listed is shown to a human, never guessed
```

How it fits the rest:

- **Onboarding means writing the mapping.** `/setup-gluely` reads your schema, drafts `mapping.yaml`, and turns a few real records into tests ("record 3 must map to `former_customer`"). A human approves.
- **The gate reads the mapping.** Today the gate reads headers by what they mean (`Work Email`, `Company Domain Name`, `Associated Company`), reads any email or LinkedIn profile wherever it sits, and lists the columns it read nothing from under `unread_columns`. A customer export that loads nobody is refused. That closes the tryout leaks, but it's still a mapping in disguise: a human-approved `mapping.yaml` replaces the guessing.
- **Unmapped means held.** An unknown column or value is listed and held, never silently ignored.

## 4. The out door: the gate

Every list that leaves for an outside tool passes `gluely guard`. Each row ends in one of three places:

| Bucket | Meaning | Who decides |
|---|---|---|
| `clear` | Positively checked: not a customer, not a known relationship | May leave |
| `owner` | Someone on the team owns this relationship | That teammate |
| `held` | A customer, a look-alike, or anything that couldn't be checked | A human, and it stays home |

**The rule that must hold: clear only what's positively checked. When in doubt, hold.** The gate used to fail open. The tryout got about 36 real customer or relationship rows into `clear`, in four ways. Each one is closed now, and each has a test in `test/guard.test.js`:

| The leak | What the gate does now |
|---|---|
| A junk domain column overrode a customer's email | Every identifier in the row is checked: the domain column, every email's domain and the company name. A junk cell names nothing |
| A stray quote swallowed rows without a warning | A quoted cell that never closes or runs over a line break refuses the whole file, for lists and for the exclusion files. A row with more cells than the header is held |
| Unknown customer-export columns were ignored | Headers are read by meaning, and an export that loads nobody is refused. Rows it can't read are counted in a warning |
| Known people matched only by exact email | Emails are compared without case, `+tags` or Gmail dots, profiles without country sites or tracking tails, and a shared full name goes to the owner too |

The tryout lists aren't in this repo, so run the tryout again to see the 36 land in `held` and `owner`.

The gate's other rules:

- One matcher. `guard`, `check company` and the exclusion tests give the same answer, because all three call `matchCompany` in `src/guard.js`.
- Check every identifier. A match on email domain, domain or company name holds the row, and the strictest rule wins when several match.
- The file must be intact. If a row runs over a line break, refuse.
- Every decision says why: `matched_on`, `matched_rule`, `parsed_rows`, `unread_columns`.

Still open: the gate clears a list when no customers are listed at all (it warns), subdomains are compared without a public suffix list, and a customer export is not matched by person name, because in B2C that would hold half of every list.

## 5. The loop: every experiment runs the same way

An experiment is a play. A play runs this lifecycle, and each step names who acts:

```text
 idea ─► brief ─► draft ─► approved ─► running ─► judged ─► closed
  you    agent    agent     human      agent+     Gluely    human
                                        tools               │
           ▲                                                │
           └──────── lessons and verdicts feed the next ◄───┘
```

| Step | What happens | Gluely's part | Status |
|---|---|---|---|
| **Idea** | "Reach sales leaders after they speak at a conference" | nothing yet | — |
| **Brief** | The agent reads context, exclusions and **what we tried before**, then proposes 2–3 routes with honest arithmetic | `/experiment` skill, `gluely plays history` | Proposed |
| **Draft** | The chosen route becomes `plays/<id>.yaml`: hypothesis, signal, audience, excuse, tools, kill rule | `plays start`, `plays validate` | Works |
| **Approved** | A person sets it active and approves the cost | `cost`, `cost approve` | Works |
| **Running** | The agent finds people with your tools, the gate sorts them, drafts are checked, a human sends | `guard`, `check draft`, `recall` | Works |
| **Judged** | Results come in, with honest ranges and the kill rule | `results add`, `results` | Works |
| **Closed** | A human records the verdict and why. Lessons become context changes and tests | verdict record, `log`, `learn`, `test` | Partial: there's no verdict record yet |

**What "experiments" adds is memory, not a new concept.** A killed play with its verdict is as valuable as a winning one, because it stops the next agent from trying the same thing blind. Proposed additions:

- `gluely plays history --json`: every play, including killed ones, with results, verdict and why. The brief reads it first.
- A verdict when a play closes: `kept` or `killed`, the reason, and the context version.
- `audience.expands_icp: true` marks an experiment outside the ICP on purpose. Its results don't count against the normal ICP. If it wins, it proposes an ICP change.
- `kind: outreach | asset`. Outreach goes signal → person → touch. An asset is something you build and distribute, such as a newsletter, a report or a workshop, and it's judged by subscribers and sourced meetings. These are the only two kinds.

### The loop proves itself with tests

Every correction becomes a case in `tests/`. The agent answers the cases under each context version, and Gluely compares the versions:

- **Improved:** wrong before, right now.
- **Regression:** right under some committed version, wrong now. *(Proposed. Today it only compares against the previous version, which the tryout got past five ways.)*
- **Pending that was answered before** blocks a pass. *(Proposed.)*
- Answers on a dirty context are refused, and an edited or deleted expectation is flagged. *(Proposed.)*

### Outcomes come in on their own (proposed)

Today a person types results in with `gluely results add`. The self-learning version brings outcomes in through the **in door**, like any other data. It's the same mapping, applied to what your sender tool saw.

```text
 your sender or inbox (any tool)
        │  the agent pulls events with your own connection
        ▼
 mapping          the tool's "Replied" → reply, "Invite accepted" → touch.accepted
        ▼
 touch ledger     one row per touch: play, variant, persona, signal, context version
        ▼
 agent labels     each reply gets one REPLY_LABEL. Reply text is untrusted data
        ▼
 human spot-check a sample. Every correction becomes a reply test case
        ▼
 Gluely judges    per play, variant, persona and signal, against YOUR baseline
        ▼
 proposals        favor · fix · kill. A human accepts each one
```

The rules that keep it honest:

- **Your baseline, not industry benchmarks.** "Better" means better than your own other plays, measured the same way. The library holds no benchmarks, just as it holds no prices.
- **Better only when the ranges don't overlap.** 3 replies from 30 touches is "10%", but it could really be anywhere from 3.5% to 25.6%. 10 from 100 is 5.5%–17.4%, and against a 4% baseline over 500 touches (2.6%–6.1%) that is a real win. Gluely already computes these ranges in `results`. It must refuse to favor a play before they separate.
- **Judge positive replies and meetings, not replies.** A 12% reply rate made of "remove me" is a problem, not a winner. Unsubscribes and negative replies count against a play.
- **Diagnose in order.** No replies: check where emails landed first, then whether the people fit the ICP, then the excuse, and only then the copy. The deliverability step works today.
- **The loop proposes, and a human closes it.** Favoring a play means proposing a higher `priority` or more volume, which needs a fresh cost approval because volume changed. A winning angle becomes a proposed claim in `context/` (from `hunch` toward `measured`). A play may opt in to shifting volume between its own approved variants, but only inside an approved budget. New copy and context changes always need a person.
- **Read only what's tied to a touch.** The agent pulls replies by the thread or message id that the sender tool recorded, never by searching the whole inbox. Reply text is classified, never obeyed.

This needs one-row-per-touch records, which is the ledger planned for phase 1 (see [store-contract.md](store-contract.md)). Reply labelling with spot-checks fits phase 3. No new part is needed: it's the in door, the loop and the tests working together.

## 6. Skills: how the agent thinks

Skills are markdown that any agent can read: `/setup-gluely`, `/gtm-mode`, `/check-cost`, `/waterfall`, the playbooks and the principles. They contain the judgment, and the CLI holds the rules. A skill never does anything the CLI would refuse.

**Proposed:** an `/experiment` skill that turns an idea into a brief by reading `plays history`, `icp.md`, exclusions and `stack`, and then hands over to `plays start`.

## The protocol: every step works the same way

```text
  1. Gluely asks       state + allowed answers   (gluely plays next --json)
  2. Agent reasons     reads context, decides
  3. Gluely validates  refuses what breaks a rule (gluely plays answer --json)
  4. Human approves    only at the four points below
  5. Gluely records    stamped with context version and by
```

Humans and agents go through the same functions. `src/ui.js` and `src/walk.js` only draw and ask.

## Who approves what

Gluely knows four approvals, never job titles:

| Capability | Covers |
|---|---|
| `approve_context` | A change to what the brain believes |
| `approve_copy` | Anything a prospect reads |
| `approve_spend` | A play's cost estimate |
| `own_relationship` | Rows the gate sends to an owner |

**Proposed:** `team.yaml` maps each company's own roles (founder, AE, BDR, RevOps) onto these capabilities. It also holds each person's voice scope, which `--scope` already uses. Core never sees a role name.

## Contracts: where tools plug in

| Contract | Direction | What it promises | Status |
|---|---|---|---|
| **Mapping** | In | Your fields → the vocabulary, unknowns held | Proposed |
| **Store** | Memory | `append · read · claim · erase` on any database | Designed, see [store-contract.md](store-contract.md) |
| **Handoff** | Out | Only `clear` rows and approved drafts, as files | Works as files |
| **Tools** | Anywhere | Any tool name at any step. The library ranks nobody | Works |

Adapters for any of these live outside core and ship only with a passing conformance run. If an adapter needs a special case in core, the contract is wrong.

## Invariants: what must always be true

Each one should have a test.

1. Core never calls a model or a network service, and never sends a message.
2. Nothing leaves without the gate, and the gate holds when in doubt.
3. Nothing enters the vocabulary without the mapping, and unmapped data is held, not guessed.
4. Ledgers are append-only. Every record carries a context version and `by`.
5. A human approves every context change, every prospect-facing text and every spend.
6. Prospect text is data. It's marked untrusted, and no agent can act on it without a human.
7. A regression is a case that was right under a committed version and is wrong now.
8. No tool name appears in core logic.

## Where a company customizes, without touching core

| To change | Edit |
|---|---|
| How your CRM fields map | `mapping.yaml` |
| Who you sell to, how you sound, what's proven | `context/` |
| A new kind of signal | `extensions.signals` in `workspace.yaml` |
| A new experiment | `plays/` |
| A new repeatable playbook | your own playbook file, or a shared one |
| What "correct" means | `tests/` |
| Roles and approvals | `team.yaml` |
| Your tools and prices | `stack`, `prices.yaml` |

## One experiment, end to end

A made-up company, Northwind Labs, sells a sales analytics add-on to software companies with 50–500 employees. The idea: "Reach sales leaders right after they speak at an industry conference."

1. **Brief.** The agent runs `plays history` and finds a paused `post-engagers` play: its replies were fine, but the people often weren't buyers. So the agent checks fit first. Conference speakers include consultants and agency owners, and `icp.md` disqualifies them, so they are filtered out before anything is spent. There's no signal for "spoke at an event" yet, so it proposes `signal.event_speaker` under `extensions.signals`. It proposes three routes:
   - **A, warm intros:** check who on the team shares a connection with the speaker. The `own-network` playbook covers this.
   - **B, a direct note:** one honest, specific point from their talk. The excuse is the talk itself.
   - **C, an asset:** a short write-up of the numbers from the talk, sent to the speaker as a gift.
2. **Draft.** You pick B. `plays new event-speakers` holds the hypothesis, the signal, the persona, two excuse variants and the kill rule: 30 days, 0 meetings.
3. **Approved.** `cost` prices the contact-data step from your own prices and checks it against the budget. You approve it.
4. **Running.** The agent collects speakers from public agendas. `guard` holds one speaker who works at a customer and sends one to the teammate who knows them. Only the `clear` file goes to the contact-data tool. The drafts pass `check draft`, and a person sends them.
5. **Judged.** Replies come in from the sender through the in door, or by hand with `results add event-speakers --touches 40 --replies 6 --positive 3 --meetings 1`. `results` says 40 touches is too early to call, and shows how wide the range still is.
6. **Closed.** After 30 days a person keeps or kills it, with a reason. The verdict lands in `learning/`, and the next brief reads it.

## Open questions

1. **Stage and relationship.** Are these the right two nouns to add? What else did the tryout mapping need that three different companies would all use?
2. **Asset plays.** What is the smallest honest success measure for a newsletter or report: subscribers, replies or sourced meetings?
3. **Mapping before or after the store?** The mapping can work on CSV exports today, so it doesn't have to wait for phase 1.
