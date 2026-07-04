-- HSC Ops Hub v2.0 — Supabase Schema
-- Run this in: Supabase → SQL Editor → New query → Run

-- ── Enable UUID extension ─────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── graffiti_log ──────────────────────────────────────────────────────────────
create table if not exists graffiti_log (
  id              bigserial primary key,
  timestamp       text,
  location        text,
  gps             text,
  surface_type    text,
  graffiti_type   text,
  image_link      text,
  status          text default 'Pending',
  owner           text default 'Unknown',
  difficulty      text,
  reported_to_city_date text,
  date_cleaned    text,
  notes           text,
  converted_to_lead_id bigint,
  date_discovered text,
  owner_contacted boolean default false,
  city_submission_date text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── incoming_reports ──────────────────────────────────────────────────────────
create table if not exists incoming_reports (
  id              bigserial primary key,
  date            text,
  location        text,
  description     text,
  image_url       text,
  source          text,
  status          text default 'pending',
  sync_timestamp  timestamptz default now(),
  source_id       text,
  created_at      timestamptz default now()
);

-- ── client_sites ──────────────────────────────────────────────────────────────
create table if not exists client_sites (
  id              bigserial primary key,
  name            text,
  address         text,
  contact_name    text,
  contact_phone   text,
  contact_email   text,
  status          text default 'Lead',
  priority        text default 'Medium',
  issue_summary   text,
  notes           text,
  next_action     text,
  quote_amount    numeric(10,2),
  lead_source     text,
  converted_to_lead_id bigint,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── site_contact_log ──────────────────────────────────────────────────────────
create table if not exists site_contact_log (
  id              bigserial primary key,
  site_id         bigint references client_sites(id) on delete cascade,
  date            text,
  method          text,
  contact_name    text,
  notes           text,
  follow_up_date  text,
  created_at      timestamptz default now()
);

-- ── site_visits ───────────────────────────────────────────────────────────────
create table if not exists site_visits (
  id              bigserial primary key,
  site_id         bigint references client_sites(id) on delete cascade,
  date            text,
  notes           text,
  cost_estimate   numeric(10,2),
  created_at      timestamptz default now()
);

-- ── site_visit_supplies ───────────────────────────────────────────────────────
create table if not exists site_visit_supplies (
  id              bigserial primary key,
  visit_id        bigint references site_visits(id) on delete cascade,
  item_name       text,
  quantity        numeric(10,3),
  unit_cost       numeric(10,2),
  created_at      timestamptz default now()
);

-- ── inventory_items ───────────────────────────────────────────────────────────
create table if not exists inventory_items (
  id              bigserial primary key,
  name            text not null,
  quantity        numeric(10,3) default 0,
  unit_cost       numeric(10,2) default 0,
  weighted_avg_cost numeric(10,4) default 0,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── inventory_log ─────────────────────────────────────────────────────────────
create table if not exists inventory_log (
  id              bigserial primary key,
  item_id         bigint references inventory_items(id) on delete cascade,
  date            text,
  qty_change      numeric(10,3),
  reason          text,
  cost_change     numeric(10,2),
  created_at      timestamptz default now()
);

-- ── shifts ────────────────────────────────────────────────────────────────────
create table if not exists shifts (
  id              bigserial primary key,
  date            text,
  hours           numeric(5,2),
  notes           text,
  location        text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── weather_entries ───────────────────────────────────────────────────────────
create table if not exists weather_entries (
  id              bigserial primary key,
  date            text unique,
  temp            numeric(5,1),
  conditions      text,
  alert_state     text,
  created_at      timestamptz default now()
);

-- ── personal_expenses ─────────────────────────────────────────────────────────
create table if not exists personal_expenses (
  id              bigserial primary key,
  date            text,
  category        text,
  amount          numeric(10,2),
  notes           text,
  created_at      timestamptz default now()
);

-- ── graffiti_outreach ─────────────────────────────────────────────────────────
create table if not exists graffiti_outreach (
  id              bigserial primary key,
  date            text,
  method          text,
  contact_name    text,
  notes           text,
  quote_amount    numeric(10,2),
  quote_status    text,
  follow_up_date  text,
  converted_to_lead_id bigint,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── bia_jobs ──────────────────────────────────────────────────────────────────
create table if not exists bia_jobs (
  id              bigserial primary key,
  description     text,
  location        text,
  status          text default 'Open',
  due_date        text,
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── properties (83 Barton St properties) ─────────────────────────────────────
create table if not exists properties (
  id              bigserial primary key,
  address         text not null,
  name            text,
  side            text,
  block_segment   text,
  facade_material text,
  vandalism_state text default 'Clean',
  status          text default 'Active',
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── property_history ──────────────────────────────────────────────────────────
create table if not exists property_history (
  id              bigserial primary key,
  property_id     bigint references properties(id) on delete cascade,
  field_changed   text,
  old_value       text,
  new_value       text,
  changed_at      timestamptz default now(),
  note            text
);

-- ── field_logs (iPhone field logging: bag drops + graffiti spots) ─────────────
create table if not exists field_logs (
  id              bigserial primary key,
  type            text not null,  -- 'bag_drop' | 'graffiti'
  logged_at       timestamptz not null,
  date            text,
  location        text,
  property_id     bigint references properties(id) on delete set null,
  property_name   text,
  surface_type    text,
  severity        text,
  bag_color       text,   -- 'Orange' | 'Yellow' | 'Clear' (bag_drop only); orange-equivalent factor derived at read time (see bagFactor in pages/field.js)
  notes           text,
  status          text default 'Pending',
  created_at      timestamptz default now()
);

-- ── events ────────────────────────────────────────────────────────────────────
create table if not exists events (
  id              bigserial primary key,
  date            text not null,
  title           text not null,
  description     text,
  event_type      text,
  created_at      timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security — only authenticated users can access any data
-- ─────────────────────────────────────────────────────────────────────────────

alter table graffiti_log       enable row level security;
alter table incoming_reports   enable row level security;
alter table client_sites       enable row level security;
alter table site_contact_log   enable row level security;
alter table site_visits        enable row level security;
alter table site_visit_supplies enable row level security;
alter table inventory_items    enable row level security;
alter table inventory_log      enable row level security;
alter table shifts             enable row level security;
alter table weather_entries    enable row level security;
alter table personal_expenses  enable row level security;
alter table graffiti_outreach  enable row level security;
alter table bia_jobs           enable row level security;
alter table properties         enable row level security;
alter table property_history   enable row level security;
alter table field_logs         enable row level security;
alter table events             enable row level security;

-- Single policy per table: authenticated users get full access
do $$
declare
  t text;
begin
  foreach t in array array[
    'graffiti_log','incoming_reports','client_sites','site_contact_log',
    'site_visits','site_visit_supplies','inventory_items','inventory_log',
    'shifts','weather_entries','personal_expenses','graffiti_outreach',
    'bia_jobs','properties','property_history','field_logs','events'
  ]
  loop
    execute format(
      'create policy "Authenticated users only" on %I
       for all to authenticated
       using (true) with check (true);', t
    );
  end loop;
end $$;
