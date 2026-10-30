---
description: Check every open quote and order line of treated timber against the hazard class its end use needs, and structural uses against a stress grade.
---

Run `npm run merchant -- compliance` and show only the treatment-for-use, grade-for-structure and end-use-unknown rows. For each, propose the right product from `npm run merchant -- product <code>` (its allowed uses) or fix a wrong end use with /set-use. The rules and sources are in docs/compliance.md.
