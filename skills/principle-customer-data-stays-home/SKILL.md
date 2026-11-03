---
name: principle-customer-data-stays-home
description: Apply before any list of people or companies goes to an outside tool, such as an enrichment tool, a scraper or a sender.
disable-model-invocation: true
---

# Customer data stays home

A list only leaves after `gluely guard <list.csv> --to <tool> --json` has sorted it, and only its `clear` file goes out.

**Why:** your customer list is the most valuable list you have. Upload it to an enrichment tool once and you can't take it back. And an investor or a customer's colleague who gets a cold message from your team costs more than any meeting.

- **Customers never leave.** Anyone who has trialed, paid or churned. A company that shares a customer's name is held too, until a person checks it.
- **Known people go to their owner.** Investors, people at customers and close relationships go to the teammate who owns the relationship. That person decides first.
- **When in doubt, hold.** A row with no company or work domain can't be checked, so it stays home.
- If the guard warns that no customers are listed, stop and ask for them. A guard that knows no customers protects nothing.
