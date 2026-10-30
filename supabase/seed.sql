-- Demo data: Ridgeline Timber and Trade, a fictional two-branch timber and hardware merchant in the Waikato.
-- Every date is relative to today, so the attention list always has something to say.
-- Deliberate problems: decking quoted in the wrong treatment, utility-grade timber on a frame order,
-- retaining posts one class short, a lapsed and a lapsing security registration, an account with no
-- registration at all, a delivery booked for an account past the stop line, an account over its limit,
-- an expired quote nobody chased, a contract price under cost, a builder who has stopped buying,
-- an imported beam with no product information, a cash sale over the threshold with no address, slow stock.
-- Safe to run twice: every insert skips rows that are already there.

update merchant.settings set business_name = 'Ridgeline Timber and Trade', jurisdiction = 'NZ', currency = 'NZD', gst_pct = 15
where id = 1 and business_name = 'Your Merchant';

insert into merchant.branches (code, name, address) values
  ('HAM', 'Hamilton yard', '14 Kahikatea Drive, Frankton, Hamilton'),
  ('TEA', 'Te Awamutu trade counter', '3 Factory Road, Te Awamutu')
on conflict (code) do nothing;

insert into merchant.trucks (code, name, kind, capacity_kg, branch_id) values
  ('CR1', 'Crane truck 1', 'crane', 8000, (select id from merchant.branches where code = 'HAM')),
  ('FD1', 'Flatdeck 1', 'flatdeck', 4000, (select id from merchant.branches where code = 'HAM')),
  ('FD2', 'Flatdeck 2', 'flatdeck', 4000, (select id from merchant.branches where code = 'TEA'))
on conflict (code) do nothing;

insert into merchant.price_levels (code, name, discount_pct) values
  ('RETAIL', 'Retail', 0),
  ('TRADE', 'Trade', 15),
  ('BUILDER', 'Builder', 22),
  ('KEY', 'Key account', 28)
on conflict (code) do nothing;

