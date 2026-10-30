# Building Merchant for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS] (the demo is Ridgeline Timber and Trade, a fictional Waikato merchant)
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| look up an account | `/account` |
| add branches, trucks, accounts, products, jobs | `/add` |
| what needs doing, what is on fire | `/attention` |
| all rule checks | `/compliance` |
| called a customer about a quote | `/contact` |
| supplier price rise | `/cost` |
| add a field, change a rule | `/customise` |
| aged debtors, who owes | `/debtors` |
| a delivery went out, signed for | `/deliver` |
| deliveries on a day | `/dispatch` |
| statements, quotes, dockets, invoices | `/documents` |
| write an overdue reminder | `/draft-overdue` |
| write a follow-up on a quote | `/draft-quote-chase` |
| save the review as a draft | `/draft-weekly` |
| which treatment for which use | `/end-uses` |
| export everything | `/export` |
| a delivery could not be made | `/fail` |
| bring data from BisTrack | `/import` |
| invoice an order | `/invoice` |
| truck loads, is a truck overloaded | `/loads` |
| add a note | `/log` |
| quote lost | `/lose` |
| margin by account | `/margins` |
| the trucks today, the run sheet | `/morning-run` |
| price a job, new quote | `/new-quote` |
| a new dashboard page | `/new-view` |
| look up an order | `/order` |
| a payment came in | `/pay` |
| prices under cost | `/price-floor` |
| set a contract price | `/price` |
| look up a product | `/product` |
| look up a quote | `/quote` |
| quotes to follow up | `/quotes-to-chase` |
| the quote pipeline | `/quotes` |
| stock arrived | `/receive` |
| what to order in | `/reorder` |
| how the reps are doing | `/reps` |
| who has stopped buying | `/sales-drop` |
| book a delivery | `/schedule` |
| change what a timber line is for | `/set-use` |
| dead or slow stock | `/slow` |
| month-end statements | `/statements` |
| stock levels | `/stock` |
| who to stop, credit watch, over limit | `/stop-list` |
| put an account on stop or release it | `/stop` |
| is the timber right for the job, H3.2, H4, H5 | `/treatment-check` |
| the Monday review | `/weekly-review` |
| quote accepted, turn it into an order | `/win` |

If an ask fits nothing here, run the CLI directly (`npm run <cli> -- --help`) and then propose a new command for it.

## How a merchant runs (read before you change anything)

- Prices are stored excluding GST, in cents. GST is added on invoices and documents from `merchant.settings.gst_pct`.
- An account's price is its contract price if current, else list less its price level's discount (`merchant.price_for`).
- Exposure is what an account owes plus what it has ordered and not yet been invoiced for. Credit decisions use exposure, not the balance.
- Every treated timber line carries an end use. `merchant.end_uses` says the minimum hazard class for each use; the operator owns that table and docs/compliance.md cites where each row comes from.
- `/win` and `/schedule` refuse a rule breach or a credit block unless the operator names who accepts it (`--override-by`), and that is noted on the record.
- Stock leaves the branch on delivery (or on invoice, for a pickup).

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis and the guide for moving off Epicor BisTrack.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/bistrack
