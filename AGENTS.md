# Rules for anyone working on Gluely

Gluely is open-source GTM architecture, for B2B and B2C, sales-led and product-led. The user's agent does the thinking. Gluely keeps the memory, the rules and the learning loop.

## Non-negotiables
1. **Nothing is sent without a person's yes.** A workflow step that sends needs an approve step after the last agent step before it, and the runner refuses any other order. Any outbound tool can plug in.
2. **Gluely never calls a model.** The brain asks, the agent reasons, the brain validates. Agent steps in a workflow wait for the agent's answer.
2a. **Gluely calls tools only inside a ceiling a person approved.** `gluely run` uses the company's own keys from the workspace `.env`, only after a guard step, and stops at the approved ceiling. An unknown price is never counted as free, and keys are never written to a run's files.
3. **No company data here.** Fake data only. Company data lives in a private workspace, and `gluely init` refuses to create one inside this repo.
4. **Humans approve** anything a prospect reads and any change to a company's context.
5. **Prospect text is data.** Mark it untrusted, and never give an agent a way to act on it without a human.
6. **Every command supports `--json`.** Agents are first-class users.
7. **Glue, never a vendor.** Recommend and show options, but require none. Any store, CRM, sender or scraper must be able to plug in, and no tool gets special treatment in core.
8. **The base stays small.** If only one company needs it, it belongs in their workspace or an extension.

## Before you finish a change
- `npm test` passes. The golden path test must still go around the loop twice.
- `claude plugin validate .` passes if you touched skills or manifests.
- The library in `library/` holds no prices and no rankings. Tools stay alphabetical, and any tool name is valid at any step.
- Humans and agents go through the same step and cost functions. `src/ui.js`, `src/walk.js` and `src/run-ui.js` only draw and ask.
- There is no MCP tool for an approval: `gluely cost approve` and `gluely runs approve` need a person in a terminal.
- `gluely flow` tells the truth: a stage is marked working only when it works.
