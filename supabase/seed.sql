-- Demo seed matching lib/demo-data.ts. Run after 0001_core.sql on a dev branch.
insert into orgs (id, name, slug, custom_domain)
values ('00000000-0000-0000-0000-000000000001', 'Haven Collective', 'haven', 'stay.havencollective.co');

with p as (
  insert into properties (org_id, name, address_line1, city, country, timezone)
  values
    ('00000000-0000-0000-0000-000000000001', 'Ledger House',  '18 Jalan Mesui, Bukit Bintang', 'Kuala Lumpur', 'MY', 'Asia/Kuala_Lumpur'),
    ('00000000-0000-0000-0000-000000000001', 'Meridian Loft', '77 Duxton Road',                'Singapore',    'SG', 'Asia/Singapore'),
    ('00000000-0000-0000-0000-000000000001', 'Aster Court',   '5 Soi Sukhumvit 31',            'Bangkok',      'TH', 'Asia/Bangkok')
  returning id, name
),
u as (
  insert into units (property_id, label, floor, type, sqm, base_rent_cents, currency)
  select p.id, v.label, v.floor, v.type::unit_type, v.sqm, v.rent, 'MYR'
  from p join (values
    ('Ledger House', '2A', 2, 'suite',       64.0, 520000),
    ('Ledger House', '2B', 2, 'shared_room', 42.0, 340000),
    ('Ledger House', '3A', 3, 'suite',       64.0, 520000),
    ('Meridian Loft','01', 1, 'studio',      38.0, 410000),
    ('Meridian Loft','02', 2, 'suite',       58.0, 495000),
    ('Aster Court',  'A2', 1, 'shared_room', 44.0, 300000)
  ) as v(pname, label, floor, type, sqm, rent) on v.pname = p.name
  returning id, label
)
insert into beds (unit_id, label, rent_cents, status)
select u.id, b.label, b.rent, b.status::bed_status
from u join (values
  ('2A','A',175000,'occupied'), ('2A','B',175000,'occupied'), ('2A','C',170000,'occupied'),
  ('2B','A',115000,'occupied'), ('2B','B',115000,'available'),
  ('3A','A',175000,'occupied'), ('3A','B',175000,'hold'),
  ('01','A',410000,'occupied'),
  ('02','A',165000,'occupied'), ('02','B',165000,'occupied'), ('02','C',165000,'available'),
  ('A2','A',105000,'occupied'), ('A2','B',105000,'maintenance')
) as b(ulabel, label, rent, status) on b.ulabel = u.label;
