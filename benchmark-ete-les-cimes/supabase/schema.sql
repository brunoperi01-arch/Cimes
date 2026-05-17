-- ═══════════════════════════════════════════════════════════
-- BENCHMARK ÉTÉ — LES CIMES DU VAL D'ALLOS
-- À exécuter dans Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════
create extension if not exists "uuid-ossp";

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text, full_name text, role text default 'owner',
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists weeks (
  id text primary key, year int not null, week_number int not null,
  week_start date not null, week_end date not null, month_label text,
  season_type text check (season_type in ('haute','moyenne','basse')),
  event_label text, created_at timestamptz default now()
);

create table if not exists competitors (
  id text primary key, name text not null,
  property_type text check (property_type in ('résidence','hôtel','particulier','agence','distributeur')),
  source text, standing int, has_pool bool default false, has_ski_access bool default false,
  capacity_min int, capacity_max int, booking_rating numeric(3,1), url text,
  comparability_score int check (comparability_score between 0 and 100),
  active bool default true, notes text, created_at timestamptz default now()
);

create table if not exists competitor_rates (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null default auth.uid(),
  week_id text references weeks(id), competitor_id text references competitors(id),
  source text not null, property_name text, property_type text,
  capacity int not null, price_week numeric(8,2) not null,
  price_night numeric(8,2) generated always as (round(price_week/7,2)) stored,
  original_price numeric(8,2), promo_label text, promo_percent numeric(5,2) default 0,
  cleaning_fee numeric(8,2) default 0, tourist_tax numeric(8,2) default 0,
  breakfast_included bool default false, cancellation_policy text,
  availability_status text default 'disponible', booking_rating numeric(3,1), url text,
  collection_type text not null check (collection_type in ('manuelle','csv','copier-coller','api','extension')),
  reliability_status text not null default 'saisi manuellement'
    check (reliability_status in ('réel','saisi manuellement','importé CSV','estimé','copier-coller','à vérifier')),
  is_example bool default false, collected_at date not null default current_date, notes text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

-- Index de performance
create index if not exists idx_cr_week     on competitor_rates(week_id);
create index if not exists idx_cr_user     on competitor_rates(user_id);
create index if not exists idx_cr_week_cap on competitor_rates(week_id, capacity);
create index if not exists idx_cr_collected on competitor_rates(collected_at desc);

-- Contraintes doublon v2
create unique index if not exists idx_cr_dup_with_comp
  on competitor_rates(week_id, competitor_id, capacity, collected_at, source)
  where competitor_id is not null;
create unique index if not exists idx_cr_dup_no_comp
  on competitor_rates(week_id, property_name, source, capacity, collected_at)
  where competitor_id is null and property_name is not null;

create table if not exists my_rates (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null default auth.uid(),
  week_id text references weeks(id), capacity int not null, channel text,
  price_week numeric(8,2) not null,
  price_night numeric(8,2) generated always as (round(price_week/7,2)) stored,
  source text, reliability_status text default 'réel',
  collected_at date not null default current_date, notes text,
  created_at timestamptz default now()
);

create table if not exists collection_jobs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null default auth.uid(),
  source text not null, competitor_id text references competitors(id), url text,
  week_start date, week_end date, capacity int,
  status text default 'en attente' check (status in ('en attente','fait','erreur','obsolète','à vérifier')),
  collection_mode text check (collection_mode in ('manuelle','csv','copier-coller','api','extension')),
  priority int default 1, last_run_at timestamptz, next_run_at timestamptz,
  error_message text, created_at timestamptz default now()
);

create table if not exists recommendations (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null default auth.uid(),
  week_id text references weeks(id), capacity int not null,
  our_price numeric(8,2), market_median numeric(8,2), residence_median numeric(8,2),
  private_median numeric(8,2), hotel_median numeric(8,2),
  recommended_low numeric(8,2), recommended_target numeric(8,2), recommended_high numeric(8,2),
  recommended_action text, urgency_level text, confidence_level text,
  confidence_score int, competitors_count int, data_age_days int, explanation text,
  calculated_at timestamptz default now(), created_at timestamptz default now()
);

create table if not exists imports (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null default auth.uid(),
  import_source text not null, file_name text, rows_total int default 0,
  rows_imported int default 0, rows_skipped int default 0,
  rows_error int default 0, rows_duplicate int default 0,
  status text default 'ok' check (status in ('ok','partiel','erreur')),
  error_details jsonb, imported_at timestamptz default now(), notes text
);

-- Trigger updated_at
create or replace function update_updated_at() returns trigger as $$
begin new.updated_at=now(); return new; end;
$$ language plpgsql;
create trigger trg_cr_updated before update on competitor_rates for each row execute function update_updated_at();

