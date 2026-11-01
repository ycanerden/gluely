---
name: principle-corrections-become-tests
description: Apply whenever a human corrects a label, draft, score or claim.
disable-model-invocation: true
---

# Corrections become tests

A correction that isn't recorded will happen again.

**Why:** this is how the brain learns before there's enough volume for rates to mean anything. Each correction permanently raises the bar.

When a human corrects a decision the brain can test, run `gluely test add` with the input and the right answer. When they edit your writing or tell you a preference, keep it with `gluely log add`. Then find the context gap that caused the mistake, and propose that fix too.