insert into merchant.products (code, name, category, unit, species, treatment, grade, weight_kg, cost_cents, list_cents, supplier, own_import, designated_product, product_info_url, cost_changed_on) values
  ('FR9045-H12', '90x45 SG8 H1.2 framing', 'timber', 'lm', 'Radiata pine', 'H1.2', 'SG8', 2.0, 310, 540, 'Central Sawmills', false, true, 'https://example.com/bpir/central-structural-timber', null),
  ('FR9045-UT', '90x45 utility H1.2 framing', 'timber', 'lm', 'Radiata pine', 'H1.2', 'Utility', 2.0, 230, 410, 'Central Sawmills', false, false, null, null),
  ('FR9045-H32', '90x45 SG8 H3.2', 'timber', 'lm', 'Radiata pine', 'H3.2', 'SG8', 2.1, 360, 620, 'Central Sawmills', false, true, 'https://example.com/bpir/central-structural-timber', null),
  ('FR14045-H12', '140x45 SG8 H1.2 framing', 'timber', 'lm', 'Radiata pine', 'H1.2', 'SG8', 3.1, 480, 840, 'Central Sawmills', false, true, 'https://example.com/bpir/central-structural-timber', null),
  ('JS19045-H32', '190x45 SG8 H3.2 joist', 'timber', 'lm', 'Radiata pine', 'H3.2', 'SG8', 4.2, 690, 1190, 'Central Sawmills', false, true, 'https://example.com/bpir/central-structural-timber', null),
  ('DK14032-H32', '140x32 pine decking H3.2', 'timber', 'lm', 'Radiata pine', 'H3.2', null, 2.2, 320, 560, 'Bay Decking', false, false, null, null),
  ('DK14032-H31', '140x32 pine weatherboard blank H3.1', 'timber', 'lm', 'Radiata pine', 'H3.1', null, 2.2, 270, 490, 'Bay Decking', false, false, null, null),
  ('BT4520-H31', '45x20 cavity batten H3.1', 'timber', 'lm', 'Radiata pine', 'H3.1', null, 0.5, 95, 180, 'Central Sawmills', false, false, null, null),
  ('PL125-H5', '125mm round pile H5 1.2m', 'timber', 'ea', 'Radiata pine', 'H5', null, 9.0, 1450, 2490, 'Waikato Poles', false, true, 'https://example.com/bpir/waikato-poles', null),
  ('PO100-H4', '100x100 fence post H4 2.4m', 'timber', 'ea', 'Radiata pine', 'H4', null, 11.0, 980, 1690, 'Waikato Poles', false, false, null, null),
  ('PO125-H5', '125x125 post H5 2.4m', 'timber', 'ea', 'Radiata pine', 'H5', null, 17.0, 1980, 3390, 'Waikato Poles', false, true, 'https://example.com/bpir/waikato-poles', null),
  ('RL10050-H32', '100x50 fence rail H3.2', 'timber', 'lm', 'Radiata pine', 'H3.2', null, 2.4, 290, 510, 'Central Sawmills', false, false, null, null),
  ('LVL24045', '240x45 LVL11 beam', 'timber', 'lm', 'LVL', 'H1.2', 'LVL11', 5.6, 2350, 3690, 'Pacific Engineered Timber (import)', true, true, null, current_date - 21),
  ('PLY17-H32', '17mm structural ply H3.2 2400x1200', 'sheet', 'sheet', 'Radiata pine', 'H3.2', null, 26.0, 6400, 9900, 'Ply Mills NZ', false, true, 'https://example.com/bpir/ply-mills', null),
  ('GIB10', '10mm plasterboard 2400x1200', 'sheet', 'sheet', null, null, null, 18.0, 1550, 2450, 'Board Co', false, true, 'https://example.com/bpir/board-co', null),
  ('MDF-SK60', 'MDF skirting 60x12 primed', 'timber', 'lm', 'MDF', 'untreated', null, 0.6, 160, 320, 'Mouldings Direct', false, false, null, null),
  ('CON40', 'Concrete mix 40kg bag', 'concrete', 'bag', null, null, null, 40.0, 920, 1450, 'Ready Bag', false, false, null, null),
  ('NL90-5', '90mm framing nails 5kg', 'fixings', 'pack', null, null, null, 5.0, 2900, 4590, 'Fixings Wholesale', false, false, null, null),
  ('SC-DECK', 'Decking screws 10g 50mm stainless, 500', 'fixings', 'pack', null, null, null, 2.5, 6200, 9800, 'Fixings Wholesale', false, false, null, null),
  ('RF-CORR-RED', 'Corrugate 0.40 Pohutukawa red (discontinued colour)', 'roofing', 'lm', null, null, null, 3.9, 1750, 2890, 'Roll Form NZ', false, false, null, null)
on conflict (code) do nothing;

insert into merchant.stock (product_id, branch_id, on_hand, reorder_point)
select p.id, b.id, v.on_hand, v.reorder_point
from (values
  ('FR9045-H12', 'HAM', 4800, 1500), ('FR9045-UT', 'HAM', 900, 200), ('FR9045-H32', 'HAM', 1200, 400), ('FR14045-H12', 'HAM', 1600, 600),
  ('JS19045-H32', 'HAM', 350, 300), ('DK14032-H32', 'HAM', 2400, 800), ('DK14032-H31', 'HAM', 600, 200), ('BT4520-H31', 'HAM', 3000, 800),
  ('PL125-H5', 'HAM', 140, 60), ('PO100-H4', 'HAM', 220, 80), ('PO125-H5', 'HAM', 30, 40), ('RL10050-H32', 'HAM', 1500, 500),
  ('LVL24045', 'HAM', 60, 40), ('PLY17-H32', 'HAM', 80, 30), ('GIB10', 'HAM', 300, 100), ('MDF-SK60', 'HAM', 900, 200),
  ('CON40', 'HAM', 400, 120), ('NL90-5', 'HAM', 60, 20), ('SC-DECK', 'HAM', 25, 10), ('RF-CORR-RED', 'HAM', 420, 0),
  ('FR9045-H12', 'TEA', 1200, 600), ('DK14032-H32', 'TEA', 500, 300), ('PO100-H4', 'TEA', 120, 50), ('CON40', 'TEA', 150, 60),
  ('RL10050-H32', 'TEA', 400, 200), ('SC-DECK', 'TEA', 8, 10)
) v(product, branch, on_hand, reorder_point)
join merchant.products p on p.code = v.product join merchant.branches b on b.code = v.branch
on conflict do nothing;

