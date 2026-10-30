---
description: Turn an accepted quote into an order with the same lines and prices. Refuses a quote with a treatment or grade breach, or an account that would go over its limit, unless someone overrides it.
---

Run `npm run merchant -- win <quote> [--required=YYYY-MM-DD] [--pickup] [--po=]`. If it is refused, show the problems and propose the fix. Only add `--override-by=<name>` when the operator names who accepts them. Then offer /schedule.
