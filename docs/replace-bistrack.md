# Moving from Epicor BisTrack

BisTrack holds your trade accounts, price groups, products, stock by branch, quotes, orders, deliveries and invoices, with its own ledger behind them. Epicor's help for exporting lives on its customer portal and in the in-app help rather than in public, and what you can save depends on your version, your reports and your permissions. The usual route is a customer list and a product list saved from a BisTrack report or grid to Excel, then saved as CSV. If you cannot find the right report, ask your Epicor partner for the extract; BisTrack also has a web API that a developer can read from. Test the import, then run both side by side for a month-end before you stop paying.

## 1. Branches and price levels first

Add each branch and price level with `/add` (types `branches` and `price_levels`) using the codes your export uses. The import matches an account's branch and price group by code or name, and stops if one is missing.

## 2. Customers (trade accounts)

Column names depend on how your report is set up, so check them against this list. Each field accepts any of the names shown (case does not matter):

| Field | Accepted column names |
|---|---|
| account code | Customer Code, Account Code, Account, Customer No, Customer Number, Code |
| name | Customer Name, Account Name, Name |
| credit limit | Credit Limit, Limit |
| price level | Price Group, Price Level, Pricing Group, Customer Price Group |
| branch | Branch, Home Branch, Site |
| rep | Sales Rep, Salesperson, Rep, Account Manager |
| email, phone | Email, E-mail, Accounts Email; Phone, Telephone, Phone Number |
| address | Address, Billing Address, Invoice Address, Postal Address |
| business number | NZBN, ABN, Company Number, Business Number |
| contact | Contact, Contact Name |
| on stop | On Stop, Stopped, Credit Stop, Account Stopped (Yes or No) |
| cash account | Cash Account, Cash Sale (Yes or No) |

```bash
npm run merchant -- import bistrack-customers --file=imports/customers.csv --dry-run
npm run merchant -- import bistrack-customers --file=imports/customers.csv
```

## 3. Products and stock

| Field | Accepted column names |
|---|---|
| product code | Product Code, Product, Item Code, Code, SKU |
| description | Description, Product Description, Name |
| category | Product Group, Category, Group, Department (read as timber, sheet, roofing, concrete, hardware, fixings or landscape) |
| unit | Unit, UOM, Stock Unit, Unit of Measure |
| cost | Cost, Average Cost, Replacement Cost, Last Cost, Standard Cost (excluding GST) |
| list price | List Price, Retail Price, Sell Price, Price 1, Retail (excluding GST) |
| treatment | Treatment, Hazard Class, Treatment Level (H1.2, H3.2, H4, untreated...) |
| grade | Grade, Stress Grade |
| weight | Weight, Weight (kg), Unit Weight |
| supplier | Supplier, Main Supplier, Vendor |
| stock | Stock, On Hand, Qty On Hand, Free Stock, with Branch or Site for where it sits |

```bash
npm run merchant -- import bistrack-products --file=imports/products.csv --dry-run
npm run merchant -- import bistrack-products --file=imports/products.csv
```

Sample files: `examples/bistrack-customers.csv` and `examples/bistrack-products.csv`.

## What the import does

- A code that already exists stops the whole file and nothing is written. Re-running the same file skips rows already imported.
- Treatment must be a hazard class; anything else (a brand name, "CCA") stops the file with the row number, so fix the column first.
- Many BisTrack product groups do not say "timber". Check the category after the import with `npm run merchant -- products`.

## What does not carry over

- Contract prices: add them per account with `/price`, or ask Claude Code to read a price list export into `merchant.contract_prices`.
- Open quotes and orders: re-enter live ones with `/new-quote` and `/win`. Closed history can stay in BisTrack's reports or be loaded later from an export.
- Open invoices and balances: bring the aged debtors across from your ledger as opening invoices, or keep the ledger where it is (Xero or MYOB) and record only new trade.
- Security registrations, credit applications and guarantees: BisTrack may not hold these. Add the dates to each account; `/compliance` lists the accounts still missing them.
- End uses on quote lines: BisTrack quotes do not carry the hazard class each line needs. New quotes do, through `/new-quote`.
- The general ledger, bank reconciliation, payroll and GST returns stay in your accounting system.

## Side by side

Run one month both ways. Compare the aged debtors, the stock on hand for your top 50 lines, and the quotes open at month-end. When they match, stop entering into BisTrack.
