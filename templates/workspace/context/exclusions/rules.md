---
id: exclusion-rules
status: template
updated: {{date}}
---
# Exclusion rules

Never contact:
- Clients, open deals, investors, partners and employees
- Anyone in a conversation with sales
- Anyone who opted out
- <your own rule>

Companies go in `companies.csv`. Countries that need prior consent for cold email go here too.

## Customer data stays home

Anyone who has trialed, paid or churned is a customer. Give them `reason` customer, trial, paid or churned in `companies.csv`. Their records never go to an enrichment tool, a scraper or a sender, and neither does a company that shares their name until a person checks it.

## Known people go to their owner first

Investors, people at customers and close relationships go in `people.csv`, with the teammate who owns the relationship under `owner`. A company row can name an `owner` too. The owner decides before anyone else reaches out.

Before any list leaves this repo, run `gluely guard <list.csv> --to <tool>`. Only the `clear` file may go out.
