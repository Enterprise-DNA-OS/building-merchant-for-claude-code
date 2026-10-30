// npm test: a temporary database, every command, the rules and the edge cases. Never touches a live database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { migrate } from './migrate.mjs';
import { seed } from './seed.mjs';
import { run, READS, TABLES, date, cents, mapCustomerRow, mapProductRow } from './merchant.mjs';
import { parseCsv } from './lib/csv.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'merchant-test-'));
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
process.env.DATA_DIR = path.join(temp, 'db');
process.env.OUTPUT_DIR = temp;
let db; let checks = 0;
const ok = (v, msg) => { assert.ok(v, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const rejects = async (fn, re) => { await assert.rejects(fn, re); checks++; };
const file = (name, v) => { const f = path.join(temp, `${name}.json`); fs.writeFileSync(f, JSON.stringify(v)); return `--data=${f}`; };
function cli(script, args = []) {
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', script), ...args], { cwd: REPO_ROOT, env: process.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout); checks++;
  return r.stdout;
}
const one = async (sql, p = []) => (await db.query(sql, p))[0];
const rules = async () => db.query('select rule, ref, subject, severity from merchant.compliance_findings');

try {
  db = await getDb();
  if (process.env.TEST_DATABASE_URL) await db.exec('drop schema if exists merchant cascade; drop table if exists schema_migrations');
  await migrate(db);
  eq((await migrate(db)).ran.length, 0, 'repeat migration is a no-op');
  await seed(db); await seed(db);
  eq((await run(db, ['accounts'])).length, 9, 'seed is idempotent');
  eq((await one('select count(*)::int n from merchant.order_lines')).n, 43, 'order lines seeded once');
  eq((await one('select count(*)::int n from merchant.payments')).n, 7, 'payments seeded once');

  // Every read runs.
  for (const c of Object.keys(READS)) ok(Array.isArray(await run(db, [c])), c);
  ok(Array.isArray(await run(db, ['dispatch'])), 'dispatch');
  eq((await run(db, ['help'])).reads.length, Object.keys(READS).length + 2, 'help lists every read');

  // Pricing: contract beats level, level is list less its discount.
  eq(await one("select merchant.price_for((select id from merchant.accounts where code = 'WAH'), (select id from merchant.products where code = 'FR9045-H12')) p").then((r) => r.p), 360, 'contract price');
  eq(await one("select merchant.price_for((select id from merchant.accounts where code = 'KRB'), (select id from merchant.products where code = 'FR9045-H12')) p").then((r) => r.p), 421, 'builder level: 540 less 22%');
  eq((await run(db, ['price-floor'])).map((r) => r.product).join(','), 'LVL24045', 'one contract price under cost');

  // Invoices: due the 20th of the month after, GST at 15%, aged correctly.
  const inv = await one("select issued_on, due_on, net_cents, gst_cents, total_cents from merchant.invoices where code = 'INV-5012'");
  eq(inv.gst_cents, Math.round(inv.net_cents * 0.15), 'GST at 15%');
  eq(inv.total_cents, 177100, 'cash sale total incl GST');
  eq(Number(inv.due_on.slice(8, 10)), 20, 'due on the 20th');
  eq(Number(inv.due_on.slice(5, 7)), (Number(inv.issued_on.slice(5, 7)) % 12) + 1, 'month after issue');

  // Credit: exposure includes goods ordered and not yet invoiced.
  const credit = await run(db, ['credit']);
  eq(credit.map((r) => `${r.code}:${r.flag}`).sort().join(','), 'POH:over limit,SDF:overdue past stop line,TUI:over limit', 'credit watch');
  const tui = await one("select balance_cents, uninvoiced_cents, exposure_cents from merchant.credit_watch where code = 'TUI'");
  eq(Number(tui.balance_cents), 0, 'TUI owes nothing invoiced');
  ok(Number(tui.exposure_cents) > 3000000, 'but its open orders put it over the limit');
  ok((await run(db, ['debtors']))[0].code === 'SDF', 'oldest debt first');

  // Quotes: expired and gone quiet, with the right state.
  const chase = await run(db, ['chase']);
  eq(chase.map((r) => `${r.code}:${r.state}`).join(','), 'Q-1002:expired,Q-1004:chase,Q-1001:chase', 'quotes to chase, biggest first');
  const reps = await run(db, ['reps']);
  eq(reps.find((r) => r.rep === 'Jono Reid').win_rate_pct, '67', 'win rate from decided quotes');

  // Stock: committed is open orders at that branch; short and slow are found.
  const lvl = await one("select available, flag from merchant.stock_position where code = 'LVL24045' and branch = 'HAM'");
  eq(Number(lvl.available), -50, 'LVL short by 50');
  eq(lvl.flag, 'SHORT', 'flagged short');
  eq((await run(db, ['slow'])).map((r) => r.code).join(','), 'RF-CORR-RED', 'discontinued roofing is slow stock');
  eq((await run(db, ['sales-drop'])).map((r) => r.code).join(','), 'WAH', 'Waipa Homes has stopped buying');

  // Dispatch: tomorrow's flatdeck is overloaded.
  const loads = await run(db, ['loads']);
  eq(loads.filter((r) => r.flag === 'OVERLOADED').length, 1, 'one overloaded run');
  eq((await run(db, ['dispatch'])).length, 2, "today's two drops");

  // Every deliberate problem is found, with its rule.
  const found = await rules();
  const has = (rule, ref) => found.some((f) => f.rule === rule && f.ref === ref);
  ok(has('treatment-for-use', 'quote Q-1001'), 'H3.1 quoted for decking');
  ok(has('treatment-for-use', 'quote Q-1006'), 'H4 quoted for retaining posts');
  ok(has('treatment-for-use', 'order O-5010'), 'H1.2 ordered for deck framing');
  ok(has('grade-for-structure', 'order O-5010'), 'utility grade on a frame');
  ok(has('end-use-unknown', 'quote Q-1003'), 'treated timber with no end use');
  ok(has('ppsr-missing', 'TUI') && has('ppsr-missing', 'MAT'), 'credit with no registration');
  ok(found.some((f) => f.rule === 'ppsr-expiring' && f.ref === 'POH' && f.severity === 'breach'), 'lapsed registration');
  ok(found.some((f) => f.rule === 'ppsr-expiring' && f.ref === 'KRB' && f.severity === 'warn'), 'lapsing registration');
  ok(has('credit-application', 'MAT'), 'no credit application');
  ok(has('guarantee', 'KER'), 'no guarantee');
  ok(has('product-information', 'LVL24045'), 'imported designated product with no information');
  ok(has('buyer-details', 'INV-5012'), 'cash sale over the threshold with no address');
  ok(has('stop-list-dispatch', 'D-7012') && has('stop-list-dispatch', 'D-7013'), 'deliveries booked for stopped accounts');
  ok(!found.some((f) => ['quote Q-1004', 'quote Q-1005', 'order O-5009'].includes(f.ref)), 'correct timber raises nothing');
  const att = await run(db, ['attention']);
  for (const a of ['dispatch', 'credit', 'quotes', 'rules', 'stock', 'pricing', 'accounts']) ok(att.some((i) => i.area === a), `attention covers ${a}`);

  // Australian rules switch with the jurisdiction setting.
  await db.exec("update merchant.settings set jurisdiction = 'AU'");
  ok(!(await rules()).some((f) => f.rule === 'product-information' || f.rule === 'buyer-details'), 'NZ-only rules off in Australia');
  await db.exec("update merchant.settings set jurisdiction = 'NZ'");

  // Lookups: case-insensitive names, partial codes, ambiguity lists candidates.
  eq((await run(db, ['account', 'waipa homes'])).account.code, 'WAH', 'case-insensitive name');
  eq((await run(db, ['product', 'lvl'])).product.code, 'LVL24045', 'partial name');
  await rejects(() => run(db, ['account', 'ka']), /Ambiguous accounts "ka": .*POH.*KRB|Ambiguous accounts "ka": .*KRB.*POH/);
  await rejects(() => run(db, ['account', 'nobody']), /No accounts match/);
  ok((await run(db, ['product', 'DK14032-H31'])).allowed_uses.find((u) => u.code === 'decking').ok === 'no', 'product shows the uses it may not go to');

  // Quote, win, schedule, deliver, invoice, pay: the whole trade cycle.
  const q = await run(db, ['quote', 'HRK', '--lines=FR9045-H12:300:framing,JS19045-H32:40:deck-framing,PL125-H5:8:piles', '--job=HRK-CAM15']);
  eq(q.quote, 'Q-1007', 'next quote number');
  eq(q.rule_findings.length, 0, 'a correct quote has no findings');
  await rejects(() => run(db, ['quote', 'HRK', '--lines=FR9045-H12:10:fence']), /Unknown end use/);
  await rejects(() => run(db, ['quote', 'HRK', '--lines=FR9045-H12']), /Cannot read line/);
  await rejects(() => run(db, ['win', 'Q-1001']), /treatment-for-use/);
  await rejects(() => run(db, ['win', 'Q-1003']), /credit: TUI would be at/);
  const won = await run(db, ['win', 'Q-1007', '--required=2030-01-15', '--po=CAM15-09']);
  eq(won.order, 'O-5016', 'won quote becomes the next order');
  eq((await one("select status from merchant.quotes where code = 'Q-1007'")).status, 'won', 'quote marked won');
  eq((await one("select count(*)::int n from merchant.order_lines l join merchant.orders o on o.id = l.order_id where o.code = 'O-5016'")).n, 3, 'lines carried across');
  const forced = await run(db, ['win', 'Q-1006', '--override-by=Jono Reid', '--pickup']);
  eq(forced.accepted_problems.length, 1, 'override records what was accepted');
  ok((await one("select body from merchant.notes where body like 'Converted from Q-1006%'")).body.includes('treatment-for-use'), 'override noted');
  await rejects(() => run(db, ['schedule', 'O-5006', '--truck=FD1']), /overdue/);
  const sch = await run(db, ['schedule', 'O-5016', '--truck=CR1', '--on=2030-01-15', '--slot=pm']);
  eq(sch.drops, 1, 'booked on the crane truck');
  await rejects(() => run(db, ['schedule', 'O-5016', '--truck=CR1', '--slot=noon']), /--slot must be/);
  const before = Number((await one("select s.on_hand from merchant.stock s join merchant.products p on p.id = s.product_id join merchant.branches b on b.id = s.branch_id where p.code = 'PL125-H5' and b.code = 'HAM'")).on_hand);
  await rejects(() => run(db, ['invoice', 'O-5016']), /invoice once it is delivered/);
  eq((await run(db, ['deliver', sch.delivery, '--signed-by=Tom'])).status, 'delivered', 'delivered');
  const after = Number((await one("select s.on_hand from merchant.stock s join merchant.products p on p.id = s.product_id join merchant.branches b on b.id = s.branch_id where p.code = 'PL125-H5' and b.code = 'HAM'")).on_hand);
  eq(before - after, 8, 'stock leaves the yard on delivery');
  await rejects(() => run(db, ['deliver', sch.delivery, '--signed-by=Tom']), /not scheduled/);
  const newInv = await run(db, ['invoice', 'O-5016']);
  eq(newInv.code, 'INV-5016', 'invoice numbered from the order');
  eq(Number(newInv.due_on.slice(8, 10)), 20, 'new invoice on terms');
  await rejects(() => run(db, ['pay', 'INV-5016', `--amount=${newInv.total_cents}`]), /more than that/);
  const half = Math.floor(newInv.total_cents / 2);
  eq((await run(db, ['pay', 'INV-5016', `--amount=${(half / 100).toFixed(2)}`])).still_owing, ((newInv.total_cents - half) / 100).toFixed(2), 'part payment');
  await run(db, ['pay', 'INV-5016', `--amount=${((newInv.total_cents - half) / 100).toFixed(2)}`]);
  eq((await one("select status from merchant.invoices where code = 'INV-5016'")).status, 'paid', 'paid in full closes it');
  eq((await run(db, ['fail', 'D-7011', '--reason=No crane access'])).status, 'failed', 'failed delivery');
  ok((await run(db, ['attention'])).some((r) => r.item === 'D-7011'), 'failed drop surfaces until rebooked');

  // Credit actions, prices, costs, stock, uses.
  eq((await run(db, ['stop', 'SDF', '--by=Jono', '--reason=71 days overdue'])).status, 'on stop', 'account on stop');
  await rejects(() => run(db, ['stop', 'SDF', '--by=Jono', '--reason=again']), /already on stop/);
  eq((await run(db, ['release', 'SDF', '--by=Mere'])).status, 'open', 'released');
  eq((await run(db, ['price', 'HRK', 'LVL24045', '--price=26.50'])).warning, '', 'contract price reset above cost');
  eq((await run(db, ['price-floor'])).length, 0, 'nothing under cost now');
  eq((await run(db, ['cost', 'FR9045-H12', '--cost=4.50'])).now_below_cost.length, 3, 'a cost rise shows the prices it breaks');
  eq(Number((await run(db, ['receive', 'LVL24045', '--branch=HAM', '--qty=60'])).on_hand), 120, 'stock received');
  eq((await run(db, ['set-use', 'quote', 'Q-1003', '--product=BT4520-H31', '--use=cavity-batten'])).end_use, 'cavity-batten', 'end use set');
  ok(!(await rules()).some((f) => f.rule === 'end-use-unknown'), 'and the warning clears');
  eq((await run(db, ['contact', 'Q-1004', '--by=Mere', '--text=Rangi wants the posts first'])).code, 'Q-1004', 'contact logged');
  ok(!(await run(db, ['chase'])).some((r) => r.code === 'Q-1004'), 'contacted quote leaves the chase list');
  eq((await run(db, ['lose', 'Q-1002', '--reason=Truss plant direct'])).status, 'lost', 'lost with reason');
  eq((await run(db, ['log', 'account', 'WAH', '--author=Mere', '--text=Call booked'])).logged, 'WAH', 'note logged');

  // Add records through files, with references by code.
  eq((await run(db, ['add', 'branches', file('branch', { code: 'CAM', name: 'Cambridge' })])).codes[0], 'CAM', 'branch added');
  eq((await run(db, ['add', 'accounts', file('acct', { code: 'NEW1', name: 'New Builder Ltd', branch: 'CAM', price_level: 'TRADE', credit_limit_cents: 500000 })])).codes[0], 'NEW1', 'account added by codes');
  ok((await rules()).some((f) => f.rule === 'ppsr-missing' && f.ref === 'NEW1'), 'new credit account needs registering');
  await rejects(() => run(db, ['add', 'accounts', file('bad', { code: 'X', name: 'X', colour: 'red' })]), /no field "colour"/);

  // Import from BisTrack exports: dry run, real run, re-run skips, clash stops the whole file.
  const custCsv = path.join(temp, 'customers.csv');
  fs.copyFileSync(path.join(REPO_ROOT, 'examples', 'bistrack-customers.csv'), custCsv);
  const dry = await run(db, ['import', 'bistrack-customers', `--file=${custCsv}`, '--dry-run']);
  eq(dry.inserted, 3, 'dry run counts');
  eq((await one("select count(*)::int n from merchant.accounts where code like 'BT%'")).n, 0, 'dry run writes nothing');
  eq((await run(db, ['import', 'bistrack-customers', `--file=${custCsv}`])).inserted, 3, 'customers imported');
  eq((await run(db, ['import', 'bistrack-customers', `--file=${custCsv}`])).skipped_identical, 3, 're-run skips');
  eq((await one("select status from merchant.accounts where code = 'BT1003'")).status, 'on_stop', 'stop flag carried');
  const prodCsv = path.join(temp, 'products.csv');
  fs.copyFileSync(path.join(REPO_ROOT, 'examples', 'bistrack-products.csv'), prodCsv);
  const pr = await run(db, ['import', 'bistrack-products', `--file=${prodCsv}`]);
  eq(pr.inserted, 4, 'products imported');
  eq(pr.stock_rows, 4, 'stock imported');
  eq((await one("select treatment from merchant.products where code = 'BT-DECK'")).treatment, 'H3.2', 'treatment read');
  fs.writeFileSync(path.join(temp, 'clash.csv'), 'Customer Code,Customer Name\nBT9,Fine\nKRB,Clash\n');
  await rejects(() => run(db, ['import', 'bistrack-customers', `--file=${path.join(temp, 'clash.csv')}`]), /KRB already exists/);
  eq((await one("select count(*)::int n from merchant.accounts where code = 'BT9'")).n, 0, 'clash rolls back the whole file');
  ok(mapProductRow({ Description: 'Post', 'Product Code': 'P1', Treatment: 'untreated' }, 2).treatment === 'untreated', 'untreated read');
  await assert.rejects(() => Promise.resolve().then(() => mapProductRow({ Description: 'Post', 'Product Code': 'P1', Treatment: 'CCA' }, 2)), /not a hazard class/); checks++;
  eq(mapCustomerRow({ Account: 'A1', Name: 'Cash', 'Cash Account': 'Yes' }, 2).kind, 'cash', 'cash account read');
  eq(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')[0].b, 'say "hi"', 'csv quoting');

  // Drafts never send; they land in drafts/.
  const dq = await run(db, ['draft-quote-chase', 'Q-1001']);
  ok(fs.readFileSync(dq.draft, 'utf8').includes('requote that line'), 'chase draft flags the wrong treatment');
  ok(fs.readFileSync((await run(db, ['draft-overdue', 'POH'])).draft, 'utf8').includes('overdue'), 'overdue letter');
  await rejects(() => run(db, ['draft-overdue', 'HRK']), /nothing overdue/);
  eq((await run(db, ['draft-weekly'])).sections, 6, 'weekly review drafted');

  // Export covers every table.
  const ex = await run(db, ['export', `--out=${path.join(temp, 'export.json')}`]);
  eq(ex.tables, TABLES.length, 'every table exported');

  // Helpers and argument checks.
  eq(cents('$1,249.50'), 124950, 'cents parse');
  await assert.rejects(async () => date('2026-02-30'), /Invalid date/); checks++;
  await rejects(() => run(db, ['credit', '--colour=red']), /Unknown option/);
  await rejects(() => run(db, ['nonsense']), /Unknown command/);

  // The CLI, views and documents run as a person would run them.
  await db.close(); db = null;
  ok(cli('merchant.mjs', ['attention']).includes('area'), 'CLI prints a table');
  ok(JSON.parse(cli('merchant.mjs', ['chase', '--json'])).length >= 1, 'CLI --json');
  ok(cli('view.mjs').includes('view:'), 'views render');
  ok(cli('docs.mjs').includes('document(s) rendered'), 'documents render');
  for (const v of JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'views.json'), 'utf8'))) ok(fs.existsSync(path.join(temp, 'views', `${v.name}.html`)), `view ${v.name} written`);
  ok(fs.readdirSync(path.join(temp, 'docs-out', 'trade-statement')).length >= 1, 'statements written');

  console.log(`PASS: ${checks} checks`);
} finally {
  if (db) await db.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
