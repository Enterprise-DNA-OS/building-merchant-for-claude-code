-- The views the weekly commands read. Every figure the CLI prints comes from one of these.

-- The price an account pays today: its contract price if current, else list less its level's discount.
create or replace function merchant.price_for(p_account uuid, p_product uuid) returns int language sql stable as $$
  select coalesce(
    (select cp.price_cents from merchant.contract_prices cp
      where cp.account_id = p_account and cp.product_id = p_product and (cp.valid_to is null or cp.valid_to >= current_date)),
    (select round(p.list_cents * (1 - coalesce(pl.discount_pct, 0) / 100.0))::int
       from merchant.products p left join merchant.accounts a on a.id = p_account
       left join merchant.price_levels pl on pl.id = a.price_level_id where p.id = p_product))
$$;

-- Hazard class rank for a product's treatment in the merchant's jurisdiction (null when unknown).
create or replace function merchant.treatment_rank(p_treatment text) returns int language sql stable as $$
  select rank from merchant.treatment_classes
  where jurisdiction = (select jurisdiction from merchant.settings) and lower(code) = lower(coalesce(p_treatment, 'untreated'))
$$;

create or replace view merchant.order_value as
select o.id, o.code, o.account_id, o.job_id, o.branch_id, o.ordered_on, o.required_on, o.status, o.fulfilment,
  coalesce(sum(round(l.qty * l.unit_cents)), 0)::bigint net_cents,
  coalesce(sum(round(l.qty * l.cost_cents)), 0)::bigint cost_cents,
  coalesce(sum(round(l.qty * (l.unit_cents - l.cost_cents))), 0)::bigint margin_cents,
  case when coalesce(sum(l.qty * l.unit_cents), 0) = 0 then null
    else round(100.0 * sum(l.qty * (l.unit_cents - l.cost_cents)) / sum(l.qty * l.unit_cents), 1) end margin_pct,
  coalesce(sum(l.qty * p.weight_kg), 0)::numeric(12,1) weight_kg
from merchant.orders o
left join merchant.order_lines l on l.order_id = o.id
left join merchant.products p on p.id = l.product_id
group by o.id;

create or replace view merchant.quote_value as
select q.id, q.code, coalesce(sum(round(l.qty * l.unit_cents)), 0)::bigint net_cents,
  coalesce(sum(round(l.qty * p.cost_cents)), 0)::bigint cost_cents, count(l.id)::int lines
from merchant.quotes q
left join merchant.quote_lines l on l.quote_id = q.id
left join merchant.products p on p.id = l.product_id
group by q.id;

create or replace view merchant.invoice_balance as
select i.*, coalesce((select sum(amount_cents) from merchant.payments p where p.invoice_id = i.id), 0)::bigint paid_cents,
  i.total_cents - coalesce((select sum(amount_cents) from merchant.payments p where p.invoice_id = i.id), 0) owing_cents,
  greatest(current_date - i.due_on, 0) days_overdue
from merchant.invoices i where i.status <> 'void';

-- The account's whole position: what it owes, how late, how much room is left, and whether it is still buying.
create or replace view merchant.account_position as
select a.id, a.code, a.name, a.kind, a.rep, a.status, b.code branch, pl.code price_level,
  a.credit_limit_cents,
  coalesce(sum(ib.owing_cents), 0)::bigint balance_cents,
  coalesce(sum(ib.owing_cents) filter (where ib.days_overdue = 0), 0)::bigint current_cents,
  coalesce(sum(ib.owing_cents) filter (where ib.days_overdue between 1 and 30), 0)::bigint overdue_1_30_cents,
  coalesce(sum(ib.owing_cents) filter (where ib.days_overdue between 31 and 60), 0)::bigint overdue_31_60_cents,
  coalesce(sum(ib.owing_cents) filter (where ib.days_overdue > 60), 0)::bigint overdue_60_plus_cents,
  coalesce(max(ib.days_overdue) filter (where ib.owing_cents > 0), 0) oldest_overdue_days,
  round((select coalesce(sum(ov.net_cents), 0) from merchant.order_value ov where ov.account_id = a.id and ov.status in ('open', 'picked', 'delivered'))
    * (100 + (select gst_pct from merchant.settings)) / 100)::bigint uninvoiced_cents,
  (select max(ordered_on) from merchant.orders o where o.account_id = a.id and o.status <> 'cancelled') last_order_on,
  (select coalesce(sum(ov.net_cents), 0) from merchant.order_value ov where ov.account_id = a.id and ov.status <> 'cancelled'
    and ov.ordered_on > current_date - 90)::bigint sales_90_cents,
  (select coalesce(sum(ov.net_cents), 0) from merchant.order_value ov where ov.account_id = a.id and ov.status <> 'cancelled'
    and ov.ordered_on between current_date - 180 and current_date - 91)::bigint sales_prior_90_cents
