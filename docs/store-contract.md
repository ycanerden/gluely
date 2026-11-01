# The store contract

Status: design for phase 1, not built yet.

Gluely doesn't choose your database. Any store that passes the contract can hold the brain's memory.

```text
 skills and agents
        │
        ▼
 gluely core          gate, identity, attribution, funnel
 (plain JavaScript)   the same logic on every store
        │
        ▼
 store contract       append · read · claim · erase
        │
   ┌────┼────────┬───────────┬──────────┐
   ▼    ▼        ▼           ▼          ▼
 file  SQLite  Postgres   Snowflake   yours
       (Supabase is Postgres)
```

## Why the logic leaves the database

v0.1 kept the gate and identity rules in Postgres functions, which ties the product to one engine and means rewriting the rules for each new one. Two copies of the gate would drift apart, and the gate is the part that stops you emailing a customer. So the rules move into the core, and a store only keeps data.

## What a store must do

| Method | Job | Rule |
|---|---|---|
| `append(events)` | Add to the ledger | Idempotent on source and external id |
| `read(filter)` | Read events and identities | Filters by person, company, type and time |
| `claim(key, owner)` | Reserve a person for one play | Only one owner can win, even in parallel |
| `erase(person)` | Handle an erasure request | Personal data goes, the opt-out record stays |

## Capabilities differ, and we say so

Every store runs `gluely store test`, which reports what it can do on your real setup.

`claim` needs an atomic check. Standard Snowflake tables don't enforce unique constraints, so a warehouse can hold the ledger while claims live somewhere that can guarantee them. Gluely reports this and never silently weakens the gate.

## No database yet?

A company with no store gets a plain append-only file in its workspace. It runs with no install and exports to any database later, so nobody has to choose on day one.

## Rules every adapter follows

- One locked path for local stores. Unlocked parallel writes to an embedded database lost data in testing, and left one database unopenable.
- No vendor logic in core. If an adapter needs a special case in core, the contract is wrong.
- An adapter ships only with a passing conformance run, on the real engine.
