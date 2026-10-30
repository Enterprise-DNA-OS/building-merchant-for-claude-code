#!/usr/bin/env node
// The one CLI. Every slash command drives this file.
//   npm run merchant -- help
//   npm run merchant -- dispatch [--on=YYYY-MM-DD] [--json]
// Reads print aligned tables; --json prints rows for machines. Writes run in one transaction.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick, yesNo } from './lib/csv.mjs';
import { table } from './lib/format.mjs';

export const TABLES = ['settings', 'branches', 'trucks', 'price_levels', 'treatment_classes', 'end_uses', 'products', 'stock', 'accounts',
  'contract_prices', 'jobs', 'quotes', 'quote_lines', 'orders', 'order_lines', 'deliveries', 'invoices', 'payments', 'notes', 'import_rows'];

const money = (col) => `case when ${col} is null then null else (select currency from merchant.settings) || ' ' || to_char((${col}) / 100.0, 'FM999G999G990D00') end`;
export const READS = {
  accounts: `select code, name, kind, coalesce(rep, '') rep, branch, price_level level, ${money('credit_limit_cents')} credit_limit,
    ${money('balance_cents')} owing, oldest_overdue_days days_overdue, last_order_on, replace(status, '_', ' ') status from merchant.account_position order by name`,
  credit: `select code, name, coalesce(rep, '') rep, ${money('credit_limit_cents')} credit_limit, ${money('balance_cents')} owing,
    ${money('uninvoiced_cents')} not_yet_invoiced, ${money('headroom_cents')} headroom, ${money('overdue_31_60_cents + overdue_60_plus_cents')} over_30_days,
    oldest_overdue_days days_overdue, replace(status, '_', ' ') status, flag
    from merchant.credit_watch where flag <> '' or status = 'on_stop' order by flag = 'over limit' desc, oldest_overdue_days desc`,
  debtors: `select code, name, ${money('current_cents')} current, ${money('overdue_1_30_cents')} overdue_1_30, ${money('overdue_31_60_cents')} overdue_31_60,
    ${money('overdue_60_plus_cents')} overdue_60_plus, ${money('balance_cents')} total, oldest_overdue_days days
    from merchant.account_position where balance_cents > 0 order by overdue_60_plus_cents desc, overdue_31_60_cents desc, balance_cents desc`,
  quotes: `select code, account, account_name, coalesce(job, '') job, rep, quoted_on, valid_to, ${money('value_cents')} value,
    round(100.0 * margin_cents / nullif(value_cents, 0), 1) margin_pct, days_since_contact, state
    from merchant.quote_pipeline order by state = 'live', value_cents desc`,
  chase: `select code, account_name account, coalesce(job, '') job, rep, ${money('value_cents')} value, days_since_contact,
    case when state = 'expired' then 'expired ' || -days_left || ' days ago' else days_left || ' days left' end validity, state
    from merchant.quote_pipeline where state in ('chase', 'expired') order by value_cents desc`,
  reps: `select rep, quotes, won, lost, open, coalesce(win_rate_pct::text, '') win_rate_pct, ${money('quoted_cents')} quoted, ${money('won_cents')} won_value,
    ${money('open_cents')} open_value from merchant.rep_scorecard order by won_cents desc`,
  loads: `select run_on, slot, truck, drops, load_kg, capacity_kg, load_pct, flag from merchant.truck_load where run_on >= current_date order by run_on, slot, truck`,
  stock: `select code, name, branch, unit, on_hand, committed, available, reorder_point, coalesce(days_since_sale::text, '') days_since_sale, flag
    from merchant.stock_position order by flag = '', branch, code`,
  reorder: `select code, name, branch, unit, on_hand, committed, available, reorder_point, flag from merchant.stock_position
    where flag in ('SHORT', 'reorder') order by flag = 'SHORT' desc, available - reorder_point`,
  slow: `select code, name, branch, on_hand, unit, ${money('stock_value_cents')} stock_value, last_sold_on, days_since_sale from merchant.stock_position
    where flag = 'slow' order by stock_value_cents desc`,
  'price-floor': `select kind, account, account_name, product, product_name, ${money('price_cents')} price, ${money('cost_cents')} cost, margin_pct, cost_changed_on
    from merchant.price_floor order by margin_pct`,
  margins: `select code, name, rep, price_level level, orders, ${money('sales_cents')} sales_90_days, ${money('margin_cents')} margin, margin_pct
    from merchant.account_margin order by margin_pct`,
  'sales-drop': `select code, name, coalesce(rep, '') rep, ${money('sales_prior_90_cents')} previous_90_days, ${money('sales_90_cents')} last_90_days,
    round(100.0 * (sales_prior_90_cents - sales_90_cents) / sales_prior_90_cents, 0) drop_pct, last_order_on
    from merchant.account_position where sales_prior_90_cents > 0
    and sales_90_cents < sales_prior_90_cents * (100 - (select sales_drop_pct from merchant.settings)) / 100.0 order by sales_prior_90_cents - sales_90_cents desc`,
  products: `select code, name, category, unit, coalesce(treatment, '') treatment, coalesce(grade, '') grade, ${money('cost_cents')} cost, ${money('list_cents')} list,
    case when designated_product then coalesce(nullif(product_info_url, ''), 'MISSING') else '' end product_info from merchant.products where active order by category, code`,
  'end-uses': `select e.code, e.name, e.min_treatment, e.needs_grade, e.source from merchant.end_uses e
    where e.jurisdiction = (select jurisdiction from merchant.settings) order by merchant.treatment_rank(e.min_treatment), e.code`,
  compliance: `select rule, severity, ref, subject, detail from merchant.compliance_findings order by severity = 'breach' desc, rule, ref`,
  orders: `select ov.code, a.name account, coalesce(j.name, '') job, ov.ordered_on, ov.required_on, ov.fulfilment, ${money('ov.net_cents')} value, ov.weight_kg, ov.status
    from merchant.order_value ov join merchant.accounts a on a.id = ov.account_id left join merchant.jobs j on j.id = ov.job_id
    where ov.status in ('open', 'picked', 'delivered') order by ov.required_on, ov.code`,
};

const OPTION_READS = {
  dispatch: { opts: ['on'], run: (db, o) => db.query(`select code, slot, truck, order_code, account, site, weight_kg, status, order_status,
      case when account_status = 'on_stop' then 'ON STOP' else '' end account_flag
      from merchant.dispatch_board where run_on = coalesce($1::date, current_date) order by slot, truck, code`, [o.on ? date(o.on) : null]) },
};

