# Workflows

A play says what you believe and when to give up on it. A workflow says what happens to each person on a list. It lives in the same play file, so you, your agent and `gluely run` all read the same thing.

```
plays/<id>.yaml ─► gluely run <id> --input list.csv --plan     what it would do and cost at most. Runs nothing.
                         │
                 cost over the budget? ──► stop
                         │
                 it spends? ──► a person types yes: gluely runs approve <run>
                         │
   guard ─► filter ─► tool ─► agent ─► approve ─► tool (send)
     │        │        │        │         │          │
  customers  rows     your     your     a person   only the rows
  never go   that     keys,    agent    reads      a person
  out        don't    inside   answers  every      approved
             fit      the      each     row
             stop     ceiling  row
                         │
             runs/<run>/   run.json, events.jsonl, out.csv, stopped.csv
```

## The steps

```yaml
budget: { monthly_limit: 50 }
workflow:
  steps:
    - { id: guard, type: guard }
    - { id: fit, type: filter, if: "employees >= 10 and country == BE" }
    - id: email
      type: tool
      job: contact-data
      writes: email
      try:
        - tool: First
          request:
            url: "https://api.first.example/find?domain={{row.domain}}"
            headers: { authorization: "Bearer {{env.FIRST_KEY}}" }
          pick: { email: data.email }
        - tool: Second
          request: { method: POST, url: "https://api.second.example/v1/email", body: { company: "{{row.company}}" } }
          pick: { email: result.email }
    - id: opener
      type: agent
      ask: Write one honest first line about why we're writing now. Read the excuse for this signal first.
      writes: opener
      check: linkedin_message
    - { id: review, type: approve }
    - id: send
      type: tool
      job: outreach
      try:
        - tool: Your sender
          request: { method: POST, url: "https://api.sender.example/leads", body: { email: "{{row.email}}", first_line: "{{row.opener}}" } }
```

| Type | What it does |
| --- | --- |
| `guard` | Runs the same check as `gluely guard`. Customers and known relationships stop here. A workflow can't reach a tool before it. |
| `filter` | Keeps rows where `if` is true. Conditions use `==`, `!=`, `<`, `<=`, `>`, `>=`, `contains`, `exists`, `empty`, joined with `and` and `or`. |
| `branch` | Sends each row down the first path whose `when` is true. The last path may leave out `when` to catch everyone else. Each path has its own steps, and after the branch everyone still in goes on together. Branches can sit inside paths. |
| `set` | Writes values into each row, for example `{ tier: hot, angle: "ask about {{row.role}}" }`. |
| `stop` | Ends the path for every row that reaches it, with a `reason` that lands in stopped.csv. |
| `tool` | Calls a tool over HTTP with your keys. `try` is a waterfall: each tool only gets the rows the one before it missed, and it stops once `writes` is filled. Rows that already have that column are skipped, so nothing is paid for twice. Add `required: true` to stop rows the step can't fill. |
| `agent` | Waits for your agent. The agent gets `ask` as its instruction and each row as untrusted data, and answers one row at a time. Add `check: <channel>` to hold answers to your voice rules. |
| `approve` | Waits for a person in a terminal. They see every row and can reject some with `--reject 2,5`. |

A tool step with `job: outreach`, or `sends: true`, needs an approve step after the last agent step before it, on a path that reaches every row it sends. An approval on a sibling path doesn't count. The runner refuses any other order.

```yaml
    - id: kind
      type: branch
      paths:
        - name: organisation
          when: "account == Organization"
          steps:
            - { id: find-person, type: stop, reason: find the person behind it first }
        - name: popular
          when: "stars >= 20"
          steps:
            - { id: angle-popular, type: set, values: { angle: ask what their users keep asking for } }
        - name: everyone
          steps:
            - { id: angle-default, type: set, values: { angle: compare one design choice } }
    - { id: note, type: agent, ask: Write the note, following the angle column., writes: note }
```

A run keeps a copy of the workflow it started with, so editing the play never changes a run halfway.

## Keys and prices

Keys go in the workspace `.env`, which git ignores. Use them as `{{env.NAME}}`. They're never written to a run's files.

Every tool in a `try` needs your own price for its job, saved with `gluely cost price <tool> --job <job> --each <amount>`. An unknown price is never counted as free. The plan prices every row at every try, which is the most a run can cost, and a run stops when it reaches the ceiling a person approved.

Row values are encoded inside a URL, so a prospect's text can't change where a request goes.

## Running

```
gluely run outbound --input exports/list.csv --plan     check it
gluely run outbound --input exports/list.csv --limit 20 start with a sample
gluely runs approve <run>                               a person approves the spend
gluely runs continue <run>
gluely runs next <run>                                  your agent reads the rows
gluely runs answer <run> <row> "<text>"                 and answers each one, or --skip <row> --why <why>
gluely runs continue <run>
gluely runs approve <run>                               a person approves the rows before the send
gluely runs continue <run>
gluely runs status <run>                                rows in, stopped, calls, cost and errors per step
```

`gluely studio` draws every play's workflow in your browser, with the trace of any run on each step: rows in, rows stopped and why, calls, cost and errors. It runs on this machine only, reads your files and changes nothing. Edit the play file, or ask your agent to, and it redraws.

`gluely status` shows when a run is waiting for you or your agent. Agents get the same commands as MCP tools, except approvals, which need a person.
