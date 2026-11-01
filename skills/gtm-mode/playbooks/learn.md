# Turn the log into a better brain

The decision log remembers. This playbook makes what it remembers change the output.

## Before you write anything

Run `gluely recall --area voice --json`, and the same for `messaging` and `excuse`. Add `--scope <person>` when you write as a specific person. Read the `read_first` file, then write as if you had made those corrections yourself.

## Whenever a human changes your output

Log it straight away, in their words:

```bash
gluely log add --kind correction --area voice --scope <person> \
  --before "<your line>" --after "<their line>" --why "<their reason>" --by <agent/model> --json
```

- Use `--kind input` for something they tell you with no draft, such as "I never use exclamation marks".
- Use `--kind decision` for a choice you'd otherwise have to ask about again.
- Use `--kind result` for what happened in a test or pilot, with `--from agent`.
- Replace names and companies with placeholders such as `{first_name}`. The log keeps lessons, not people.

## When lessons pile up

1. Run `gluely learn --json`.
2. For each area, separate a repeated pattern from a one-off. `keeps_removing` and `keeps_adding` are counts, so you decide what they mean.
3. Propose the smallest change, on a branch, to the file in `home`. Show the evidence. For a word that keeps being removed, propose adding it to `banned` in `voice.md`, so `gluely check draft` catches it for good.
4. Add a test with `gluely test add`, then run `gluely test --json`.
5. Once the founder merges, run `gluely log promote <id> --to <file> --json`.
6. If they disagree, run `gluely log drop <id> --why "<their reason>" --json`. Dropped lessons stop appearing in `recall`.

Never promote a lesson on your own. A person approves every change to `context/`.