const ADD_FIELDS = {
  branches: ['code', 'name', 'address'],
  trucks: ['code', 'name', 'kind', 'capacity_kg', 'branch_id'],
  price_levels: ['code', 'name', 'discount_pct'],
  products: ['code', 'name', 'category', 'unit', 'species', 'treatment', 'grade', 'weight_kg', 'cost_cents', 'list_cents', 'supplier', 'own_import',
    'designated_product', 'product_info_url'],
  accounts: ['code', 'name', 'kind', 'branch_id', 'rep', 'price_level_id', 'credit_limit_cents', 'terms_day', 'contact', 'email', 'phone', 'billing_address',
    'business_number', 'credit_app_on', 'guarantee_signed', 'ppsr_registered_on', 'ppsr_expires_on'],
  jobs: ['account_id', 'code', 'name', 'site_address', 'consent_ref'],
};
const REFS = { branch_id: 'branches', price_level_id: 'price_levels', account_id: 'accounts' };
const LOOKUP = {
  branches: { label: 'branches', sql: 'select id, code, name from merchant.branches' },
  price_levels: { label: 'price levels', sql: 'select id, code, name from merchant.price_levels' },
  trucks: { label: 'trucks', sql: 'select id, code, name from merchant.trucks' },
  accounts: { label: 'accounts', sql: 'select id, code, name from merchant.accounts' },
  products: { label: 'products', sql: 'select id, code, name from merchant.products' },
  jobs: { label: 'jobs', sql: 'select id, code, name from merchant.jobs' },
  quotes: { label: 'quotes', sql: 'select id, code, code as name from merchant.quotes' },
  orders: { label: 'orders', sql: 'select id, code, code as name from merchant.orders' },
  deliveries: { label: 'deliveries', sql: 'select id, code, code as name from merchant.deliveries' },
  invoices: { label: 'invoices', sql: 'select id, code, code as name from merchant.invoices' },
};

const HELP = {
  reads: [...Object.keys(READS), ...Object.keys(OPTION_READS), 'attention'].sort(),
  details: ['account <ref>', 'quote <ref>', 'order <ref>', 'product <ref>'],
  writes: ['add <branches|trucks|price_levels|products|accounts|jobs> --data=<file.json>',
    'log <account|quote|order|product|job|delivery> <ref> --author= --text=',
    'quote <account> --lines=CODE:qty[:end-use],... [--job=] [--rep=] [--branch=] [--valid-days=]',
    'contact <quote> --by= [--text=]', 'win <quote> [--required=YYYY-MM-DD] [--pickup] [--po=] [--override-by=]', 'lose <quote> --reason=',
    'set-use <quote|order> <ref> --product=<code> --use=<end-use>',
    'schedule <order> --truck= [--on=YYYY-MM-DD] [--slot=am|pm] [--override-by=]', 'deliver <delivery> --signed-by=', 'fail <delivery> --reason=',
    'invoice <order>', 'pay <invoice> --amount= [--on=YYYY-MM-DD] [--ref=]',
    'stop <account> --by= --reason=', 'release <account> --by= [--reason=]',
    'price <account> <product> --price= [--to=YYYY-MM-DD]', 'cost <product> --cost=', 'receive <product> --branch= --qty=',
    'import bistrack-customers|bistrack-products --file=<csv> [--dry-run]', 'export --out=<file.json>',
    'draft-weekly', 'draft-quote-chase <quote>', 'draft-overdue <account>'],
};

// ------------------------------------------------------------------ helpers
export function date(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw Error(`Invalid date "${v}". Use YYYY-MM-DD.`);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw Error(`Invalid date "${v}".`);
  return v;
}
// "129", "129.00", "$1,249.50", "NZD 129" -> cents
export function cents(v, label = 'amount') {
  const s = String(v ?? '').trim().replace(/^[A-Z]{3}\s*/i, '').replace(/^[$€£]/, '').replace(/,/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw Error(`${label} "${v}" is not an amount. Use 129 or 129.50.`);
  return Math.round(Number(s) * 100);
}
function qty(v, label = 'quantity') {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) throw Error(`${label} "${v}" must be a number above zero`);
  return n;
}
function parseArgs(args) {
  const pos = []; const opts = {};
  for (const a of args) {
    if (a.startsWith('--')) { const eq = a.indexOf('='); opts[eq < 0 ? a.slice(2) : a.slice(2, eq)] = eq < 0 ? true : a.slice(eq + 1); }
    else pos.push(a);
  }
  return { pos, opts };
}
function allow(opts, names) {
  for (const k of Object.keys(opts)) if (!['json', ...names].includes(k)) throw Error(`Unknown option --${k}`);
}
function need(opts, k) { if (opts[k] === undefined || opts[k] === true || String(opts[k]).trim() === '') throw Error(`--${k} is required`); return String(opts[k]).trim(); }
function noExtra(pos, n) { if (pos.length > n) throw Error(`Unexpected argument "${pos[n]}"`); }
function oneOf(v, list, label) { if (!list.includes(v)) throw Error(`${label} must be one of: ${list.join(', ')}`); return v; }

// Code, name (case insensitive), or UUID prefix. Ambiguity lists the candidates.
export async function resolve(db, kind, ref) {
  const l = LOOKUP[kind];
  if (!ref) throw Error(`Name a ${l.label.replace(/s$/, '').replace(/ie$/, 'y')}`);
  const rows = await db.query(`select * from (${l.sql}) t where lower(code) = lower($1) or lower(name) = lower($1) or id::text like lower($1) || '%'
    or lower(name) like '%' || lower($1) || '%' or lower(code) like lower($1) || '%'`, [ref]);
  const exact = rows.filter((r) => r.code.toLowerCase() === ref.toLowerCase() || r.name.toLowerCase() === ref.toLowerCase());
  const hits = exact.length ? exact : rows;
  if (!hits.length) throw Error(`No ${l.label} match "${ref}"`);
  if (hits.length > 1) throw Error(`Ambiguous ${l.label} "${ref}": ${hits.map((r) => `${r.code} (${r.name})`).join(', ')}`);
  return hits[0];
}

async function tx(db, fn, { dryRun = false } = {}) {
  await db.exec('BEGIN');
  try { const out = await fn(); await db.exec(dryRun ? 'ROLLBACK' : 'COMMIT'); return out; }
  catch (e) { await db.exec('ROLLBACK'); throw e; }
}
async function nextCode(db, tableName, prefix) {
  const [{ n }] = await db.query(`select coalesce(max(substring(code from '\\d+$')::int), 0) + 1 n from merchant.${tableName} where code like $1 || '%'`, [prefix]);
  return `${prefix}${n}`;
}
async function note(db, type, id, author, body) {
  await db.query('insert into merchant.notes (subject_type, subject_id, author, body) values ($1, $2, $3, $4)', [type, id, author, body]);
}
// Credit check before goods leave on account: on stop, over the limit with this order, or past the stop line.
async function creditBlock(db, accountId, extraNetCents = 0) {
  const [c] = await db.query(`select cw.code, cw.kind, cw.status, cw.flag, cw.credit_limit_cents, cw.exposure_cents, cw.oldest_overdue_days,
    (select stop_overdue_days from merchant.settings) stop_days, (select gst_pct from merchant.settings) gst
    from merchant.credit_watch cw where cw.id = $1`, [accountId]);
  if (!c) return null; // cash accounts pay at the counter
  if (c.status === 'on_stop') return `${c.code} is on stop`;
  if (c.oldest_overdue_days > c.stop_days) return `${c.code} has an invoice ${c.oldest_overdue_days} days overdue (stop line ${c.stop_days})`;
  const after = Number(c.exposure_cents) + Math.round(extraNetCents * (100 + Number(c.gst)) / 100);
  if (c.credit_limit_cents > 0 && after > c.credit_limit_cents) return `${c.code} would be at ${(after / 100).toFixed(2)} against a limit of ${(c.credit_limit_cents / 100).toFixed(2)}`;
  return null;
}