from merchant.accounts a
left join merchant.branches b on b.id = a.branch_id
left join merchant.price_levels pl on pl.id = a.price_level_id
left join merchant.invoice_balance ib on ib.account_id = a.id and ib.status = 'open'
where a.status <> 'closed'
group by a.id, b.code, pl.code;

-- Exposure = what they owe plus what is ordered and not yet invoiced. Over the limit, or too late, means stop.
create or replace view merchant.credit_watch as
select ap.*, ap.balance_cents + ap.uninvoiced_cents exposure_cents,
  ap.credit_limit_cents - (ap.balance_cents + ap.uninvoiced_cents) headroom_cents,
  case
    when ap.kind = 'trade' and ap.credit_limit_cents > 0 and ap.balance_cents + ap.uninvoiced_cents > ap.credit_limit_cents then 'over limit'
    when ap.oldest_overdue_days > (select stop_overdue_days from merchant.settings) then 'overdue past stop line'
    when ap.overdue_31_60_cents > 0 then 'overdue over 30 days'
    else '' end flag
from merchant.account_position ap
where ap.kind = 'trade';

create or replace view merchant.quote_pipeline as
select q.id, q.code, a.code account, a.name account_name, j.name job, coalesce(q.rep, a.rep) rep, q.quoted_on, q.valid_to,
  qv.net_cents value_cents, qv.net_cents - qv.cost_cents margin_cents, qv.lines,
  current_date - coalesce(q.last_contact_on, q.quoted_on) days_since_contact,
  q.valid_to - current_date days_left,
  case when q.valid_to < current_date then 'expired'
    when current_date - coalesce(q.last_contact_on, q.quoted_on) >= (select quote_chase_days from merchant.settings) then 'chase'
    else 'live' end state
from merchant.quotes q
join merchant.accounts a on a.id = q.account_id
left join merchant.jobs j on j.id = q.job_id
join merchant.quote_value qv on qv.id = q.id
where q.status = 'open';

create or replace view merchant.dispatch_board as
select d.id, d.code, d.run_on, d.slot, coalesce(t.code, 'unassigned') truck, t.kind truck_kind, o.code order_code, a.name account,
  coalesce(j.site_address, a.billing_address) site, ov.weight_kg, d.status, o.status order_status, d.signed_by, d.fail_reason, a.status account_status
from merchant.deliveries d
join merchant.orders o on o.id = d.order_id
join merchant.accounts a on a.id = o.account_id
left join merchant.jobs j on j.id = o.job_id
left join merchant.trucks t on t.id = d.truck_id
join merchant.order_value ov on ov.id = o.id;

create or replace view merchant.truck_load as
select db.run_on, db.slot, db.truck, t.capacity_kg, count(*)::int drops, sum(db.weight_kg)::numeric(12,1) load_kg,
  round(100.0 * sum(db.weight_kg) / t.capacity_kg, 0) load_pct,
  case when sum(db.weight_kg) > t.capacity_kg then 'OVERLOADED' else '' end flag
from merchant.dispatch_board db join merchant.trucks t on t.code = db.truck
where db.status = 'scheduled'
group by db.run_on, db.slot, db.truck, t.capacity_kg;

-- Committed = on orders at that branch not yet delivered. Available = on hand less committed.
create or replace view merchant.stock_position as
select p.id product_id, p.code, p.name, p.category, p.unit, b.code branch, s.on_hand,
  coalesce(c.committed, 0)::numeric(12,2) committed, (s.on_hand - coalesce(c.committed, 0))::numeric(12,2) available, s.reorder_point,
  round(s.on_hand * p.cost_cents)::bigint stock_value_cents, ls.last_sold_on,
  current_date - ls.last_sold_on days_since_sale,
  case when s.on_hand - coalesce(c.committed, 0) < 0 then 'SHORT'
    when s.on_hand - coalesce(c.committed, 0) <= s.reorder_point then 'reorder'
    when s.on_hand > 0 and current_date - ls.last_sold_on > (select slow_stock_days from merchant.settings) then 'slow'
    else '' end flag
