-- CHARA LAB / character2 dedicated tables inside the existing shorts Supabase project.
-- Existing baekji_*, ungeol_*, character_ai_* tables are not touched.
create extension if not exists pgcrypto;

create table if not exists public.character2_characters (
  id uuid primary key default gen_random_uuid(),
  share_code varchar(8) not null unique check (share_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  name text not null,
  status text not null default 'ready',
  schema_version text not null default 'character-passport/1.0',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.character2_passports (
  character_id uuid primary key references public.character2_characters(id) on delete cascade,
  passport_json jsonb not null,
  analysis_confidence numeric not null default 0,
  engine_versions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.character2_answers (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.character2_characters(id) on delete cascade,
  question_order integer not null check (question_order between 1 and 20),
  question_text text not null,
  answer_json jsonb not null,
  branch_context jsonb not null default '{}'::jsonb,
  question_engine_version text not null default 'interview/1.0',
  created_at timestamptz not null default now(),
  unique(character_id, question_order)
);

create table if not exists public.character2_access (
  character_id uuid primary key references public.character2_characters(id) on delete cascade,
  edit_token_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.character2_app_settings (
  id integer primary key check (id = 1),
  postype_url text not null default '',
  ai_access_code_hash text not null default '320b77859300260cb195f00c39de7212a7d859c61eb90cdd627c061f97923a7e',
  admin_secret_hash text not null default '',
  code_version integer not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.character2_app_settings(id) values (1) on conflict (id) do nothing;

create table if not exists public.character2_rate_limit_events (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  action text not null,
  created_at timestamptz not null default now()
);
create index if not exists character2_rate_limit_events_lookup on public.character2_rate_limit_events(ip_hash, action, created_at desc);

alter table public.character2_characters enable row level security;
alter table public.character2_passports enable row level security;
alter table public.character2_answers enable row level security;
alter table public.character2_access enable row level security;
alter table public.character2_app_settings enable row level security;
alter table public.character2_rate_limit_events enable row level security;

revoke all on table public.character2_characters from anon, authenticated;
revoke all on table public.character2_passports from anon, authenticated;
revoke all on table public.character2_answers from anon, authenticated;
revoke all on table public.character2_access from anon, authenticated;
revoke all on table public.character2_app_settings from anon, authenticated;
revoke all on table public.character2_rate_limit_events from anon, authenticated;
