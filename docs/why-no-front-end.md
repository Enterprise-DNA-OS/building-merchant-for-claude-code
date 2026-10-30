# Why there is no front end

Epicor BisTrack is a database with a subscription. The tables underneath it are ordinary: a few entities, a few relationships, a handful of workflows you repeat every week. What you pay for is the layer on top that lets people who do not write SQL get at those tables. Screens, filters, dashboards, forms.

That layer used to be the whole product, because talking to a database was hard. It is not hard any more. Open this folder in Claude Code, describe what you want, and it writes the query, runs it, and explains the answer. Ask a question the dashboard never had a chart for and you still get an answer.

## What you gain

- **Better answers.** A dashboard shows what the vendor decided to chart. Here you ask your own question, in your own words, and get it answered against your own data.
- **No seats.** Everyone who needs to look can look. The bill does not grow with headcount.
- **Your data in your Postgres.** Plain tables. Back them up, query them from anything, leave any time. There is no export step because there is nothing to leave.
- **A process that matches you.** When your way of working changes, you add a command. You do not wait for a feature request to clear.

## What you give up

- **A trade counter screen.** A point-of-sale terminal, EFTPOS and a receipt printer for walk-in cash sales are not here. Keep the counter system for that, or have Enterprise DNA connect one.
- **Scanners in the yard.** Picking with a handheld scanner, and printing barcode labels, need a device and a screen. Delivery dockets print from `npm run docs` instead.
- **A live driver app.** Drivers sign dockets on paper and the office records the delivery. A phone app with photos and signatures is a customisation.
- **A vendor help desk.** This is open source. Enterprise DNA supports the installed version for merchants that want someone to call.

## Who this fits

Owner-run timber and building supplies merchants with one to five branches, where the owner, the trade reps and the credit controller would rather ask a question than run a report. If your counter staff need a till all day, keep one for that. The trade accounts, quotes, deliveries, credit and pricing, which is where the money is, sit better in a database you own and can ask anything.

Installed and run for you: https://enterprisedna.co/omni/instead-of/bistrack
