# Run Gluely in the cloud

One container, one disk. The container is `gluely worker`. It pulls your plays from your brain's git repo, starts the plays whose schedule is due, carries on every run that can move, and tells you when one waits for you. Your runs and keys stay on the disk, and the box never commits or pushes.

```
your laptop                                  the box (Fly.io, or any host with a disk)
─────────────                                ─────────────────────────────────────────
edit plays/*.yaml, git push ───────────────► gluely worker --pull, every 30 seconds
                                               · git pull (plays and context)
                                               · start plays whose schedule is due
                                               · carry on every running run
                                               · a tool down? wait, then try again
                                               · a run waits? post once to GLUELY_NOTIFY_URL
                                             /data/brain        your brain, cloned once
                                             /data/brain/runs   every run, row by row
fly ssh console ◄──────────────────────────── "hiring-sdr: 7 rows wait for you to approve"
  gluely runs approve run-1a2b3c               a person, in a terminal, as always
```

## What survives what

| If this happens | What the worker does |
| --- | --- |
| The box restarts, or you redeploy | Picks each run up at its next row. Every row is saved once it's done. |
| The process is killed mid-call | A lookup in flight is counted as spent and tried again. A send in flight is never repeated: the row stops and asks you to check your sender. |
| A tool is down or rate limits you | The run waits and tries again: 30 seconds, then doubling up to 30 minutes, six times per row. Nothing is counted as spent for a call that never got an answer. |
| Two workers run at once | Only one moves a run. The other skips it. |
| The worker was down when a schedule was due | It runs once when it comes back, not once per missed slot. |
| You edit a play while it runs | The run keeps the workflow it started with. The next run uses the new one. |

## Schedules

```yaml
schedule:
  cron: "0 8 * * 1-5"         # 08:00 on weekdays, in the worker's TZ
  input: exports/hiring.csv   # the list it runs over, relative to the brain
  limit: 50                   # optional: only the first 50 rows
```

A run that spends still waits for a person to approve the ceiling, and a run that sends still waits for a person to approve the rows.

## Fly.io

```
cp deploy/fly/fly.toml fly.toml          # then set app to a name of your own
fly apps create <your-app>
fly volumes create gluely_data --region <your-region> --size 1
fly secrets set GLUELY_BRAIN_REPO="https://<token>@github.com/<you>/<brain>.git"
fly secrets set GLUELY_NOTIFY_URL="https://hooks.slack.com/services/..."     # optional
fly secrets set FIRST_TOOL_KEY=... SECOND_TOOL_KEY=...                       # your tool keys
fly deploy
```

- Use a read-only token for `GLUELY_BRAIN_REPO`, such as a fine-grained GitHub token with read access to one repo. The worker only pulls.
- Tool keys are Fly secrets, so they reach the worker as environment variables and never touch git.
- `fly logs` shows each tick. `fly ssh console` gives you a terminal on the box for `gluely runs`, `gluely runs approve` and `gluely runs next`.
- The fly.toml has no public ports. The studio stays on your laptop: `gluely studio` there shows your local runs.

Any other host works the same way: build the Dockerfile, mount a disk at `/data`, and set the same environment variables.

## What it doesn't do yet

- Learning the worker writes (a finished run, an approval) stays on the box's copy of `learning/log.jsonl`. Pulling it back to your laptop comes next.
- Agent steps wait for an agent. Point a scheduled Claude Code agent at the box, or answer them from your laptop over `fly ssh console`.
- Webhook triggers (start a run when a form comes in) come after schedules.