// ------------------------------------------------------------------ commands
export async function run(db, argv) {
  const [cmd, ...rest] = argv;
  const { pos, opts } = parseArgs(rest);
  if (!cmd || cmd === 'help') return HELP;
  if (READS[cmd]) { allow(opts, []); noExtra(pos, 0); return db.query(READS[cmd]); }
  if (OPTION_READS[cmd]) { allow(opts, OPTION_READS[cmd].opts); noExtra(pos, 0); return OPTION_READS[cmd].run(db, opts); }

  switch (cmd) {
    case 'attention': { allow(opts, []); noExtra(pos, 0); return attention(db); }
    case 'account': {
      allow(opts, []); noExtra(pos, 1);
      const a = await resolve(db, 'accounts', pos[0]);
      return {
        account: (await db.query(`select a.code, a.name, a.kind, a.rep, b.code branch, pl.name price_level, a.contact, a.email, a.phone, a.billing_address,
          a.business_number, ${money('a.credit_limit_cents')} credit_limit, 'due the ' || a.terms_day || 'th of the month after invoice' terms,
          replace(a.status, '_', ' ') status, a.credit_app_on, a.guarantee_signed, a.ppsr_registered_on, a.ppsr_expires_on
          from merchant.accounts a left join merchant.branches b on b.id = a.branch_id left join merchant.price_levels pl on pl.id = a.price_level_id where a.id = $1`, [a.id]))[0],
        position: (await db.query(`select ${money('balance_cents')} owing, ${money('overdue_1_30_cents + overdue_31_60_cents + overdue_60_plus_cents')} overdue,
          oldest_overdue_days, ${money('uninvoiced_cents')} not_yet_invoiced, ${money('sales_90_cents')} sales_last_90_days,
          ${money('sales_prior_90_cents')} sales_previous_90_days, last_order_on from merchant.account_position where id = $1`, [a.id]))[0] || {},
        open_invoices: await db.query(`select code, issued_on, due_on, ${money('total_cents')} total, ${money('owing_cents')} owing, days_overdue
          from merchant.invoice_balance where account_id = $1 and status = 'open' order by due_on`, [a.id]),
        open_quotes: await db.query(`select code, coalesce(job, '') job, quoted_on, ${money('value_cents')} value, state from merchant.quote_pipeline
          where account = $1 order by quoted_on`, [a.code]),
        open_orders: await db.query(`select code, ordered_on, required_on, ${money('net_cents')} value, status from merchant.order_value
          where account_id = $1 and status in ('open', 'picked', 'delivered') order by ordered_on`, [a.id]),
        contract_prices: await db.query(`select p.code, p.name, ${money('cp.price_cents')} price, ${money('p.cost_cents')} cost, cp.valid_to
          from merchant.contract_prices cp join merchant.products p on p.id = cp.product_id where cp.account_id = $1 order by p.code`, [a.id]),
        jobs: await db.query('select code, name, site_address, consent_ref, status from merchant.jobs where account_id = $1 order by code', [a.id]),
        rule_findings: await db.query('select rule, severity, ref, detail from merchant.compliance_findings where ref = $1 or subject in ($1, $2)', [a.code, a.name]),
        notes: await db.query("select created_at, author, body from merchant.notes where subject_type = 'account' and subject_id = $1 order by created_at", [a.id]),
      };
    }
    case 'quote': {
      if (opts.lines !== undefined) return newQuote(db, pos, opts);
      allow(opts, []); noExtra(pos, 1);
      const q = await resolve(db, 'quotes', pos[0]);
      return {
        quote: (await db.query(`select q.code, a.name account, j.name job, j.site_address site, q.rep, q.quoted_on, q.valid_to, q.status, q.last_contact_on,
          q.lost_reason, ${money('qv.net_cents')} value, ${money('qv.net_cents - qv.cost_cents')} margin
          from merchant.quotes q join merchant.accounts a on a.id = q.account_id left join merchant.jobs j on j.id = q.job_id
          join merchant.quote_value qv on qv.id = q.id where q.id = $1`, [q.id]))[0],
        lines: await db.query(`select p.code, p.name, l.qty, p.unit, ${money('l.unit_cents')} unit_price, ${money('round(l.qty * l.unit_cents)')} line_total,
          coalesce(p.treatment, '') treatment, coalesce(l.end_use, '') end_use from merchant.quote_lines l join merchant.products p on p.id = l.product_id
          where l.quote_id = $1 order by l.created_at, p.code`, [q.id]),
        rule_findings: await db.query("select rule, detail from merchant.compliance_findings where ref = 'quote ' || $1", [q.code]),
        notes: await db.query("select created_at, author, body from merchant.notes where subject_type = 'quote' and subject_id = $1 order by created_at", [q.id]),
      };
    }
    case 'order': {
      allow(opts, []); noExtra(pos, 1);
      const o = await resolve(db, 'orders', pos[0]);
      return {
        order: (await db.query(`select ov.code, a.name account, j.name job, j.site_address site, ov.ordered_on, ov.required_on, ov.fulfilment, o.po_ref,
          ov.status, ${money('ov.net_cents')} value, ov.margin_pct, ov.weight_kg from merchant.order_value ov join merchant.orders o on o.id = ov.id
          join merchant.accounts a on a.id = ov.account_id left join merchant.jobs j on j.id = ov.job_id where ov.id = $1`, [o.id]))[0],
        lines: await db.query(`select p.code, p.name, l.qty, p.unit, ${money('l.unit_cents')} unit_price, ${money('round(l.qty * l.unit_cents)')} line_total,
          coalesce(p.treatment, '') treatment, coalesce(l.end_use, '') end_use from merchant.order_lines l join merchant.products p on p.id = l.product_id
          where l.order_id = $1 order by l.created_at, p.code`, [o.id]),
        deliveries: await db.query('select code, run_on, slot, truck, status, signed_by, fail_reason from merchant.dispatch_board where order_code = $1 order by run_on', [o.code]),
        rule_findings: await db.query("select rule, detail from merchant.compliance_findings where ref = 'order ' || $1", [o.code]),
      };
    }
    case 'product': {
      allow(opts, []); noExtra(pos, 1);
      const p = await resolve(db, 'products', pos[0]);
      return {
        product: (await db.query(`select code, name, category, unit, species, treatment, grade, weight_kg, ${money('cost_cents')} cost, ${money('list_cents')} list,
          supplier, own_import, designated_product, product_info_url, cost_changed_on from merchant.products where id = $1`, [p.id]))[0],
        stock: await db.query('select branch, on_hand, committed, available, reorder_point, last_sold_on, flag from merchant.stock_position where product_id = $1', [p.id]),
        prices_by_level: await db.query(`select pl.name level, ${money('round(p.list_cents * (1 - pl.discount_pct / 100.0))')} price,
          round(100.0 * (round(p.list_cents * (1 - pl.discount_pct / 100.0)) - p.cost_cents) / nullif(round(p.list_cents * (1 - pl.discount_pct / 100.0)), 0), 1) margin_pct
          from merchant.price_levels pl cross join merchant.products p where p.id = $1 order by pl.discount_pct`, [p.id]),
        allowed_uses: await db.query(`select e.code, e.name, e.min_treatment, case when merchant.treatment_rank(p.treatment) >= merchant.treatment_rank(e.min_treatment) then 'yes' else 'no' end ok
          from merchant.end_uses e cross join merchant.products p where p.id = $1 and e.jurisdiction = (select jurisdiction from merchant.settings)
          order by merchant.treatment_rank(e.min_treatment)`, [p.id]),
      };
    }
    case 'add': return add(db, pos, opts);
    case 'log': {
      allow(opts, ['author', 'text']); noExtra(pos, 2);
      const kinds = { account: 'accounts', quote: 'quotes', order: 'orders', product: 'products', job: 'jobs', delivery: 'deliveries' };
      if (!kinds[pos[0]]) throw Error('log needs account, quote, order, product, job or delivery first');
      const t = await resolve(db, kinds[pos[0]], pos[1]);
      const [row] = await db.query('insert into merchant.notes (subject_type, subject_id, author, body) values ($1, $2, $3, $4) returning created_at, author, body',
        [pos[0], t.id, need(opts, 'author'), need(opts, 'text')]);
      return { logged: t.code, ...row };
    }
    case 'contact': {
      allow(opts, ['by', 'text']); noExtra(pos, 1);
      const q = await resolve(db, 'quotes', pos[0]);
      const by = need(opts, 'by');
      return tx(db, async () => {
        const [row] = await db.query("update merchant.quotes set last_contact_on = current_date where id = $1 and status = 'open' returning code, last_contact_on", [q.id]);
        if (!row) throw Error(`${q.code} is not open`);
        if (opts.text) await note(db, 'quote', q.id, by, String(opts.text));
        return row;
      });
    }
    case 'win': return winQuote(db, pos, opts);
    case 'lose': {
      allow(opts, ['reason']); noExtra(pos, 1);
      const q = await resolve(db, 'quotes', pos[0]);
      const [row] = await db.query(`update merchant.quotes set status = 'lost', lost_reason = $2, decided_on = current_date where id = $1 and status = 'open'
        returning code, status, lost_reason`, [q.id, need(opts, 'reason')]);
      if (!row) throw Error(`${q.code} is not open`);
      return row;
    }
    case 'set-use': {
      allow(opts, ['product', 'use']); noExtra(pos, 2);
      const kind = oneOf(pos[0], ['quote', 'order'], 'set-use target');
      const t = await resolve(db, kind === 'quote' ? 'quotes' : 'orders', pos[1]);
      const use = need(opts, 'use');
      if (!(await db.query('select 1 from merchant.end_uses where code = $1 and jurisdiction = (select jurisdiction from merchant.settings)', [use])).length)
        throw Error(`Unknown end use "${use}". Run end-uses for the list.`);
      const rows = await db.query(`update merchant.${kind}_lines l set end_use = $3 from merchant.products p
        where l.${kind}_id = $1 and p.id = l.product_id and lower(p.code) = lower($2) returning p.code`, [t.id, need(opts, 'product'), use]);
      if (!rows.length) throw Error(`${t.code} has no line for ${opts.product}`);
      return { [kind]: t.code, product: rows[0].code, end_use: use, findings: await db.query('select rule, detail from merchant.compliance_findings where ref = $1', [`${kind} ${t.code}`]) };
    }
    case 'schedule': return schedule(db, pos, opts);
    case 'deliver': {
      allow(opts, ['signed-by']); noExtra(pos, 1);
      const d = await resolve(db, 'deliveries', pos[0]);
      return tx(db, async () => {
        const [row] = await db.query(`update merchant.deliveries set status = 'delivered', delivered_at = now(), signed_by = $2 where id = $1 and status = 'scheduled'
          returning code, order_id`, [d.id, need(opts, 'signed-by')]);
        if (!row) throw Error(`${d.code} is not scheduled`);
        // Goods leave the yard: take them off the branch's stock and mark the order delivered.
        await db.query(`update merchant.stock s set on_hand = s.on_hand - l.qty from merchant.order_lines l join merchant.orders o on o.id = l.order_id
          where o.id = $1 and s.product_id = l.product_id and s.branch_id = o.branch_id`, [row.order_id]);
        await db.query("update merchant.orders set status = 'delivered' where id = $1 and status in ('open', 'picked')", [row.order_id]);
        return { delivery: row.code, status: 'delivered', signed_by: opts['signed-by'] };
      });
    }
    case 'fail': {
      allow(opts, ['reason']); noExtra(pos, 1);
      const d = await resolve(db, 'deliveries', pos[0]);
      const [row] = await db.query("update merchant.deliveries set status = 'failed', fail_reason = $2 where id = $1 and status = 'scheduled' returning code, status, fail_reason",
        [d.id, need(opts, 'reason')]);
      if (!row) throw Error(`${d.code} is not scheduled`);
      return { ...row, next: 'Rebook with schedule <order> --truck= --on=' };
    }
    case 'invoice': {
      allow(opts, []); noExtra(pos, 1);
      const o = await resolve(db, 'orders', pos[0]);
      return tx(db, async () => {
        const [ov] = await db.query('select ov.*, a.terms_day from merchant.order_value ov join merchant.accounts a on a.id = ov.account_id where ov.id = $1', [o.id]);
        const ready = ov.status === 'delivered' || (ov.fulfilment === 'pickup' && ['open', 'picked'].includes(ov.status));
        if (!ready) throw Error(`${o.code} is ${ov.status}: invoice once it is delivered (or collected, for a pickup)`);
        const code = `INV-${String(o.code).replace(/^O-/, '')}`;
        const [inv] = await db.query(`insert into merchant.invoices (code, account_id, order_id, issued_on, due_on, net_cents, gst_cents)
          values ($1, $2, $3, current_date, (date_trunc('month', current_date) + interval '1 month')::date + ($4::int - 1), $5::int,
          round($5::int * (select gst_pct from merchant.settings) / 100)) returning code, issued_on, due_on, net_cents, gst_cents, total_cents`,
          [code, ov.account_id, o.id, ov.terms_day, Number(ov.net_cents)]);
        if (ov.fulfilment === 'pickup') await db.query(`update merchant.stock s set on_hand = s.on_hand - l.qty from merchant.order_lines l
          where l.order_id = $1 and s.product_id = l.product_id and s.branch_id = $2`, [o.id, ov.branch_id]);
        await db.query("update merchant.orders set status = 'invoiced' where id = $1", [o.id]);
        return inv;
      });
    }
    case 'pay': {
      allow(opts, ['amount', 'on', 'ref']); noExtra(pos, 1);
      const i = await resolve(db, 'invoices', pos[0]);
      const amount = cents(need(opts, 'amount'));
      if (amount <= 0) throw Error('--amount must be above zero');
      return tx(db, async () => {
        const [b] = await db.query("select owing_cents, status from merchant.invoice_balance where id = $1", [i.id]);
        if (!b || b.status !== 'open') throw Error(`${i.code} is not open`);
        if (amount > Number(b.owing_cents)) throw Error(`${i.code} has ${(Number(b.owing_cents) / 100).toFixed(2)} owing; that payment is more than that`);
        await db.query('insert into merchant.payments (invoice_id, paid_on, amount_cents, ref) values ($1, coalesce($2::date, current_date), $3, $4)',
          [i.id, opts.on ? date(opts.on) : null, amount, opts.ref || null]);
        const left = Number(b.owing_cents) - amount;
        if (left === 0) await db.query("update merchant.invoices set status = 'paid' where id = $1", [i.id]);
        return { invoice: i.code, paid: (amount / 100).toFixed(2), still_owing: (left / 100).toFixed(2) };
      });
    }
    case 'stop':
    case 'release': {
      allow(opts, ['by', 'reason']); noExtra(pos, 1);
      const a = await resolve(db, 'accounts', pos[0]);
      const by = need(opts, 'by');
      const reason = cmd === 'stop' ? need(opts, 'reason') : (opts.reason || 'released');
      return tx(db, async () => {
        const [row] = await db.query('update merchant.accounts set status = $2 where id = $1 and status <> $2 returning code, status',
          [a.id, cmd === 'stop' ? 'on_stop' : 'open']);
        if (!row) throw Error(`${a.code} is already ${cmd === 'stop' ? 'on stop' : 'open'}`);
        await note(db, 'account', a.id, by, `${cmd === 'stop' ? 'Put on stop' : 'Released from stop'}: ${reason}`);
        return { account: row.code, status: row.status.replace('_', ' ') };
      });
    }
    case 'price': {
      allow(opts, ['price', 'to']); noExtra(pos, 2);
      const a = await resolve(db, 'accounts', pos[0]);
      const p = await resolve(db, 'products', pos[1]);
      const price = cents(need(opts, 'price'), '--price');
      const [row] = await db.query(`insert into merchant.contract_prices (account_id, product_id, price_cents, valid_to) values ($1, $2, $3, $4)
        on conflict (account_id, product_id) do update set price_cents = excluded.price_cents, valid_to = excluded.valid_to
        returning price_cents, valid_to, (select cost_cents from merchant.products where id = $2) cost_cents`, [a.id, p.id, price, opts.to ? date(opts.to) : null]);
      return { account: a.code, product: p.code, price: (row.price_cents / 100).toFixed(2), cost: (row.cost_cents / 100).toFixed(2),
        margin_pct: row.price_cents ? Math.round(1000 * (row.price_cents - row.cost_cents) / row.price_cents) / 10 : null, valid_to: row.valid_to,
        warning: row.price_cents < row.cost_cents ? 'This price is below cost' : '' };
    }
    case 'cost': {
      allow(opts, ['cost']); noExtra(pos, 1);
      const p = await resolve(db, 'products', pos[0]);
      const c = cents(need(opts, 'cost'), '--cost');
      return tx(db, async () => {
        const [old] = await db.query('select cost_cents from merchant.products where id = $1', [p.id]);
        await db.query('update merchant.products set cost_cents = $2, cost_changed_on = current_date where id = $1', [p.id, c]);
        return { product: p.code, old_cost: (old.cost_cents / 100).toFixed(2), new_cost: (c / 100).toFixed(2),
          now_below_cost: await db.query(`select kind, account, account_name, ${money('price_cents')} price from merchant.price_floor where product = $1`, [p.code]) };
      });
    }
    case 'receive': {
      allow(opts, ['branch', 'qty']); noExtra(pos, 1);
      const p = await resolve(db, 'products', pos[0]);
      const b = await resolve(db, 'branches', need(opts, 'branch'));
      const n = qty(need(opts, 'qty'), '--qty');
      const [row] = await db.query(`insert into merchant.stock (product_id, branch_id, on_hand) values ($1, $2, $3)
        on conflict (product_id, branch_id) do update set on_hand = merchant.stock.on_hand + excluded.on_hand returning on_hand`, [p.id, b.id, n]);
      return { product: p.code, branch: b.code, received: n, on_hand: row.on_hand };
    }
    case 'import': return importCsv(db, pos, opts);
    case 'export': {
      allow(opts, ['out']); noExtra(pos, 0);
      const out = need(opts, 'out');
      const data = { exported_at: new Date().toISOString(), tables: {} };
      for (const t of TABLES) data.tables[t] = await db.query(`select * from merchant.${t}`);
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(data, null, 2));
      return { file: out, tables: TABLES.length, rows: Object.values(data.tables).reduce((n, r) => n + r.length, 0) };
    }
    case 'draft-weekly': { allow(opts, []); noExtra(pos, 0); return draftWeekly(db); }
    case 'draft-quote-chase': { allow(opts, []); noExtra(pos, 1); return draftQuoteChase(db, pos[0]); }
    case 'draft-overdue': { allow(opts, []); noExtra(pos, 1); return draftOverdue(db, pos[0]); }
    default: throw Error(`Unknown command "${cmd}". Run help for the list.`);
  }
}

