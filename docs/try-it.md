# Try Gluely in 10 minutes

You need Node 22 or newer, git, and any coding agent: Claude Code, Cursor, Codex, Grok or another one that can run shell commands. You don't need to know the codebase.

Keep everything with company data in your own brain folder. Nothing in this guide sends a message or spends a credit.

## 1. Install (2 minutes)

```bash
git clone https://github.com/ycanerden/gluely.git && cd gluely && npm install && npm link
gluely --version
```

## 2. Make your brain (1 minute)

Pick your market (`b2b`, `b2c` or `both`) and motion (`sales_led`, `product_led`, `founder_led`, `community_led` or `mixed`).

```bash
gluely init ~/acme-brain --company "Acme" --domain acme.example --market b2b --motion sales_led
cd ~/acme-brain
gluely doctor
```

One brain per company. If you work for several companies or clients, make one brain for each and never copy files between them.

## 3. Open your agent in the brain (1 minute)

- **Claude Code:** run `claude` in the brain folder and approve the `gluely` MCP server when it asks.
- **Cursor:** open the folder. The `gluely` MCP server is already in `.cursor/mcp.json`.
- **Any other agent:** ask it to read `AGENTS.md`. Every command also works with `--json`.

## 4. Get your first result (5 minutes)

Ask your agent:

> Check where my Gluely brain stands. Add our three biggest customers to `context/exclusions/companies.csv`, check one of their domains, then check this draft against our voice rules: "Hi Sam, I hope this finds you well. Quick question about your outbound."

You should see the customer blocked and the draft fail on two banned phrases. That is the brain doing its job: it keeps what you know and checks the work before anything leaves.

## Next: set the brain up properly (about 30 minutes, whenever you like)

Type `/setup-gluely` in Claude Code or Cursor, or ask any other agent to follow `.claude/skills/setup-gluely/SKILL.md`. It maps your stack, asks for read-only connections, reads a few real deals and challenges your ICP before it writes anything. Answer honestly. Disagreeing with it is part of the test.

Then try one play on paper:

```bash
gluely plays start
gluely cost <play-id>
```

When your agent writes something you would change, change it and tell it why. It records the lesson, and `gluely learn` shows what keeps coming up.

## Tell us where it hurt (2 minutes)

Open a [tester report](https://github.com/ycanerden/gluely/issues/new?template=tester-report.md). The most useful things to tell us:

- where you got stuck, and for how long
- which agent you used
- the first moment it was useful, if there was one
- what you expected Gluely to do that it didn't

Never paste company data, customer names or prospect lists into an issue. Describe them instead: "a 400-row export from our CRM" is enough.
