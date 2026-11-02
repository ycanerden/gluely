# Explanation statecharts

These charts explain how Gluely is meant to behave. They are not the CLI, and they are not a game.

Each chart is produced from a TLA+ model:

1. TLC checks the model.
2. `view.ts` names each state and step in reader words.
3. The pstack statechart tool writes `chart.mmd`.
4. [Pele](https://pele.run) 1.9.0 draws `chart.svg`.

No chart is drawn by hand, and no image model is used. The models use no company data and no real person.

A step that stays in the same chart state is not drawn. That is the resting step at the end of each model (`Done` in the spec).

Brackets on an arrow in a side-by-side chart name the other region's state. On the job-switch region, `[when Not asking]` means the hiring region is "Not asking".

## Person 360

![Person 360 is a view over an append-only ledger](person-360/chart.svg)

A LinkedIn URL arrives and an internal id is minted. The URL is linked onto that id. Signals are appended. Person 360 is filled in from the ledger. Sales-ready fields go to the CRM, and a stage change comes back as an event.

TLC reached 15 states. The chart draws 7 arrows. These rules hold:

- The ledger is empty, one signal, or that signal plus a sales-ready mark, and it never shrinks or rewrites.
- A signal belongs to an internal id, and a LinkedIn URL sits on that id.
- Person 360 shows a person only after an id exists and an event is logged.
- The CRM never holds a raw pooled list. It is written only after the view shows the person and a sales-ready mark is on the ledger.

Left out: merges, enrichment, and field ownership beyond this boundary. The sales-ready mark stands for a positive reply, a meeting, or a handoff.

## Gates before a send

![Gates before a send](send-gates/chart.svg)

A like or a visit is not consent. An exclusion rule or a suppression hash stops the send. After both pass, a person approves the draft, and the touch goes out with play, variant, and context.

TLC reached 7 states. The chart draws 9 arrows. These rules hold:

- There is no send while the person is excluded or suppressed.
- A send exists only from a clear gate, only after a person approves, and only with play, variant, and context. A bare attribution never appears.
- Engagement itself does not approve or send anything.

Left out: volume caps, freshness, and cross-play arbitration.

## One active play

![One person, one active play](play-arbitration/chart.svg)

Job-switch and hiring can both want the same person. If only one is asking, it runs. If both are asking, arbitration keeps job-switch and records that hiring stepped aside. A later signal for the other play is set aside too.

TLC reached 8 states. The chart draws 8 arrows. These rules hold:

- The two plays are never both the active play.
- Stepping aside happens only while the other play is the active one, so the loss is recorded.

Left out: cooldown days, the account cap, and ties broken by signal strength. In this model job-switch outranks hiring.

## What a reply can teach

![A reply can teach the play, without the prospect's words](learn-loop/chart.svg)

A reply is labeled positive, not now, or unsubscribe. Not-now and unsubscribe do not become a card. Unsubscribe is suppressed. A positive reply can become a card of counts and shared words, then a proposed play update, which a person approves.

TLC reached 7 states. The chart draws 6 arrows. These rules hold:

- A card never holds the prospect's own text.
- Only a positive reply feeds a card.
- An approved play update is that card, from a positive reply.
- Unsubscribe suppresses, and it writes no card and no play update.

Left out: the other reply labels, transcripts, the commons pull request, and the minimum sample of sends.

## Regenerate

Needs Java 11 or later, Node 22.18 or later, and the pstack `statechart` script (`skills/statechart/scripts/statechart`).

From the repo root:

```bash
bash docs/charts/regenerate.sh
```

The script downloads TLC 1.7.4 when it is missing, checks sha256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`, runs statechart for each spec, and renders the SVG. Point it at a particular checkout of the script with `STATECHART`:

```bash
export STATECHART=/path/to/skills/statechart/scripts/statechart
export TLA2TOOLS="$HOME/.cache/statechart/tla2tools.jar"   # optional
export JAVA=java                                            # optional
bash docs/charts/regenerate.sh
```

One chart, the same steps the script runs for Person 360:

```bash
export TLA2TOOLS="$HOME/.cache/statechart/tla2tools.jar"
export JAVA=java
out=$(mktemp -d)
"$STATECHART" docs/charts/person-360/Person360.tla \
  --view docs/charts/person-360/view.ts \
  --out "$out"
cp "$out/chart.mmd" docs/charts/person-360/chart.mmd
node docs/charts/render-svg.mjs docs/charts/person-360/chart.mmd docs/charts/person-360/chart.svg
```

The other three specs are `docs/charts/send-gates/SendGates.tla`, `docs/charts/play-arbitration/PlayArbitration.tla`, and `docs/charts/learn-loop/LearnLoop.tla`. Each has a `view.ts` beside it. The config file is the `.cfg` with the same name as the module.

`render-svg.mjs` installs `pele@1.9.0` under `~/.cache/statechart/pele` and renders with `{ limit: 1000000, outputLimit: 8000000, maxEdges: 10000 }`.

`statechart` prints TLC's report and does not write it into this folder. Exit 0 means every rule held.