async function add(db, pos, opts) {
  allow(opts, ['data']); noExtra(pos, 1);
  const kind = pos[0];
  if (!ADD_FIELDS[kind]) throw Error(`add needs one of: ${Object.keys(ADD_FIELDS).join(', ')}`);
  const raw = JSON.parse(fs.readFileSync(need(opts, 'data'), 'utf8'));
  const rows = Array.isArray(raw) ? raw : [raw];
  return tx(db, async () => {
    const added = [];
    for (const r of rows) {
      const cols = []; const vals = [];
      for (const [k, v] of Object.entries(r)) {
        const key = k.replace(/^(branch|price_level|account)$/, '$1_id');
        if (!ADD_FIELDS[kind].includes(key)) throw Error(`${kind} has no field "${k}". Fields: ${ADD_FIELDS[kind].join(', ')}`);
        cols.push(key);
        vals.push(REFS[key] ? (await resolve(db, REFS[key], String(v))).id : v);
      }
      const [row] = await db.query(`insert into merchant.${kind} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning code`, vals);
      added.push(row.code);
    }
    return { added: kind, codes: added };
  });
}

// "FR9045-H12:240:framing,CON40:20" -> lines. End use is optional; the rule check reads it.
function parseLines(text) {
  return String(text).split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [code, n, use] = s.split(':').map((x) => x?.trim());
    if (!code || !n) throw Error(`Cannot read line "${s}". Use CODE:qty or CODE:qty:end-use`);
    return { code, qty: qty(n, `${code} quantity`), use: use || null };
  });
}
async function newQuote(db, pos, opts) {
  allow(opts, ['lines', 'job', 'rep', 'branch', 'valid-days']); noExtra(pos, 1);
  const a = await resolve(db, 'accounts', pos[0]);
  const lines = parseLines(need(opts, 'lines'));
  return tx(db, async () => {
    const job = opts.job ? await resolve(db, 'jobs', String(opts.job)) : null;
    const [acct] = await db.query('select branch_id, rep from merchant.accounts where id = $1', [a.id]);
    const branch = opts.branch ? (await resolve(db, 'branches', String(opts.branch))).id : acct.branch_id;
    const code = await nextCode(db, 'quotes', 'Q-');
    const days = opts['valid-days'] ? Math.round(qty(opts['valid-days'], '--valid-days')) : (await db.query('select quote_valid_days d from merchant.settings'))[0].d;
    const [q] = await db.query(`insert into merchant.quotes (code, account_id, job_id, branch_id, rep, valid_to) values ($1, $2, $3, $4, $5, current_date + $6::int)
      returning id, code, valid_to`, [code, a.id, job?.id || null, branch, opts.rep || acct.rep, days]);
    for (const l of lines) {
      const p = await resolve(db, 'products', l.code);
      if (l.use && !(await db.query('select 1 from merchant.end_uses where code = $1 and jurisdiction = (select jurisdiction from merchant.settings)', [l.use])).length)
        throw Error(`Unknown end use "${l.use}". Run end-uses for the list.`);
      await db.query('insert into merchant.quote_lines (quote_id, product_id, qty, unit_cents, end_use) values ($1, $2, $3, merchant.price_for($4, $2), $5)',
        [q.id, p.id, l.qty, a.id, l.use]);
    }
    const [v] = await db.query(`select ${money('net_cents')} value, round(100.0 * (net_cents - cost_cents) / nullif(net_cents, 0), 1) margin_pct from merchant.quote_value where id = $1`, [q.id]);
    return { quote: q.code, account: a.code, valid_to: q.valid_to, lines: lines.length, ...v,
      rule_findings: await db.query("select rule, detail from merchant.compliance_findings where ref = 'quote ' || $1", [q.code]) };
  });
}
async function winQuote(db, pos, opts) {
  allow(opts, ['required', 'pickup', 'po', 'override-by']); noExtra(pos, 1);
  const q = await resolve(db, 'quotes', pos[0]);
  return tx(db, async () => {
    const [quote] = await db.query(`select q.*, qv.net_cents, a.kind from merchant.quotes q join merchant.quote_value qv on qv.id = q.id
      join merchant.accounts a on a.id = q.account_id where q.id = $1`, [q.id]);
    if (quote.status !== 'open') throw Error(`${q.code} is ${quote.status}`);
    const findings = await db.query("select rule, detail from merchant.compliance_findings where ref = 'quote ' || $1 and severity = 'breach'", [q.code]);
    const block = await creditBlock(db, quote.account_id, Number(quote.net_cents));
    const problems = [...findings.map((f) => `${f.rule}: ${f.detail}`), ...(block ? [`credit: ${block}`] : [])];
    if (problems.length && !opts['override-by']) throw Error(`Not converted. Fix these first, or pass --override-by=<name> to record who accepted them:\n  ${problems.join('\n  ')}`);
    const code = await nextCode(db, 'orders', 'O-');
    const [o] = await db.query(`insert into merchant.orders (code, account_id, job_id, quote_id, branch_id, required_on, fulfilment, po_ref)
      values ($1, $2, $3, $4, coalesce($5, (select id from merchant.branches order by code limit 1)), $6, $7, $8) returning id, code`,
      [code, quote.account_id, quote.job_id, q.id, quote.branch_id, opts.required ? date(opts.required) : null, opts.pickup ? 'pickup' : 'delivery', opts.po || null]);
    await db.query(`insert into merchant.order_lines (order_id, product_id, qty, unit_cents, cost_cents, end_use)
      select $1, l.product_id, l.qty, l.unit_cents, p.cost_cents, l.end_use from merchant.quote_lines l join merchant.products p on p.id = l.product_id where l.quote_id = $2`, [o.id, q.id]);
    await db.query("update merchant.quotes set status = 'won', decided_on = current_date where id = $1", [q.id]);
    if (problems.length) await note(db, 'order', o.id, opts['override-by'], `Converted from ${q.code} with these accepted: ${problems.join('; ')}`);
    return { quote: q.code, order: o.code, accepted_problems: problems };
  });
}
async function schedule(db, pos, opts) {
  allow(opts, ['truck', 'on', 'slot', 'override-by']); noExtra(pos, 1);
  const o = await resolve(db, 'orders', pos[0]);
  const t = await resolve(db, 'trucks', need(opts, 'truck'));
  const slot = oneOf(String(opts.slot || 'am'), ['am', 'pm'], '--slot');
  return tx(db, async () => {
    const [ord] = await db.query('select account_id, status, fulfilment from merchant.orders where id = $1', [o.id]);
    if (!['open', 'picked'].includes(ord.status)) throw Error(`${o.code} is ${ord.status}`);
    if (ord.fulfilment === 'pickup') throw Error(`${o.code} is a pickup`);
    const block = await creditBlock(db, ord.account_id);
    if (block && !opts['override-by']) throw Error(`Not booked: ${block}. Pass --override-by=<name> to book it anyway and record who decided.`);
    const code = await nextCode(db, 'deliveries', 'D-');
    const [d] = await db.query(`insert into merchant.deliveries (code, order_id, truck_id, run_on, slot) values ($1, $2, $3, coalesce($4::date, current_date), $5)
      returning code, run_on, slot`, [code, o.id, t.id, opts.on ? date(opts.on) : null, slot]);
    if (block) await note(db, 'delivery', (await resolve(db, 'deliveries', code)).id, opts['override-by'], `Booked despite: ${block}`);
    const [load] = await db.query('select drops, load_kg, capacity_kg, load_pct, flag from merchant.truck_load where run_on = $1 and slot = $2 and truck = $3', [d.run_on, slot, t.code]);
    return { delivery: d.code, order: o.code, truck: t.code, run_on: d.run_on, slot, ...load };
  });
}