-- Trigger: créer profil à l'inscription
create or replace function handle_new_user() returns trigger as $$
begin insert into profiles(id,email) values(new.id,new.email) on conflict(id) do nothing; return new; end;
$$ language plpgsql security definer;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- RLS
alter table profiles          enable row level security;
alter table competitor_rates  enable row level security;
alter table my_rates          enable row level security;
alter table collection_jobs   enable row level security;
alter table recommendations   enable row level security;
alter table imports           enable row level security;
alter table weeks             enable row level security;
alter table competitors       enable row level security;

create policy "own" on profiles          for all using (auth.uid()=id);
create policy "own" on competitor_rates  for all using (auth.uid()=user_id);
create policy "own" on my_rates          for all using (auth.uid()=user_id);
create policy "own" on collection_jobs   for all using (auth.uid()=user_id);
create policy "own" on recommendations   for all using (auth.uid()=user_id);
create policy "own" on imports           for all using (auth.uid()=user_id);
create policy "read_auth" on weeks       for select using (auth.role()='authenticated');
create policy "read_auth" on competitors for select using (auth.role()='authenticated');

-- Seed: semaines 2026 & 2027
insert into weeks(id,year,week_number,week_start,week_end,month_label,season_type,event_label) values
('2026_w1',2026,1,'2026-06-20','2026-06-26','Juin','basse',null),
('2026_w2',2026,2,'2026-06-27','2026-07-03','Juillet','moyenne',null),
('2026_w3',2026,3,'2026-07-04','2026-07-10','Juillet','moyenne',null),
('2026_w4',2026,4,'2026-07-11','2026-07-17','Juillet','haute','Vac. scolaires zone A'),
('2026_w5',2026,5,'2026-07-18','2026-07-24','Juillet','haute','Vac. scolaires B/C'),
('2026_w6',2026,6,'2026-07-25','2026-07-31','Juillet','haute',null),
('2026_w7',2026,7,'2026-08-01','2026-08-07','Août','haute','Pic été'),
('2026_w8',2026,8,'2026-08-08','2026-08-14','Août','haute',null),
('2026_w9',2026,9,'2026-08-15','2026-08-21','Août','haute','Assomption'),
('2026_w10',2026,10,'2026-08-22','2026-08-28','Août','haute',null),
('2026_w11',2026,11,'2026-08-29','2026-09-04','Août','moyenne','Fin vac. B/C'),
('2026_w12',2026,12,'2026-09-05','2026-09-11','Septembre','basse','Rentrée'),
('2027_w1',2027,1,'2027-06-19','2027-06-25','Juin','basse',null),
('2027_w2',2027,2,'2027-06-26','2027-07-02','Juillet','moyenne',null),
('2027_w3',2027,3,'2027-07-03','2027-07-09','Juillet','moyenne',null),
('2027_w4',2027,4,'2027-07-10','2027-07-16','Juillet','haute','Vac. scolaires zone A'),
('2027_w5',2027,5,'2027-07-17','2027-07-23','Juillet','haute','Vac. scolaires B/C'),
('2027_w6',2027,6,'2027-07-24','2027-07-30','Juillet','haute',null),
('2027_w7',2027,7,'2027-07-31','2027-08-06','Août','haute','Pic été'),
('2027_w8',2027,8,'2027-08-07','2027-08-13','Août','haute',null),
('2027_w9',2027,9,'2027-08-14','2027-08-20','Août','haute','Assomption'),
('2027_w10',2027,10,'2027-08-21','2027-08-27','Août','haute',null),
('2027_w11',2027,11,'2027-08-28','2027-09-03','Août','moyenne','Fin vac.'),
('2027_w12',2027,12,'2027-09-04','2027-09-10','Septembre','basse','Rentrée')
on conflict(id) do nothing;

-- Seed: concurrents
insert into competitors(id,name,property_type,source,standing,has_pool,has_ski_access,comparability_score,url,active) values
('cv','Les Chalets du Verdon','résidence','Vacancéole',4,true,true,88,'https://www.vacanceole.com',true),
('cp','Central Park','résidence','Labellemontagne',3,false,false,82,'https://www.labellemontagne.com',true),
('goe','Goélia La Foux','résidence','Goélia',3,true,true,85,'https://www.goelia.com',true),
('ham','Hôtel du Hameau','hôtel','Booking',3,false,true,55,'https://www.booking.com',true),
('airbnb_lf','Airbnb La Foux','particulier','Airbnb',0,false,false,60,'https://www.airbnb.fr',true),
('bk_lf','Booking La Foux','particulier','Booking',0,false,false,58,'https://www.booking.com',true),
('abr_lf','Abritel La Foux','particulier','Abritel',0,false,false,56,'https://www.abritel.fr',true),
('pap_lf','PAP Vacances','particulier','PAP',0,false,false,48,'https://www.papvacances.fr',true)
on conflict(id) do nothing;