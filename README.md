<h1 align="center">Building Merchant for Claude Code</h1>

<p align="center">
  <strong>The open-source timber and building supplies merchant system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your Epicor BisTrack data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=bistrack">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/bistrack?utm_source=github&utm_medium=readme&utm_campaign=bistrack">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#instead-of-bistrack">Instead of Epicor BisTrack</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Building Merchant for Claude Code does the job you pay Epicor BisTrack for, as a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask for what you want in plain language. It runs the right query, and it can answer questions the Epicor BisTrack dashboard cannot.

Epicor does not publish a BisTrack price. It is quoted by the modules you take, and G2 reviewers put a typical implementation at six months ([G2](https://www.g2.com/products/epicor-bistrack/pricing), [Software Advice](https://softwareadvice.com/scm/epicor-bistrack-profile/), checked 30 October 2026). In Epicor's own Verdon Timber case study, 45 of the merchant's 105 staff are BisTrack users ([Epicor](https://epicor.com/en-uk/resources/success-stories/building-supply/verdon-timber)). The free code still has hosting, agent and support costs.

Want the same thing with a web front end, or built on a different stack? That is a customisation, and it is exactly what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=bistrack).

It is for owner-run timber yards, building supplies merchants and hardware trade counters in New Zealand and Australia with one to five branches. It keeps trade accounts with price levels, contract prices, credit limits and security registrations, builders' jobs and sites, quotes with the end use of every timber line, orders, delivery runs by truck and slot with load weights, stock by branch with what open orders have committed, invoices due on the account's terms day, payments and aged debtors. It checks every treated timber line against the hazard class its use needs, structural uses against a stress grade, trade credit against the Personal Property Securities Act, designated products against the New Zealand product information regulations, and large invoices against the GST record rules, with each rule cited in [docs/compliance.md](docs/compliance.md).

The demo is a fictional two-branch Waikato merchant, Ridgeline Timber and Trade. It has decking quoted in H3.1 boards, utility-grade framing and H1.2 deck joists on an order going out this afternoon, H4 posts quoted for a retaining wall, a builder over their limit once open orders are counted, a fencing contractor more than 60 days overdue with a delivery booked tomorrow, a flatdeck loaded to 136%, an expired NZ$37,000 frame package nobody chased, an imported LVL beam selling under cost and short for orders, a lapsed and a lapsing security registration, a cash sale over NZ$1,000 with no address, and the key account that has quietly stopped buying.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export, no lock-in.
- No seats, no tiers, no add-ons. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/building-merchant-for-claude-code.git
cd building-merchant-for-claude-code
npm install
npm run demo
```

Then open the folder in Claude Code and type `/attention`. Follow it with `/morning-run`, `/stop-list` and `/treatment-check`.

Or from the terminal:

```bash
npm test
npm run merchant -- attention
npm run view
npm run docs
```

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee.

## The commands

| Command | What it does |
|---|---|
| `/account` | One trade account: position, open invoices, quotes, orders, contract prices, jobs, findings and notes. |
| `/add` | Add branches, trucks, price levels, products, accounts or jobs from a JSON file. |
| `/attention` | Everything that needs someone today across the yard, the counter and the office: drops not picked, failed deliveries, overloaded trucks, accounts over limit or past the stop line, quotes to chase, rule breaches, stock short for orders, prices under cost and builders buying less. |
| `/compliance` | Check the records against the rules this industry lives under (the ones listed in docs/compliance.md) and report what is missing, late, or about to breach, with the rule cited. |
| `/contact` | Log a call or email on a quote so it leaves the chase list. |
| `/cost` | Record a supplier cost change, and see every contract price and level it pushes under cost. |
| `/customise` | Make this system yours in plain language. |
| `/debtors` | Aged debtors: current, 1 to 30, 31 to 60 and over 60 days, oldest first. |
| `/deliver` | Mark a delivery done with who signed for it. |
| `/dispatch` | The delivery runs for a day (today unless a date is given). |
| `/documents` | Render the paperwork: trade statements, quotes, delivery dockets and tax invoices, in your brand. |
| `/draft-overdue` | Draft an overdue reminder for one account, listing each overdue invoice. |
| `/draft-quote-chase` | Draft a follow-up to the customer on one quote: what it covers, whether it has expired, and any line that needs a different treatment. |
| `/draft-weekly` | Save the weekly review as a draft in drafts/. |
| `/end-uses` | The end uses and the minimum hazard class each needs, with the source. |
| `/export` | Write every record to one JSON file. |
| `/fail` | Record a delivery that could not be made, with the reason, so it stays on the attention list until rebooked. |
| `/import` | Bring customers or products across from an Epicor BisTrack export (a grid or report saved as CSV). |
| `/invoice` | Invoice a delivered order (or a collected pickup), due on the account's terms day of the following month, with GST. |
| `/loads` | Truck loads from today on: drops, kilograms against capacity, and runs that are overloaded. |
| `/log` | Add a note to an account, quote, order, product, job or delivery. |
| `/lose` | Close a quote as lost, with the reason. |
| `/margins` | Margin by account over the last 90 days, lowest first. |
| `/morning-run` | The morning dispatch check: today's drops by truck and slot, what is not picked yet, truck loads, and any drop booked for an account on stop. |
| `/new-quote` | Price a quote for an account from product codes and quantities, at the account's contract or level price, with each timber line's end use so the treatment is checked. |
| `/new-view` | Add a read-only HTML view (a dashboard page) from a plain-language description, rendered in the operator's brand by `npm run view`. |
| `/order` | One order: lines, deliveries and findings. |
| `/pay` | Record a payment against an invoice. |
| `/price-floor` | Contract prices and price levels now selling under replacement cost. |
| `/price` | Set or change an account's contract price for a product. |
| `/product` | One product: stock by branch, price by level and margin, and the end uses its treatment allows. |
| `/quote` | One quote: lines, prices, treatment against end use, findings and notes. |
| `/quotes-to-chase` | Open quotes gone quiet past the chase line, or past their validity, biggest first. |
| `/quotes` | Every open quote with value, margin, days since contact and state. |
| `/receive` | Book stock in at a branch. |
| `/reorder` | What to order in: lines short for open orders and lines at or under their reorder point. |
| `/reps` | Rep scorecard for the last 180 days: quotes, won, lost, win rate and value. |
| `/sales-drop` | Trade accounts buying much less than in the 90 days before: the builder who has gone to another merchant. |
| `/schedule` | Book an order onto a truck, a day and a slot. |
| `/set-use` | Record or correct the end use of a timber line on a quote or order, which re-runs the treatment check. |
| `/slow` | Slow stock: on hand with no sale past the slow line, by value tied up. |
| `/statements` | Month-end trade statements for every account with money owing, with ageing and the retention of title line. |
| `/stock` | Stock by product and branch: on hand, committed to open orders, available, reorder point and days since last sale. |
| `/stop-list` | The credit watch: accounts over their limit once open orders are counted, invoices past the stop line, and accounts already on stop. |
| `/stop` | Put an account on stop with the reason, or release it. |
| `/treatment-check` | Check every open quote and order line of treated timber against the hazard class its end use needs, and structural uses against a stress grade. |
| `/weekly-review` | The Monday review, written from attention, quotes to chase, the stop list, rule checks, reorder and the rep scorecard. |
| `/win` | Turn an accepted quote into an order with the same lines and prices. |

Views (`npm run view`): `week` (runs, loads, quotes to chase, credit, rule findings), `yard` (short, reorder, slow stock, prices under cost), `accounts` (aged debtors, buying less, margin, reps). Documents (`npm run docs`): trade statements, quotes, delivery dockets, tax invoices, in your `brand.json`.

## Ten questions BisTrack's screens do not answer

Each one is a single question to Claude Code, answered from your own records today:

1. Which treated timber on quotes and orders this week is below the hazard class its use needs, and what should it be instead?
2. Which builders are over their credit limit once the orders not yet invoiced are counted, not just what they owe?
3. Which trade accounts have credit and no security registration, and which registrations lapse in the next 90 days?
4. Which quotes over NZ$5,000 have gone a week without a call, and whose are they?
5. Which contract prices and price levels went under cost when the last supplier increase came through?
6. Which builders bought less than half as much in the last 90 days as in the 90 before?
7. Which truck runs tomorrow are over the truck's capacity, and which drop should move?
8. What is short at each branch for orders already taken, as distinct from what is under its reorder point?
9. What is our margin by account after contract prices, and which builder-level accounts earn less than trade?
10. What is each rep's win rate, and what reasons do the lost quotes give?

## Instead of Epicor BisTrack

Save your customer and product lists from BisTrack to CSV and run `/import`. [docs/replace-bistrack.md](docs/replace-bistrack.md) lists the column names the import reads, what carries over and what does not, and how to run both side by side for a month-end.

## Your first hour: ten things to ask for

1. "Set up our three branches and our trade price levels." (`/add`)
2. "Import our customers and products from these BisTrack exports." (`/import`)
3. "Put Ridgeline's name, logo and colours on the documents." (edit `brand.json`, then `npm run docs`)
4. "What goes out on the trucks today, and is anything not picked?" (`/morning-run`)
5. "Who should be on the stop list?" (`/stop-list`)
6. "Which quotes should the reps call this week?" (`/quotes-to-chase`)
7. "Check every treated timber line against its end use." (`/treatment-check`)
8. "Pine went up 8% from Monday. What prices does that break?" (`/cost`)
9. "Add a field for the builder's LBP number on each job." (`/customise`)
10. "Give me a page I can print for the Monday meeting." (`/new-view`)

## Architecture

```
building-merchant-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/                  the CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema
  supabase/seed.sql         demo data
  docs/                     the thesis and the migration guide
```

## Built for coding agents

The database, CLI and command recipes work with Claude Code, Codex, OpenCode or Cursor. Ask your coding agent for a new command and have it implement and test the change against the same records.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Building Merchant for Claude Code for your business, migrates your Epicor BisTrack data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=bistrack)
- Read more: [enterprisedna.co/omni/instead-of/bistrack](https://enterprisedna.co/omni/instead-of/bistrack?utm_source=github&utm_medium=readme&utm_campaign=bistrack)

## License

MIT. Copyright (c) 2026 Enterprise DNA.
