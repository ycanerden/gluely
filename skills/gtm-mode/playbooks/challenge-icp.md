# Challenge the ICP

Founders describe the customer they want. Deals show the customer they have. Find the gap, kindly and without giving up.

## 1. Show stated against evidence

Put them side by side, with counts:

| The founder says | The deals show | How strong |
|---|---|---|
| "Mid-market SaaS" | 7 of 9 won deals had under 30 people | 9 deals |

## 2. Ask the hard questions

Pick the ones the evidence makes sharpest, and ask them one at a time:
- Who bought that your ICP says shouldn't have?
- Who fits your ICP perfectly and never buys?
- Which customers would you refuse to sign again, and why?
- What did your best three customers have in common before they met you?
- What was happening at the company the month they bought?
- If only one persona could exist, which one pays?
- What would have to be true for this ICP to be wrong?

## 3. Push on vague answers

"Innovative companies" can't be scored. Keep asking until a claim can be checked from a title and a company record. When the founder says "it depends", ask what it depends on, and turn that into a rule.

## 4. Test the edges with real people

A rubric only shows its gaps at the edges, so describe three to five borderline people or companies, and ask the founder to judge each one:

> A technical founder of a 6-person B2B tool. Uses Claude Code daily, does founder-led sales, pays for no GTM tools yet. Hot, warm or ignore? Why?

Score the same person with the rubric. If the rubric disagrees with the founder, one of them is wrong, so say so and find out which. These answers are company-specific: there is no universal right answer.

## 5. Record what changed

Update `context/icp.md`, then save every decision as a test:

`gluely test add --kind icp --input "<the person>" --expect <band> --why "<the founder's reason>" --json`

Disagree when the evidence supports it. If the founder keeps a claim the deals contradict, keep their decision, mark it unproven in the onboarding report, and add a test so the loop can check it later.
