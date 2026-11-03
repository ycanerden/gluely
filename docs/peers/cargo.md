# Cargo, as a peer

This note is about [Cargo](https://www.getcargo.ai) (YouTube channel: Cargo | GTM Engineering). It is the product aimed at coding agents. It is not about Habitat workshops.

## What their public demo shows

Video: [Getting Started with Cargo: from npm install to a deployed TAM](https://www.youtube.com/watch?v=kJRZgW-9KXo).

The shape of that demo:

1. Install a CLI (`npm install -g @cargo-ai/cli`).
2. Open a cookbook that builds a TAM, a target-account list.
3. Customize that cookbook.
4. Plan and deploy.
5. Land the result as GitHub pull requests.

They present this as GTM infrastructure for coding agents, with the motion kept as code.

## What Gluely takes from the shape

A person should get from a fresh checkout to a first account-list play in one sitting.

```bash
git clone <this-repo> gluely && cd gluely && npm install
npx . cookbooks
npx . init ../my-brain --company "Acme" --domain acme.example --motion sales_led
cd ../my-brain
npx ../gluely cookbooks start find-accounts
```

`find-accounts` asks who belongs on the list, how many accounts, which research tool, and where the list lives. The answers are `plays/find-accounts.yaml`. An empty `lists/find-accounts.csv` is the list. Both files sit in the private workspace, which `gluely init` already makes a git repo. A person commits them. That commit is the artifact.

The same steps are `gluely plays next` and `gluely plays answer` for an agent. Add `--json` to every command.

## What Gluely does not take

Gluely does not run a hosted research runtime, call a model, send a message, or open a pull request. The agent uses the company's own keys, after `gluely cost` says a person approved the spend.

Research tools stay optional. [Exa](https://exa.ai) and [Firecrawl](https://www.firecrawl.dev) are examples already in the tool library, beside every other web-research tool, in alphabetical order, with no rank. Any name is a valid answer, including an aggregator. None is required. See [stack.md](../stack.md).

The list is not permission to contact anyone. A later play still needs an excuse, an exclusion check, a cost approval, and a human before anything a prospect could read.

## Still open

Person 360, the event ledger, and attribution are later phases. This cookbook does not pretend they exist. `gluely flow` still marks those stages as later. Gluely is not on the npm registry yet, so the install above is a checkout, not `npm install -g gluely`.
