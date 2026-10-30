-- Building Merchant for Claude Code: the records a timber and building supplies merchant runs on.
-- Trade accounts and their price levels, quotes, orders, delivery runs, stock by branch,
-- invoices and payments, plus the rules for treated timber and trade credit.
-- Plain Postgres. Runs the same on PGlite (no extensions) and on any hosted Postgres.
-- Money is stored in cents, excluding GST, unless a column says otherwise.

create schema if not exists merchant;

create or replace function merchant.touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- One row: how this merchant works. Change it with /customise or a direct update.
create table merchant.settings (
  id int primary key default 1 check (id = 1),
  business_name text not null default 'Your Merchant',
  jurisdiction text not null default 'NZ' check (jurisdiction in ('NZ', 'AU')),
  currency text not null default 'NZD',
  gst_pct numeric(5,2) not null default 15,
  quote_valid_days int not null default 30,        -- a quote's validity when none is given
  quote_chase_days int not null default 7,         -- an open quote with no contact for this long needs a call
  stop_overdue_days int not null default 60,       -- an account this far past due goes on the stop list
  ppsr_warn_days int not null default 90,          -- warn this many days before a registration lapses
  full_info_over_cents int not null default 100000,-- NZ: supplies over $1,000 incl GST need the buyer's name and address
  slow_stock_days int not null default 120,        -- stock with no sale for this long is tying up cash
  sales_drop_pct int not null default 40,          -- an account buying this much less than its usual is flagged
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table merchant.branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table merchant.trucks (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null default 'flatdeck' check (kind in ('flatdeck', 'crane', 'tipper', 'van')),
  capacity_kg int not null check (capacity_kg > 0),
  branch_id uuid not null references merchant.branches(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Trade price levels: a discount off the list price. Contract prices override them per account.
create table merchant.price_levels (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  discount_pct numeric(5,2) not null default 0 check (discount_pct >= 0 and discount_pct < 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Hazard classes in order of protection, per jurisdiction (NZS 3640 in New Zealand, AS 1604.1 in Australia).
create table merchant.treatment_classes (
  jurisdiction text not null check (jurisdiction in ('NZ', 'AU')),
  code text not null,
  rank int not null,
  meaning text not null,
  primary key (jurisdiction, code)
);

-- What each end use needs. The operator owns this list: docs/compliance.md says where each row comes from.
create table merchant.end_uses (
  jurisdiction text not null check (jurisdiction in ('NZ', 'AU')),
  code text not null,
  name text not null,
  min_treatment text not null,
  needs_grade boolean not null default false,       -- structural use: the timber must carry a stress grade
  source text not null,
  primary key (jurisdiction, code),
  foreign key (jurisdiction, min_treatment) references merchant.treatment_classes(jurisdiction, code)
);

create table merchant.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null default 'hardware',        -- timber, sheet, roofing, concrete, hardware, fixings, landscape
  unit text not null default 'ea',                  -- ea, lm (lineal metre), sheet, bag, m2, m3, pack
  species text,
  treatment text,                                   -- untreated, H1.2, H3.1, H3.2, H4, H5, H6 (or H1 to H6 in Australia)
  grade text,                                       -- SG8, MSG10, No.1 framing, appearance...
  weight_kg numeric(10,2) not null default 0,       -- per unit, for loading trucks
  cost_cents int not null check (cost_cents >= 0),  -- current replacement cost, excl GST
  list_cents int not null check (list_cents >= 0),  -- retail list price, excl GST
  supplier text,
  own_import boolean not null default false,        -- we import it ourselves, so we carry the manufacturer's duties
  designated_product boolean not null default false,-- NZ designated building product (structural timber, plumbing...)
  product_info_url text,                            -- where the published product information sits
  cost_changed_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table merchant.stock (
  product_id uuid not null references merchant.products(id) on delete cascade,
  branch_id uuid not null references merchant.branches(id) on delete cascade,
  on_hand numeric(12,2) not null default 0,
  reorder_point numeric(12,2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (product_id, branch_id)
);

create table merchant.accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null default 'trade' check (kind in ('trade', 'cash')),
  branch_id uuid references merchant.branches(id),
  rep text,
  price_level_id uuid references merchant.price_levels(id),
  credit_limit_cents int not null default 0 check (credit_limit_cents >= 0),
  terms_day int not null default 20 check (terms_day between 1 and 28),  -- due on this day of the month after the invoice
  status text not null default 'open' check (status in ('open', 'on_stop', 'closed')),
  contact text,
  email text,
  phone text,
  billing_address text,
  business_number text,                             -- NZBN or ABN
  credit_app_on date,                               -- signed credit application on file
  guarantee_signed boolean not null default false,  -- personal guarantee from the directors
  ppsr_registered_on date,
  ppsr_expires_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table merchant.contract_prices (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references merchant.accounts(id) on delete cascade,
  product_id uuid not null references merchant.products(id) on delete cascade,
  price_cents int not null check (price_cents >= 0),
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, product_id)
);

-- A builder's site. Quotes, orders and deliveries hang off it.
create table merchant.jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references merchant.accounts(id) on delete cascade,
  code text not null unique,
  name text not null,
  site_address text,
  consent_ref text,
  status text not null default 'active' check (status in ('active', 'complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table merchant.quotes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  account_id uuid not null references merchant.accounts(id),
  job_id uuid references merchant.jobs(id),
  branch_id uuid references merchant.branches(id),
  rep text,
  quoted_on date not null default current_date,
  valid_to date not null,
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  last_contact_on date,
  lost_reason text,
  decided_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table merchant.quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references merchant.quotes(id) on delete cascade,
  product_id uuid not null references merchant.products(id),
  qty numeric(12,2) not null check (qty > 0),
  unit_cents int not null check (unit_cents >= 0),
  end_use text,                                     -- an end_uses code: decking, framing, piles...
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table merchant.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  account_id uuid not null references merchant.accounts(id),
  job_id uuid references merchant.jobs(id),
  quote_id uuid references merchant.quotes(id),
  branch_id uuid not null references merchant.branches(id),
  ordered_on date not null default current_date,
  required_on date,
  fulfilment text not null default 'delivery' check (fulfilment in ('delivery', 'pickup')),
  po_ref text,
  status text not null default 'open' check (status in ('open', 'picked', 'delivered', 'invoiced', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table merchant.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references merchant.orders(id) on delete cascade,
  product_id uuid not null references merchant.products(id),
  qty numeric(12,2) not null check (qty > 0),
  unit_cents int not null check (unit_cents >= 0),
  cost_cents int not null check (cost_cents >= 0), -- cost when ordered, so margin stays honest after a price rise
  end_use text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table merchant.deliveries (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  order_id uuid not null references merchant.orders(id) on delete cascade,
  truck_id uuid references merchant.trucks(id),
  run_on date not null,
  slot text not null default 'am' check (slot in ('am', 'pm')),
  status text not null default 'scheduled' check (status in ('scheduled', 'delivered', 'failed')),
  delivered_at timestamptz,
  signed_by text,
  fail_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table merchant.invoices (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  account_id uuid not null references merchant.accounts(id),
  order_id uuid references merchant.orders(id),
  issued_on date not null default current_date,
  due_on date not null,
  net_cents int not null,                           -- excl GST
  gst_cents int not null,
  total_cents int generated always as (net_cents + gst_cents) stored,
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table merchant.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references merchant.invoices(id) on delete cascade,
  paid_on date not null default current_date,
  amount_cents int not null check (amount_cents > 0),
  ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table merchant.notes (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('account', 'quote', 'order', 'product', 'job', 'delivery')),
  subject_id uuid not null,
  author text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per imported line, so a re-run of the same file skips what is already in.
create table merchant.import_rows (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  file_name text not null,
  row_number int not null,
  row_hash text not null,
  target_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, row_hash)
);

create index on merchant.quote_lines (quote_id);
create index on merchant.order_lines (order_id);
create index on merchant.orders (account_id, ordered_on);
create index on merchant.invoices (account_id, due_on);
create index on merchant.payments (invoice_id);
create index on merchant.deliveries (run_on);
create index on merchant.notes (subject_type, subject_id);

do $$
declare t text;
begin
  foreach t in array array['settings','branches','trucks','price_levels','products','accounts','contract_prices','jobs','quotes',
    'quote_lines','orders','order_lines','deliveries','invoices','payments','notes','import_rows'] loop
    execute format('create trigger touch before update on merchant.%I for each row execute function merchant.touch()', t);
  end loop;
  foreach t in array array['settings','branches','trucks','price_levels','treatment_classes','end_uses','products','stock','accounts',
    'contract_prices','jobs','quotes','quote_lines','orders','order_lines','deliveries','invoices','payments','notes','import_rows'] loop
    execute format('alter table merchant.%I enable row level security', t);
  end loop;
end $$;
create trigger touch before update on merchant.stock for each row execute function merchant.touch();

insert into merchant.settings (id) values (1) on conflict do nothing;

-- The hazard classes themselves are reference data, not demo data.
insert into merchant.treatment_classes (jurisdiction, code, rank, meaning) values
  ('NZ', 'untreated', 0, 'No preservative'),
  ('NZ', 'H1.1', 11, 'Protected from weather, dry in service'),
  ('NZ', 'H1.2', 12, 'Protected from weather, with a risk of moisture: enclosed framing'),
  ('NZ', 'H3.1', 31, 'Outside, above ground, painted: cladding and cavity battens'),
  ('NZ', 'H3.2', 32, 'Outside, above ground, exposed: decking, joists, fence rails'),
  ('NZ', 'H4', 40, 'In ground, non-structural: fence posts, landscaping'),
  ('NZ', 'H5', 50, 'In ground, structural: house piles, poles, retaining'),
  ('NZ', 'H6', 60, 'Marine'),
  ('AU', 'untreated', 0, 'No preservative'),
  ('AU', 'H1', 10, 'Inside, above ground, dry: insect borers only'),
  ('AU', 'H2', 20, 'Inside, above ground: borers and termites'),
  ('AU', 'H3', 30, 'Outside, above ground: moderate decay, borers and termites'),
  ('AU', 'H4', 40, 'Outside, in ground: severe decay'),
  ('AU', 'H5', 50, 'Outside, in ground contact with or in fresh water: very severe decay, critical use'),
  ('AU', 'H6', 60, 'Marine')
on conflict do nothing;

insert into merchant.end_uses (jurisdiction, code, name, min_treatment, needs_grade, source) values
  ('NZ', 'framing', 'Enclosed wall, floor and roof framing', 'H1.2', true, 'NZBC B2/AS1 and NZS 3602:2003 (BRANZ timber treatment table)'),
  ('NZ', 'cavity-batten', 'Cavity battens behind cladding', 'H3.1', false, 'NZBC B2/AS1 and NZS 3602:2003 (BRANZ timber treatment table)'),
  ('NZ', 'cladding', 'Painted exterior cladding and trim', 'H3.1', false, 'NZS 3602:2003 and NZS 3640:2003'),
  ('NZ', 'decking', 'Decking boards', 'H3.2', false, 'NZBC B2/AS1 and NZS 3602:2003 (BRANZ timber treatment table)'),
  ('NZ', 'deck-framing', 'Deck joists and bearers, exposed subfloor framing', 'H3.2', true, 'NZBC B2/AS1 and NZS 3602:2003 (BRANZ timber treatment table)'),
  ('NZ', 'cantilever-joist', 'Cantilevered floor joists', 'H3.2', true, 'NZBC B2/AS1: H3.2 for cantilevered joists and associated framing'),
  ('NZ', 'fence-rail', 'Fence rails and palings', 'H3.2', false, 'NZBC B2/AS1 and NZS 3602:2003 (BRANZ timber treatment table)'),
  ('NZ', 'fence-post', 'Fence posts in the ground', 'H4', false, 'NZBC B2/AS1 and NZS 3602:2003 (BRANZ timber treatment table)'),
  ('NZ', 'piles', 'House piles, poles, deck and veranda posts in the ground', 'H5', false, 'NZBC B2/AS1 and NZS 3602:2003 (BRANZ timber treatment table)'),
  ('NZ', 'retaining', 'Retaining wall posts in the ground', 'H5', false, 'NZS 3602:2003 and NZS 3640:2003 (H5 in-ground structural)'),
  ('NZ', 'interior', 'Interior lining, mouldings and joinery, dry', 'untreated', false, 'NZS 3602:2003 (dry, protected uses)'),
  ('AU', 'framing', 'Enclosed framing (termite area)', 'H2', true, 'AS 1604.1 hazard classes (WoodSolutions use class guide)'),
  ('AU', 'decking', 'Decking boards', 'H3', false, 'AS 1604.1 hazard classes (WoodSolutions use class guide)'),
  ('AU', 'deck-framing', 'Deck joists and bearers above ground', 'H3', true, 'AS 1604.1 hazard classes (WoodSolutions use class guide)'),
  ('AU', 'fence-rail', 'Fence rails and palings', 'H3', false, 'AS 1604.1 hazard classes (WoodSolutions use class guide)'),
  ('AU', 'fence-post', 'Fence posts in the ground', 'H4', false, 'AS 1604.1 hazard classes (WoodSolutions use class guide)'),
  ('AU', 'piles', 'In-ground structural posts and poles', 'H5', false, 'AS 1604.1 hazard classes (WoodSolutions use class guide)'),
  ('AU', 'retaining', 'Retaining wall posts in the ground', 'H5', false, 'AS 1604.1 hazard classes (WoodSolutions use class guide)'),
  ('AU', 'interior', 'Interior, dry, no termite risk', 'untreated', false, 'AS 1604.1 hazard classes')
on conflict do nothing;
