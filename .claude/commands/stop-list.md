---
description: The credit watch: accounts over their limit once open orders are counted, invoices past the stop line, and accounts already on stop.
---

Run `npm run merchant -- credit`. Explain exposure as what is owed plus what is ordered and not yet invoiced. For each account, propose one action: hold new orders, /draft-overdue, /stop, or raise the limit. Never stop or release an account without a yes.