// What needs someone today, across the yard, the counter and the office.
async function attention(db) {
  const out = [];
  const push = (area, item, why, next) => out.push({ area, item, why, next });
  for (const r of await db.query("select code, truck, account, status from merchant.dispatch_board where run_on = current_date and status = 'scheduled' and order_status = 'open'"))
    push('dispatch', r.code, `${r.account} on ${r.truck} today and the order is not picked yet`, 'pick it or rebook');
  for (const r of await db.query("select code, account, fail_reason, run_on from merchant.dispatch_board d where status = 'failed' and not exists (select 1 from merchant.dispatch_board x where x.order_code = d.order_code and x.run_on > d.run_on)"))
    push('dispatch', r.code, `failed ${r.run_on} at ${r.account}: ${r.fail_reason}`, 'rebook with /schedule');
  for (const r of await db.query("select run_on, slot, truck, load_kg, capacity_kg from merchant.truck_load where flag <> ''"))
    push('dispatch', `${r.truck} ${r.run_on} ${r.slot}`, `${r.load_kg} kg on a ${r.capacity_kg} kg truck`, 'split the run');
  for (const r of await db.query(`select code, name, flag, replace(status, '_', ' ') status, oldest_overdue_days, ${money('exposure_cents')} exposure,
    ${money('credit_limit_cents')} credit_limit from merchant.credit_watch where flag <> '' or status = 'on_stop'`))
    push('credit', r.code, r.flag === 'over limit' ? `${r.name}: ${r.exposure} owed and on order against a ${r.credit_limit} limit`
      : `${r.name}: ${r.flag || r.status}${r.oldest_overdue_days ? `, oldest invoice ${r.oldest_overdue_days} days overdue` : ''}`,
      r.flag === 'over limit' ? 'hold new orders or raise the limit' : '/draft-overdue then decide /stop');
  for (const r of await db.query(READS.chase))
    push('quotes', r.code, `${r.account}, ${r.value}, ${r.state === 'expired' ? r.validity : `${r.days_since_contact} days since contact`}`, '/draft-quote-chase');
  const FIX = { 'treatment-for-use': 'swap to the right treatment, or /set-use if the use is wrong', 'grade-for-structure': 'swap to stress-graded timber',
    'ppsr-missing': 'register a financing statement', 'ppsr-expiring': 'renew the registration', 'credit-application': 'get the credit application signed',
    'product-information': 'add the product information link', 'buyer-details': "add the buyer's address", 'stop-list-dispatch': 'hold the delivery or take payment first' };
  for (const r of await db.query("select rule, ref, subject, detail from merchant.compliance_findings where severity = 'breach'"))
    push('rules', r.ref, `${r.rule}: ${r.detail}`, FIX[r.rule] || '/compliance');
  for (const r of await db.query("select code, branch, available, unit from merchant.stock_position where flag = 'SHORT'"))
    push('stock', `${r.code} ${r.branch}`, `${-Number(r.available)} ${r.unit} short for open orders`, 'order it in or move it from another branch');
  for (const r of await db.query('select account, product, price, margin_pct from (' + READS['price-floor'] + ') x'))
    push('pricing', `${r.account || 'level'} ${r.product}`, `selling at ${r.price}, ${r.margin_pct}% margin`, '/price to reset it');
  for (const r of await db.query(READS['sales-drop']))
    push('accounts', r.code, `${r.name} bought ${r.drop_pct}% less in the last 90 days`, 'rep to call');
  return out;
}

