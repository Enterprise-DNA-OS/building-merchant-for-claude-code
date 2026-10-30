---
description: Check every open quote and order line of treated timber against the hazard class its end use needs, and structural uses against a stress grade.
---

Run `npm run merchant -- treatment-check` for the lines that fail, then `npm run merchant -- compliance` for any end-use-unknown warnings. For each, propose the right product from `npm run merchant -- product <code>` (its allowed uses) or fix a wrong end use with /set-use. The rules and sources are in docs/compliance.md.
