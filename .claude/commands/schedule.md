---
description: Book an order onto a truck, a day and a slot. Refuses an account on stop, past the stop line or over its limit unless someone with the authority overrides it.
---

Confirm the order, truck, date and slot with the operator. Run `npm run merchant -- schedule <order> --truck=<code> --on=YYYY-MM-DD --slot=am|pm`. If it is refused for credit, say why and ask who approves before adding `--override-by=<name>`. Report the truck's load after the booking.