// ------------------------------------------------------------------ imports
// BisTrack's customer and product lists export from its grids and reports to Excel; save the sheet as CSV.
// Column names depend on how the reports were set up, so each field accepts the common names.
// Check yours against docs/replace-bistrack.md before the first real run.
const CUSTOMER_COLUMNS = {
  code: ['Customer Code', 'Account Code', 'Account', 'Customer No', 'Customer Number', 'Code'], name: ['Customer Name', 'Account Name', 'Name'],
  limit: ['Credit Limit', 'Limit'], level: ['Price Group', 'Price Level', 'Pricing Group', 'Customer Price Group'], branch: ['Branch', 'Home Branch', 'Site'],
  rep: ['Sales Rep', 'Salesperson', 'Rep', 'Account Manager'], email: ['Email', 'E-mail', 'Accounts Email'], phone: ['Phone', 'Telephone', 'Phone Number'],
  address: ['Address', 'Billing Address', 'Invoice Address', 'Postal Address'], number: ['NZBN', 'ABN', 'Company Number', 'Business Number'],
  contact: ['Contact', 'Contact Name'], stop: ['On Stop', 'Stopped', 'Credit Stop', 'Account Stopped'], cash: ['Cash Account', 'Cash Sale'],
};
export function mapCustomerRow(r, n) {
  const get = (k) => pick(r, ...CUSTOMER_COLUMNS[k]);
  const code = get('code'); const name = get('name');
  if (!code || !name) throw Error(`Row ${n}: customer code and name are required`);
  return { code, name, kind: yesNo(get('cash')) ? 'cash' : 'trade', credit_limit_cents: get('limit') ? cents(get('limit'), `Row ${n} credit limit`) : 0,
    level: get('level') || null, branch: get('branch') || null, rep: get('rep') || null, email: get('email') || null, phone: get('phone') || null,
    billing_address: get('address') || null, business_number: get('number') || null, contact: get('contact') || null, status: yesNo(get('stop')) ? 'on_stop' : 'open' };
}
const PRODUCT_COLUMNS = {
  code: ['Product Code', 'Product', 'Item Code', 'Code', 'SKU'], name: ['Description', 'Product Description', 'Name'],
  category: ['Product Group', 'Category', 'Group', 'Department'], unit: ['Unit', 'UOM', 'Stock Unit', 'Unit of Measure'],
  cost: ['Cost', 'Average Cost', 'Replacement Cost', 'Last Cost', 'Standard Cost'], list: ['List Price', 'Retail Price', 'Sell Price', 'Price 1', 'Retail'],
  treatment: ['Treatment', 'Hazard Class', 'Treatment Level'], grade: ['Grade', 'Stress Grade'], weight: ['Weight', 'Weight (kg)', 'Unit Weight'],
  supplier: ['Supplier', 'Main Supplier', 'Vendor'], stock: ['Stock', 'On Hand', 'Qty On Hand', 'Free Stock'], branch: ['Branch', 'Site'],
};
const CATEGORIES = ['timber', 'sheet', 'roofing', 'concrete', 'hardware', 'fixings', 'landscape'];
export function mapProductRow(r, n) {
  const get = (k) => pick(r, ...PRODUCT_COLUMNS[k]);
  const code = get('code'); const name = get('name');
  if (!code || !name) throw Error(`Row ${n}: product code and description are required`);
  const cat = get('category').toLowerCase();
  const category = CATEGORIES.find((c) => cat.includes(c)) || (/(timber|framing|decking|pine|post|rail)/.test(`${cat} ${name.toLowerCase()}`) ? 'timber' : 'hardware');
  const t = get('treatment').toUpperCase().replace(/\s/g, '');
  const treatment = !t ? null : /^(UNTREATED|NONE|N\/A)$/.test(t) ? 'untreated' : (t.match(/^H\d(\.\d)?$/) || [null])[0];
  if (t && treatment === null) throw Error(`Row ${n}: treatment "${get('treatment')}" is not a hazard class (H1.2, H3.2, H4...)`);
  const num = (v, label) => { if (v === '') return null; const x = Number(String(v).replace(/,/g, '')); if (!Number.isFinite(x)) throw Error(`Row ${n}: ${label} "${v}" is not a number`); return x; };
  return { code, name, category, unit: (get('unit') || 'ea').toLowerCase(), treatment, grade: get('grade') || null, weight_kg: num(get('weight'), 'weight') ?? 0,
    cost_cents: get('cost') ? cents(get('cost'), `Row ${n} cost`) : 0, list_cents: get('list') ? cents(get('list'), `Row ${n} list price`) : 0,
    supplier: get('supplier') || null, on_hand: num(get('stock'), 'stock'), branch: get('branch') || null };
}
async function importCsv(db, pos, opts) {
  allow(opts, ['file', 'dry-run']); noExtra(pos, 1);
  const kind = oneOf(pos[0], ['bistrack-customers', 'bistrack-products'], 'import');
  const file = need(opts, 'file');
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (!rows.length) throw Error('The file has no rows');
  const mapped = rows.map((r, i) => (kind === 'bistrack-customers' ? mapCustomerRow(r, i + 2) : mapProductRow(r, i + 2)));
  const dryRun = opts['dry-run'] === true;
  return tx(db, async () => {
    const result = { file: path.basename(file), rows: rows.length, inserted: 0, skipped_identical: 0, stock_rows: 0, dry_run: dryRun };
    const [{ branch_id: firstBranch }] = await db.query('select (select id from merchant.branches order by code limit 1) branch_id');
    for (let i = 0; i < mapped.length; i++) {
      const m = mapped[i];
      const hash = crypto.createHash('sha256').update(JSON.stringify(m)).digest('hex');
      if ((await db.query('select 1 from merchant.import_rows where source = $1 and row_hash = $2', [kind, hash])).length) { result.skipped_identical++; continue; }
      let id;
      if (kind === 'bistrack-customers') {
        if ((await db.query('select 1 from merchant.accounts where lower(code) = lower($1)', [m.code])).length) throw Error(`Row ${i + 2}: account ${m.code} already exists. Nothing was imported.`);
        const level = m.level ? await resolve(db, 'price_levels', m.level).catch(() => { throw Error(`Row ${i + 2}: no price level "${m.level}". Add it first (add price_levels).`); }) : null;
        const branch = m.branch ? await resolve(db, 'branches', m.branch).catch(() => { throw Error(`Row ${i + 2}: no branch "${m.branch}". Add it first (add branches).`); }) : null;
        [{ id }] = await db.query(`insert into merchant.accounts (code, name, kind, branch_id, rep, price_level_id, credit_limit_cents, status, contact, email, phone, billing_address, business_number)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
          [m.code, m.name, m.kind, branch?.id || null, m.rep, level?.id || null, m.credit_limit_cents, m.status, m.contact, m.email, m.phone, m.billing_address, m.business_number]);
      } else {
        if ((await db.query('select 1 from merchant.products where lower(code) = lower($1)', [m.code])).length) throw Error(`Row ${i + 2}: product ${m.code} already exists. Nothing was imported.`);
        [{ id }] = await db.query(`insert into merchant.products (code, name, category, unit, treatment, grade, weight_kg, cost_cents, list_cents, supplier)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
          [m.code, m.name, m.category, m.unit, m.treatment, m.grade, m.weight_kg, m.cost_cents, m.list_cents, m.supplier]);
        if (m.on_hand !== null) {
          const branch = m.branch ? (await resolve(db, 'branches', m.branch)).id : firstBranch;
          if (!branch) throw Error(`Row ${i + 2}: the file has stock but there is no branch yet. Add one first (add branches).`);
          await db.query('insert into merchant.stock (product_id, branch_id, on_hand) values ($1, $2, $3) on conflict (product_id, branch_id) do update set on_hand = excluded.on_hand', [id, branch, m.on_hand]);
          result.stock_rows++;
        }
      }
      result.inserted++;
      await db.query('insert into merchant.import_rows (source, file_name, row_number, row_hash, target_id) values ($1, $2, $3, $4, $5)', [kind, path.basename(file), i + 2, hash, id]);
    }
    return result;
  }, { dryRun });
}

