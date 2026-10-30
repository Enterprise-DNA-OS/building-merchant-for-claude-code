---
description: Add branches, trucks, price levels, products, accounts or jobs from a JSON file. References (branch, price_level, account) are given by code.
---

Write the records to `imports/<name>.json` (one object or a list). Run `npm run merchant -- add <type> --data=imports/<name>.json`. Report the codes added and any rule finding the new records raise (a new credit account needs its registration).