insert into merchant.accounts (code, name, kind, branch_id, rep, price_level_id, credit_limit_cents, terms_day, status, contact, email, phone, billing_address, business_number, credit_app_on, guarantee_signed, ppsr_registered_on, ppsr_expires_on)
select v.code, v.name, v.kind, b.id, v.rep, pl.id, v.credit_limit_cents, 20, v.status, v.contact, v.email, v.phone, v.billing_address, v.business_number,
  v.credit_app_on, v.guarantee_signed, v.ppsr_registered_on, v.ppsr_expires_on
from (values
  ('KRB', 'Kauri Ridge Builders Ltd', 'trade', 'HAM', 'Mere Tane', 'BUILDER', 2500000, 'open', 'Sam Kauri', 'accounts@kauriridge.example', '021 555 0101', '22 Ruakura Road, Hamilton', '9429000000011', current_date - 1700, true, current_date - 1785, current_date + 40),
  ('WAH', 'Waipa Homes Ltd', 'trade', 'TEA', 'Mere Tane', 'KEY', 8000000, 'open', 'Aroha Bell', 'payables@waipahomes.example', '07 555 0202', '9 Bank Street, Te Awamutu', '9429000000028', current_date - 900, true, current_date - 900, current_date + 925),
  ('SDF', 'Stonefield Decks and Fences', 'trade', 'HAM', 'Jono Reid', 'TRADE', 1000000, 'open', 'Dave Stone', 'dave@stonefield.example', '027 555 0303', '5 Gordonton Road, Hamilton', '9429000000035', current_date - 400, true, current_date - 400, current_date + 1425),
  ('TUI', 'Tui Construction Ltd', 'trade', 'HAM', 'Jono Reid', 'BUILDER', 3000000, 'open', 'Liam Tui', 'liam@tuiconstruction.example', '022 555 0404', '88 Grey Street, Hamilton East', '9429000000042', current_date - 300, true, null, null),
  ('MAT', 'Matai Renovations', 'trade', 'HAM', 'Jono Reid', 'TRADE', 800000, 'open', 'Grace Matai', 'grace@matairenos.example', '021 555 0505', '41 Peachgrove Road, Hamilton', null, null, false, null, null),
  ('POH', 'Pohutukawa Landscapes', 'trade', 'TEA', 'Mere Tane', 'TRADE', 500000, 'open', 'Rangi Hohaia', 'office@pohlandscapes.example', '07 555 0606', '120 Ohaupo Road, Te Awamutu', '9429000000059', current_date - 2000, true, current_date - 1840, current_date - 15),
  ('KER', 'Kereru Joinery', 'trade', 'HAM', 'Mere Tane', 'TRADE', 1500000, 'open', 'Ana Kereru', 'ana@kererujoinery.example', '07 555 0707', '7 Te Rapa Road, Hamilton', '9429000000066', current_date - 500, false, current_date - 500, current_date + 1325),
  ('HRK', 'Harakeke Homes Ltd', 'trade', 'HAM', 'Jono Reid', 'BUILDER', 5000000, 'open', 'Tom Harakeke', 'tom@harakekehomes.example', '021 555 0808', '15 Victoria Street, Cambridge', '9429000000073', current_date - 700, true, current_date - 700, current_date + 1125),
  ('CASH01', 'J Ngata (cash sale)', 'cash', 'HAM', null, 'RETAIL', 0, 'open', 'Jamie Ngata', null, '027 555 0909', null, null, null, false, null, null)
) v(code, name, kind, branch, rep, level, credit_limit_cents, status, contact, email, phone, billing_address, business_number, credit_app_on, guarantee_signed, ppsr_registered_on, ppsr_expires_on)
join merchant.branches b on b.code = v.branch join merchant.price_levels pl on pl.code = v.level
on conflict (code) do nothing;