// ------------------------------------------------------------------ drafts (never sent)
const nz = (c) => (Number(c) / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function draftsDir() { const d = path.resolve(process.env.OUTPUT_DIR || REPO_ROOT, 'drafts'); fs.mkdirSync(d, { recursive: true }); return d; }
function md(rows) {
  if (!rows.length) return '_None._\n';
  const keys = Object.keys(rows[0]);
  return [`| ${keys.join(' | ')} |`, `| ${keys.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${keys.map((k) => String(r[k] ?? '').replace(/\|/g, '/')).join(' | ')} |`)].join('\n') + '\n';
}
async function today(db) { return (await db.query('select current_date::text today'))[0].today; }
async function draftWeekly(db) {
  const d = await today(db);
  const body = [`# Merchant review, week of ${d}`, '',
    'Draft for the Monday meeting. Figures come from the database at the time of writing. Nothing has been sent.', '',
    '## What needs attention', md(await attention(db)),
    '## Quotes to chase', md(await db.query(READS.chase)),
    '## Credit', md(await db.query(READS.credit)),
    '## Rule checks', md(await db.query(READS.compliance)),
    '## Stock to order', md(await db.query(READS.reorder)),
    '## Reps, last 180 days', md(await db.query(READS.reps))].join('\n');
  const file = path.join(draftsDir(), `weekly-review-${d}.md`);
  fs.writeFileSync(file, body);
  return { draft: file, sections: 6 };
}
async function draftQuoteChase(db, ref) {
  const q = await resolve(db, 'quotes', ref);
  const [r] = await db.query(`select q.code, q.status, q.valid_to, q.valid_to < current_date expired, a.contact, a.name account, j.name job, qv.net_cents, coalesce(q.rep, a.rep) rep,
    (select currency from merchant.settings) currency from merchant.quotes q join merchant.accounts a on a.id = q.account_id left join merchant.jobs j on j.id = q.job_id
    join merchant.quote_value qv on qv.id = q.id where q.id = $1`, [q.id]);
  if (r.status !== 'open') throw Error(`${r.code} is ${r.status}: there is nothing to chase`);
  const lines = await db.query(`select p.name, l.qty, p.unit from merchant.quote_lines l join merchant.products p on p.id = l.product_id where l.quote_id = $1 order by l.created_at, p.code`, [q.id]);
  const findings = await db.query("select detail from merchant.compliance_findings where ref = 'quote ' || $1 and rule = 'treatment-for-use'", [q.code]);
  const body = [`Hi ${String(r.contact || r.account).split(' ')[0]},`, '',
    `Following up on quote ${r.code}${r.job ? ` for ${r.job}` : ''}, ${r.currency} ${nz(r.net_cents)} plus GST.`, '',
    r.expired ? `The quote ran out on ${r.valid_to}. I can refresh it at today's prices if the job is still going ahead.` : `The prices hold until ${r.valid_to}.`, '',
    'It covers:', ...lines.slice(0, 8).map((l) => `- ${Number(l.qty)} ${l.unit} ${l.name}`), lines.length > 8 ? `- and ${lines.length - 8} more lines` : '', '',
    findings.length ? `One change before it is ordered: ${findings.map((f) => f.detail).join('; ')}. I will requote that line in the right treatment.` : '',
    'Happy to book the delivery date once you are ready.', '', r.rep || '', ''].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
  const file = path.join(draftsDir(), `quote-chase-${r.code}-${await today(db)}.md`);
  fs.writeFileSync(file, body);
  return { draft: file, quote: r.code, expired: r.expired };
}
async function draftOverdue(db, ref) {
  const a = await resolve(db, 'accounts', ref);
  const [acct] = await db.query('select contact, name, (select business_name from merchant.settings) merchant, (select currency from merchant.settings) currency from merchant.accounts where id = $1', [a.id]);
  const inv = await db.query(`select code, issued_on, due_on, owing_cents, days_overdue from merchant.invoice_balance where account_id = $1 and status = 'open' and days_overdue > 0 order by due_on`, [a.id]);
  if (!inv.length) throw Error(`${a.code} has nothing overdue`);
  const total = inv.reduce((n, i) => n + Number(i.owing_cents), 0);
  const body = [`Hi ${String(acct.contact || acct.name).split(' ')[0]},`, '',
    `Our records show ${acct.currency} ${nz(total)} overdue on your ${acct.merchant} account:`, '',
    md(inv.map((i) => ({ invoice: i.code, issued: i.issued_on, due: i.due_on, owing: nz(i.owing_cents), days_overdue: i.days_overdue }))),
    'Please arrange payment, or call me to agree a date. Deliveries on account wait until it is sorted.', ''].join('\n');
  const file = path.join(draftsDir(), `overdue-${a.code}-${await today(db)}.md`);
  fs.writeFileSync(file, body);
  return { draft: file, account: a.code, invoices: inv.length, overdue: (total / 100).toFixed(2) };
}