from merchant.stock s
join merchant.products p on p.id = s.product_id
join merchant.branches b on b.id = s.branch_id
left join (select l.product_id, o.branch_id, sum(l.qty) committed from merchant.order_lines l join merchant.orders o on o.id = l.order_id
  where o.status in ('open', 'picked') group by 1, 2) c on c.product_id = s.product_id and c.branch_id = s.branch_id
left join (select l.product_id, o.branch_id, max(o.ordered_on) last_sold_on from merchant.order_lines l join merchant.orders o on o.id = l.order_id
  where o.status <> 'cancelled' group by 1, 2) ls on ls.product_id = s.product_id and ls.branch_id = s.branch_id
where p.active;

-- Prices that now sit below what the product costs to replace.
create or replace view merchant.price_floor as
select 'contract' kind, a.code account, a.name account_name, p.code product, p.name product_name, cp.price_cents, p.cost_cents,
  round(100.0 * (cp.price_cents - p.cost_cents) / nullif(cp.price_cents, 0), 1) margin_pct, p.cost_changed_on, cp.valid_to
from merchant.contract_prices cp join merchant.accounts a on a.id = cp.account_id join merchant.products p on p.id = cp.product_id
where a.status <> 'closed' and (cp.valid_to is null or cp.valid_to >= current_date) and cp.price_cents < p.cost_cents
union all
select 'level ' || pl.code, '', pl.name, p.code, p.name, round(p.list_cents * (1 - pl.discount_pct / 100.0))::int, p.cost_cents,
  round(100.0 * (round(p.list_cents * (1 - pl.discount_pct / 100.0)) - p.cost_cents) / nullif(round(p.list_cents * (1 - pl.discount_pct / 100.0)), 0), 1),
  p.cost_changed_on, null
from merchant.price_levels pl cross join merchant.products p
where p.active and round(p.list_cents * (1 - pl.discount_pct / 100.0)) < p.cost_cents;

create or replace view merchant.account_margin as
select a.code, a.name, a.rep, pl.code price_level, count(distinct ov.id)::int orders,
  sum(ov.net_cents)::bigint sales_cents, sum(ov.margin_cents)::bigint margin_cents,
  round(100.0 * sum(ov.margin_cents) / nullif(sum(ov.net_cents), 0), 1) margin_pct
from merchant.order_value ov join merchant.accounts a on a.id = ov.account_id left join merchant.price_levels pl on pl.id = a.price_level_id
where ov.status <> 'cancelled' and ov.ordered_on > current_date - 90
group by a.id, pl.code;

create or replace view merchant.rep_scorecard as
select coalesce(q.rep, a.rep, 'no rep') rep, count(*)::int quotes,
  count(*) filter (where q.status = 'won')::int won, count(*) filter (where q.status = 'lost')::int lost,
  count(*) filter (where q.status = 'open')::int open,
  round(100.0 * count(*) filter (where q.status = 'won') / nullif(count(*) filter (where q.status in ('won', 'lost')), 0), 0) win_rate_pct,
  sum(qv.net_cents)::bigint quoted_cents, coalesce(sum(qv.net_cents) filter (where q.status = 'won'), 0)::bigint won_cents,
  coalesce(sum(qv.net_cents) filter (where q.status = 'open'), 0)::bigint open_cents
from merchant.quotes q join merchant.accounts a on a.id = q.account_id join merchant.quote_value qv on qv.id = q.id
where q.quoted_on > current_date - 180
group by 1;

-- Lines going out on open quotes and orders, with what the end use needs.
create or replace view merchant.line_uses as
select 'quote' source, q.code ref, a.code account, p.code product, p.name product_name, p.treatment, p.grade, l.end_use, eu.name end_use_name,
  eu.min_treatment, eu.needs_grade, merchant.treatment_rank(p.treatment) have_rank, merchant.treatment_rank(eu.min_treatment) need_rank, p.category
from merchant.quote_lines l join merchant.quotes q on q.id = l.quote_id join merchant.accounts a on a.id = q.account_id
join merchant.products p on p.id = l.product_id
left join merchant.end_uses eu on eu.code = l.end_use and eu.jurisdiction = (select jurisdiction from merchant.settings)
where q.status = 'open'
union all
select 'order', o.code, a.code, p.code, p.name, p.treatment, p.grade, l.end_use, eu.name, eu.min_treatment, eu.needs_grade,
  merchant.treatment_rank(p.treatment), merchant.treatment_rank(eu.min_treatment), p.category