insert into merchant.contract_prices (account_id, product_id, price_cents, valid_to)
select a.id, p.id, v.price_cents, current_date + v.valid_days
from (values ('HRK', 'LVL24045', 2290, 120), ('WAH', 'FR9045-H12', 360, 200), ('WAH', 'FR14045-H12', 560, 200), ('KRB', 'DK14032-H32', 420, 90)) v(account, product, price_cents, valid_days)
join merchant.accounts a on a.code = v.account join merchant.products p on p.code = v.product
on conflict do nothing;

insert into merchant.jobs (account_id, code, name, site_address, consent_ref, status)
select a.id, v.code, v.name, v.site, v.consent, v.status
from (values
  ('KRB', 'KRB-PUK12', 'Lot 12 Pukete deck and pergola', '12 Pukete Road, Hamilton', 'BC250611', 'active'),
  ('KRB', 'KRB-ROT4', 'Rototuna new build, lot 4', '4 Kakapo Rise, Rototuna', 'BC250588', 'active'),
  ('WAH', 'WAH-STG2', 'Stage 2 subdivision, eight houses', 'Sandes Street subdivision, Te Awamutu', 'BC250402', 'active'),
  ('TUI', 'TUI-HE88', 'Hamilton East townhouses', '90 Grey Street, Hamilton East', 'BC250699', 'active'),
  ('POH', 'POH-OHA', 'Ohaupo farm boundary fence', '1400 Ohaupo Road, Ohaupo', null, 'active'),
  ('MAT', 'MAT-PG41', 'Peachgrove retaining wall', '41 Peachgrove Road, Hamilton', 'BC250702', 'active'),
  ('HRK', 'HRK-CAM15', 'Cambridge two-storey', '15 Thornton Road, Cambridge', 'BC250540', 'active'),
  ('SDF', 'SDF-FLAG', 'Flagstaff deck', '3 Flagstaff Drive, Hamilton', null, 'active')
) v(account, code, name, site, consent, status)
join merchant.accounts a on a.code = v.account
on conflict (code) do nothing;

insert into merchant.quotes (code, account_id, job_id, branch_id, rep, quoted_on, valid_to, status, last_contact_on, lost_reason, decided_on)
select v.code, a.id, j.id, b.id, v.rep, current_date - v.age, current_date - v.age + 30, v.status, case when v.contact_age is null then null else current_date - v.contact_age end,
  v.lost_reason, case when v.decided_age is null then null else current_date - v.decided_age end
from (values
  ('Q-1001', 'KRB', 'KRB-PUK12', 'HAM', 'Mere Tane', 12, 'open', null, null, null),
  ('Q-1002', 'WAH', 'WAH-STG2', 'TEA', 'Mere Tane', 40, 'open', 38, null, null),
  ('Q-1003', 'TUI', 'TUI-HE88', 'HAM', 'Jono Reid', 3, 'open', null, null, null),
  ('Q-1004', 'POH', 'POH-OHA', 'TEA', 'Mere Tane', 16, 'open', 9, null, null),
  ('Q-1005', 'HRK', 'HRK-CAM15', 'HAM', 'Jono Reid', 6, 'open', 2, null, null),
  ('Q-1006', 'MAT', 'MAT-PG41', 'HAM', 'Jono Reid', 5, 'open', 1, null, null),
  ('Q-0990', 'KRB', 'KRB-ROT4', 'HAM', 'Mere Tane', 55, 'won', 50, null, 48),
  ('Q-0991', 'WAH', 'WAH-STG2', 'TEA', 'Mere Tane', 70, 'lost', 64, 'Price: frame package went to another merchant', 60),
  ('Q-0992', 'HRK', 'HRK-CAM15', 'HAM', 'Jono Reid', 75, 'won', 70, null, 66),
  ('Q-0993', 'TUI', 'TUI-HE88', 'HAM', 'Jono Reid', 90, 'lost', 80, 'Lead time on LVL', 78),
  ('Q-0994', 'SDF', 'SDF-FLAG', 'HAM', 'Jono Reid', 30, 'won', 26, null, 25)
) v(code, account, job, branch, rep, age, status, contact_age, lost_reason, decided_age)
join merchant.accounts a on a.code = v.account join merchant.jobs j on j.code = v.job join merchant.branches b on b.code = v.branch
on conflict (code) do nothing;