// ------------------------------------------------------------------ main
function print(out) {
  if (Array.isArray(out)) {
    if (!out.length) return console.log('  (none)');
    const keys = Object.keys(out[0]);
    return console.log(table(out, keys.map((k) => ({ key: k, label: k.replace(/_/g, ' '), width: 70,
      align: typeof out[0][k] === 'number' || /^-?\d+(\.\d+)?$/.test(String(out[0][k] ?? '')) ? 'right' : 'left' }))));
  }
  if (out && typeof out === 'object') {
    for (const [k, v] of Object.entries(out)) {
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') { console.log(`\n${k.replace(/_/g, ' ')}`); print(v); }
      else if (Array.isArray(v) && !v.length) console.log(`\n${k.replace(/_/g, ' ')}\n  (none)`);
      else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) { console.log(`\n${k.replace(/_/g, ' ')}`); for (const [k2, v2] of Object.entries(v)) console.log(`  ${k2.replace(/_/g, ' ')}: ${v2 ?? ''}`); }
      else console.log(`${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') : v ?? ''}`);
    }
  }
}
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const db = await getDb();
  try {
    const out = await run(db, args.filter((a) => a !== '--json'));
    if (json) console.log(JSON.stringify(out, null, 2)); else print(out);
  } catch (e) {
    console.error(e.message); process.exitCode = 1;
  } finally { await db.close(); }
}