from merchant.order_lines l join merchant.orders o on o.id = l.order_id join merchant.accounts a on a.id = o.account_id
join merchant.products p on p.id = l.product_id
left join merchant.end_uses eu on eu.code = l.end_use and eu.jurisdiction = (select jurisdiction from merchant.settings)
where o.status in ('open', 'picked');

-- Every rule in docs/compliance.md, one row per finding.
create or replace view merchant.compliance_findings as
select 'treatment-for-use' rule, 'breach' severity, source || ' ' || ref ref, account subject,
  product || ' ' || product_name || ' is ' || coalesce(treatment, 'untreated') || '; ' || end_use_name || ' needs ' || min_treatment || ' or higher' detail
from merchant.line_uses where end_use is not null and coalesce(have_rank, -1) < need_rank
union all
select 'end-use-unknown', 'warn', source || ' ' || ref, account,
  product || ' ' || product_name || ' (' || coalesce(treatment, 'untreated') || ') is on the ' || source || ' with ' ||
  case when end_use is null then 'no end use recorded' else 'an end use not in the list: ' || end_use end || ', so the treatment cannot be checked'
from merchant.line_uses where category = 'timber' and coalesce(treatment, 'untreated') <> 'untreated' and (end_use is null or end_use_name is null)
union all
select 'grade-for-structure', 'breach', source || ' ' || ref, account,
  product || ' ' || product_name || ' has ' || coalesce('grade ' || grade, 'no stress grade') || '; ' || end_use_name || ' needs stress-graded timber'
from merchant.line_uses where needs_grade and coalesce(grade, '') !~* '^(M?SG|MGP|F|LVL)\s?\d'
union all
select 'ppsr-missing', 'breach', a.code, a.name,
  'trade credit limit set and no security interest registered: goods supplied on credit are unsecured if the account fails'
from merchant.accounts a where a.status <> 'closed' and a.kind = 'trade' and a.credit_limit_cents > 0 and a.ppsr_registered_on is null
union all
select 'ppsr-expiring', case when a.ppsr_expires_on < current_date then 'breach' else 'warn' end, a.code, a.name,
  case when a.ppsr_expires_on < current_date then 'registration lapsed ' || (current_date - a.ppsr_expires_on) || ' days ago'
    else 'registration lapses ' || a.ppsr_expires_on || ', in ' || (a.ppsr_expires_on - current_date) || ' days' end
from merchant.accounts a where a.status <> 'closed' and a.credit_limit_cents > 0 and a.ppsr_expires_on is not null
  and a.ppsr_expires_on < current_date + (select ppsr_warn_days from merchant.settings)
union all
select 'credit-application', 'breach', a.code, a.name, 'credit limit set with no signed credit application on file'
from merchant.accounts a where a.status <> 'closed' and a.kind = 'trade' and a.credit_limit_cents > 0 and a.credit_app_on is null
union all
select 'guarantee', 'warn', a.code, a.name, 'credit limit set with no personal guarantee signed'
from merchant.accounts a where a.status <> 'closed' and a.kind = 'trade' and a.credit_limit_cents > 0 and not a.guarantee_signed and a.credit_app_on is not null
union all
select 'product-information', 'breach', p.code, p.name,
  'designated building product with no link to its published product information' || case when p.own_import then ' (we import it, so we publish it)' else ' (ask the supplier for it)' end
from merchant.products p where p.active and p.designated_product and coalesce(p.product_info_url, '') = ''
  and (select jurisdiction from merchant.settings) = 'NZ'
union all
select 'buyer-details', 'breach', i.code, a.name,
  'invoice over the threshold for full taxable supply information with no billing address on the account'
from merchant.invoices i join merchant.accounts a on a.id = i.account_id
where i.status <> 'void' and i.total_cents > (select full_info_over_cents from merchant.settings) and coalesce(a.billing_address, '') = ''
  and (select jurisdiction from merchant.settings) = 'NZ'
union all
select 'stop-list-dispatch', 'breach', db.code, db.account,
  'delivery booked ' || db.run_on || ' for an account that is ' || coalesce(nullif(cw.flag, ''), replace(db.account_status, '_', ' '))
from merchant.dispatch_board db join merchant.orders o on o.code = db.order_code join merchant.credit_watch cw on cw.id = o.account_id
where db.status = 'scheduled' and (db.account_status = 'on_stop' or cw.flag in ('over limit', 'overdue past stop line'));