insert into merchant.quote_lines (quote_id, product_id, qty, unit_cents, end_use)
select q.id, p.id, v.qty, merchant.price_for(q.account_id, p.id), v.end_use
from (values
  ('Q-1001', 'DK14032-H31', 180, 'decking'), ('Q-1001', 'JS19045-H32', 96, 'deck-framing'), ('Q-1001', 'PL125-H5', 24, 'piles'), ('Q-1001', 'SC-DECK', 4, null),
  ('Q-1002', 'FR9045-H12', 6400, 'framing'), ('Q-1002', 'FR14045-H12', 1800, 'framing'), ('Q-1002', 'BT4520-H31', 2600, 'cavity-batten'), ('Q-1002', 'NL90-5', 24, null),
  ('Q-1003', 'FR9045-H12', 2200, 'framing'), ('Q-1003', 'LVL24045', 36, 'framing'), ('Q-1003', 'GIB10', 140, null), ('Q-1003', 'BT4520-H31', 900, null),
  ('Q-1004', 'PO100-H4', 120, 'fence-post'), ('Q-1004', 'RL10050-H32', 900, 'fence-rail'), ('Q-1004', 'CON40', 60, null),
  ('Q-1005', 'LVL24045', 48, 'framing'), ('Q-1005', 'PLY17-H32', 24, null),
  ('Q-1006', 'PO100-H4', 18, 'retaining'), ('Q-1006', 'CON40', 30, null),
  ('Q-0990', 'FR9045-H12', 1800, 'framing'), ('Q-0991', 'FR9045-H12', 5200, 'framing'), ('Q-0992', 'FR9045-H12', 2400, 'framing'),
  ('Q-0993', 'LVL24045', 60, 'framing'), ('Q-0994', 'DK14032-H32', 160, 'decking'), ('Q-0994', 'JS19045-H32', 80, 'deck-framing')
) v(quote, product, qty, end_use)
join merchant.quotes q on q.code = v.quote join merchant.products p on p.code = v.product
where not exists (select 1 from merchant.quote_lines);

insert into merchant.orders (code, account_id, job_id, quote_id, branch_id, ordered_on, required_on, fulfilment, po_ref, status)
select v.code, a.id, j.id, q.id, b.id, current_date - v.age, current_date - v.age + v.lead, v.fulfilment, v.po, v.status
from (values
  ('O-4990', 'KER', null, null, 'HAM', 210, 3, 'pickup', 'KJ-118', 'invoiced'),
  ('O-5001', 'WAH', 'WAH-STG2', null, 'TEA', 125, 5, 'delivery', 'WH-2201', 'invoiced'),
  ('O-5002', 'WAH', 'WAH-STG2', null, 'TEA', 100, 5, 'delivery', 'WH-2214', 'invoiced'),
  ('O-5003', 'WAH', 'WAH-STG2', null, 'TEA', 30, 3, 'delivery', 'WH-2290', 'invoiced'),
  ('O-5004', 'KRB', 'KRB-ROT4', 'Q-0990', 'HAM', 46, 4, 'delivery', 'ROT4-01', 'invoiced'),
  ('O-5005', 'SDF', 'SDF-FLAG', 'Q-0994', 'HAM', 110, 3, 'delivery', null, 'invoiced'),
  ('O-5006', 'SDF', 'SDF-FLAG', null, 'HAM', 2, 3, 'delivery', null, 'open'),
  ('O-5007', 'TUI', 'TUI-HE88', null, 'HAM', 12, 3, 'delivery', 'HE88-07', 'delivered'),
  ('O-5008', 'TUI', 'TUI-HE88', null, 'HAM', 4, 5, 'delivery', 'HE88-08', 'open'),
  ('O-5009', 'HRK', 'HRK-CAM15', 'Q-0992', 'HAM', 5, 5, 'delivery', 'CAM15-03', 'picked'),
  ('O-5010', 'KRB', 'KRB-PUK12', null, 'HAM', 1, 1, 'delivery', 'PUK12-01', 'open'),
  ('O-5011', 'MAT', 'MAT-PG41', null, 'HAM', 3, 1, 'pickup', null, 'open'),
  ('O-5012', 'CASH01', null, null, 'HAM', 15, 0, 'pickup', null, 'invoiced'),
  ('O-5013', 'HRK', 'HRK-CAM15', null, 'HAM', 62, 4, 'delivery', 'CAM15-01', 'invoiced'),
  ('O-5014', 'KER', null, null, 'HAM', 22, 2, 'pickup', 'KJ-140', 'invoiced'),
  ('O-5015', 'POH', 'POH-OHA', null, 'TEA', 72, 3, 'delivery', null, 'invoiced')
) v(code, account, job, quote, branch, age, lead, fulfilment, po, status)
join merchant.accounts a on a.code = v.account join merchant.branches b on b.code = v.branch
left join merchant.jobs j on j.code = v.job left join merchant.quotes q on q.code = v.quote
on conflict (code) do nothing;

insert into merchant.order_lines (order_id, product_id, qty, unit_cents, cost_cents, end_use)
select o.id, p.id, v.qty, merchant.price_for(o.account_id, p.id), case when p.code = 'LVL24045' and o.ordered_on < current_date - 21 then 2050 else p.cost_cents end, v.end_use
from (values
  ('O-4990', 'RF-CORR-RED', 60, null), ('O-4990', 'MDF-SK60', 300, 'interior'),
  ('O-5001', 'FR9045-H12', 6000, 'framing'), ('O-5001', 'FR14045-H12', 1600, 'framing'), ('O-5001', 'NL90-5', 20, null),
  ('O-5002', 'FR9045-H12', 5400, 'framing'), ('O-5002', 'GIB10', 260, null), ('O-5002', 'BT4520-H31', 2200, 'cavity-batten'),
  ('O-5003', 'FR9045-H12', 400, 'framing'), ('O-5003', 'NL90-5', 4, null),
  ('O-5004', 'FR9045-H12', 1800, 'framing'), ('O-5004', 'FR14045-H12', 600, 'framing'), ('O-5004', 'GIB10', 90, null),
  ('O-5005', 'DK14032-H32', 160, 'decking'), ('O-5005', 'JS19045-H32', 80, 'deck-framing'), ('O-5005', 'PL125-H5', 20, 'piles'), ('O-5005', 'SC-DECK', 3, null),
  ('O-5006', 'RL10050-H32', 300, 'fence-rail'), ('O-5006', 'PO100-H4', 40, 'fence-post'),
  ('O-5007', 'FR9045-H12', 2600, 'framing'), ('O-5007', 'FR14045-H12', 900, 'framing'), ('O-5007', 'GIB10', 180, null),
  ('O-5008', 'LVL24045', 80, 'framing'), ('O-5008', 'FR9045-H12', 1400, 'framing'), ('O-5008', 'PLY17-H32', 40, null),
  ('O-5009', 'FR9045-H12', 1600, 'framing'), ('O-5009', 'LVL24045', 30, 'framing'), ('O-5009', 'PLY17-H32', 30, null),
  ('O-5010', 'FR9045-UT', 240, 'framing'), ('O-5010', 'FR9045-H12', 180, 'deck-framing'), ('O-5010', 'PL125-H5', 16, 'piles'),
  ('O-5011', 'PO125-H5', 12, 'retaining'), ('O-5011', 'CON40', 24, null),
  ('O-5012', 'DK14032-H32', 120, 'decking'), ('O-5012', 'SC-DECK', 4, null), ('O-5012', 'JS19045-H32', 40, 'deck-framing'),
  ('O-5013', 'FR9045-H12', 2200, 'framing'), ('O-5013', 'LVL24045', 24, 'framing'),
  ('O-5014', 'MDF-SK60', 400, 'interior'), ('O-5014', 'PLY17-H32', 6, null),
  ('O-5015', 'PO100-H4', 90, 'fence-post'), ('O-5015', 'RL10050-H32', 700, 'fence-rail'), ('O-5015', 'CON40', 40, null)
) v(ord, product, qty, end_use)
join merchant.orders o on o.code = v.ord join merchant.products p on p.code = v.product
where not exists (select 1 from merchant.order_lines);

insert into merchant.deliveries (code, order_id, truck_id, run_on, slot, status, delivered_at, signed_by, fail_reason)
select v.code, o.id, t.id, current_date + v.day, v.slot, v.status,
  case when v.status = 'delivered' then (current_date + v.day)::timestamptz + interval '10 hours' end, v.signed_by, v.fail_reason
from (values
  ('D-7001', 'O-5001', 'CR1', -123, 'am', 'delivered', 'A Bell', null),
  ('D-7002', 'O-5002', 'CR1', -98, 'am', 'delivered', 'A Bell', null),
  ('D-7003', 'O-5003', 'FD2', -28, 'pm', 'delivered', 'Site foreman', null),
  ('D-7004', 'O-5004', 'CR1', -43, 'am', 'delivered', 'S Kauri', null),
  ('D-7005', 'O-5005', 'FD1', -107, 'pm', 'delivered', 'D Stone', null),
  ('D-7006', 'O-5007', 'CR1', -10, 'am', 'failed', null, 'Site locked, no one on site'),
  ('D-7007', 'O-5007', 'CR1', -9, 'am', 'delivered', 'L Tui', null),
  ('D-7008', 'O-5013', 'CR1', -59, 'am', 'delivered', 'T Harakeke', null),
  ('D-7009', 'O-5015', 'FD2', -69, 'am', 'delivered', 'R Hohaia', null),
  ('D-7010', 'O-5009', 'CR1', 0, 'am', 'scheduled', null, null),
  ('D-7011', 'O-5010', 'FD1', 0, 'pm', 'scheduled', null, null),
  ('D-7012', 'O-5006', 'FD1', 1, 'am', 'scheduled', null, null),
  ('D-7013', 'O-5008', 'FD1', 1, 'am', 'scheduled', null, null)
) v(code, ord, truck, day, slot, status, signed_by, fail_reason)
join merchant.orders o on o.code = v.ord join merchant.trucks t on t.code = v.truck
on conflict (code) do nothing;

-- Invoices for every invoiced order, due on the account's terms day of the following month.
insert into merchant.invoices (code, account_id, order_id, issued_on, due_on, net_cents, gst_cents, status)
select 'INV-' || substr(ov.code, 3), ov.account_id, ov.id, ov.ordered_on + 3,
  (date_trunc('month', ov.ordered_on + 3) + interval '1 month')::date + (a.terms_day - 1),
  ov.net_cents, round(ov.net_cents * (select gst_pct from merchant.settings) / 100), 'open'
from merchant.order_value ov join merchant.accounts a on a.id = ov.account_id
where ov.status = 'invoiced'
on conflict (code) do nothing;

-- Payments: most accounts pay on time; Stonefield and Pohutukawa have not, Kereru has paid part.
insert into merchant.payments (invoice_id, paid_on, amount_cents, ref)
select i.id, least(i.due_on, current_date), case when i.code = 'INV-5014' then i.total_cents / 2 else i.total_cents end, 'DC ' || i.code
from merchant.invoices i
where i.code in ('INV-4990', 'INV-5001', 'INV-5002', 'INV-5004', 'INV-5012', 'INV-5013', 'INV-5014')
  and not exists (select 1 from merchant.payments);
update merchant.invoices set status = 'paid'
where code in ('INV-4990', 'INV-5001', 'INV-5002', 'INV-5004', 'INV-5012', 'INV-5013') and status = 'open';

insert into merchant.notes (subject_type, subject_id, author, body, created_at)
select v.kind, coalesce(a.id, q.id), v.author, v.body, now() - (v.age || ' days')::interval
from (values
  ('account', 'SDF', null, 'Jono Reid', 'Dave says the deck job owner has not paid him. Promised a payment by the end of the month.', 12),
  ('quote', null, 'Q-1002', 'Mere Tane', 'Aroha asked for the stage 2 frame package price again. Sent revised pricing.', 38),
  ('account', 'WAH', null, 'Mere Tane', 'Heard Waipa Homes are getting frames from a truss plant direct for stage 2.', 20)
) v(kind, account, quote, author, body, age)
left join merchant.accounts a on a.code = v.account left join merchant.quotes q on q.code = v.quote
where not exists (select 1 from merchant.notes);
