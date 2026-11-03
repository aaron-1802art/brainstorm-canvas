-- ============================================================
-- Brainstorm Canvas — Database Migration (Phase 3 Collaboration)
-- Run this script in the Supabase SQL Editor (Dashboard → SQL Editor)
-- Fully Idempotent & Production-Hardened (Safe to re-run).
-- ============================================================

-- 0. Ensure UUID generation extensions
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. Profiles Table (Mirrors auth.users)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text not null default '',
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(nullif(excluded.display_name, ''), public.profiles.display_name),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 2. Boards Table
-- ------------------------------------------------------------
create table if not exists public.boards (
  id         uuid primary key default gen_random_uuid(),
  title      text not null default 'Untitled board',
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_boards_owner on public.boards(owner_id);

-- ------------------------------------------------------------
-- 3. Board Roles Enum
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'board_role') then
    create type board_role as enum ('owner', 'editor', 'viewer');
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. Board Members Table
-- ------------------------------------------------------------
create table if not exists public.board_members (
  id        uuid primary key default gen_random_uuid(),
  board_id  uuid not null references public.boards(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      board_role not null default 'editor',
  joined_at timestamptz not null default now(),
  unique(board_id, user_id)
);

create index if not exists idx_bm_board on public.board_members(board_id);
create index if not exists idx_bm_user  on public.board_members(user_id);

-- Auto-add board owner as board_member with 'owner' role
create or replace function public.handle_new_board()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.board_members (board_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (board_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

drop trigger if exists on_board_created on public.boards;
create trigger on_board_created
  after insert on public.boards
  for each row execute function public.handle_new_board();

-- ------------------------------------------------------------
-- 5. Board Snapshots (Versioned board document)
-- ------------------------------------------------------------
create table if not exists public.board_snapshots (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards(id) on delete cascade,
  document   jsonb not null default '{}'::jsonb,
  version    integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  unique(board_id, version)
);

create index if not exists idx_snap_board on public.board_snapshots(board_id, version desc);

-- ------------------------------------------------------------
-- 6. Board Invites (Email-based invitations)
-- ------------------------------------------------------------
create table if not exists public.board_invites (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards(id) on delete cascade,
  email      text not null,
  role       board_role not null default 'editor',
  invited_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(board_id, email)
);

create index if not exists idx_invites_board on public.board_invites(board_id);
create index if not exists idx_invites_email on public.board_invites(lower(email));

-- Auto-accept invites when user profile is created
create or replace function public.accept_pending_invites()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.board_members (board_id, user_id, role)
  select i.board_id, new.id, i.role
  from public.board_invites i
  where lower(i.email) = lower(new.email)
  on conflict (board_id, user_id) do update set role = excluded.role;

  delete from public.board_invites where lower(email) = lower(new.email);
  return new;
end;
$$;

drop trigger if exists on_profile_created_accept_invites on public.profiles;
create trigger on_profile_created_accept_invites
  after insert on public.profiles
  for each row execute function public.accept_pending_invites();

-- ------------------------------------------------------------
-- 7. Timestamp Update Triggers
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists boards_updated_at on public.boards;
create trigger boards_updated_at
  before update on public.boards
  for each row execute function public.set_updated_at();

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ============================================================
-- Security Definer RLS Helper Functions
-- (Prevents infinite recursion in RLS and search-path injection)
-- ============================================================

create or replace function public.can_access_board(b_id uuid)
returns boolean language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.boards b
    where b.id = b_id and (
      b.owner_id = auth.uid() or
      exists (
        select 1 from public.board_members bm
        where bm.board_id = b_id and bm.user_id = auth.uid()
      )
    )
  );
$$;

create or replace function public.can_edit_board(b_id uuid)
returns boolean language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.boards b
    where b.id = b_id and (
      b.owner_id = auth.uid() or
      exists (
        select 1 from public.board_members bm
        where bm.board_id = b_id and bm.user_id = auth.uid() and bm.role in ('owner', 'editor')
      )
    )
  );
$$;

create or replace function public.is_board_owner(b_id uuid)
returns boolean language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.boards b
    where b.id = b_id and b.owner_id = auth.uid()
  );
$$;

-- ============================================================
-- Row Level Security (RLS) Configuration
-- ============================================================

alter table public.profiles        enable row level security;
alter table public.boards          enable row level security;
alter table public.board_members   enable row level security;
alter table public.board_snapshots enable row level security;
alter table public.board_invites   enable row level security;

-- ------------------------------------------------------------
-- Profiles Policies
-- ------------------------------------------------------------
drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
drop policy if exists "Profiles are viewable by everyone" on public.profiles;
create policy "Profiles are viewable by authenticated users"
  on public.profiles for select using (auth.role() = 'authenticated');

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

-- ------------------------------------------------------------
-- Boards Policies
-- ------------------------------------------------------------
drop policy if exists "Board members can view boards" on public.boards;
create policy "Board members can view boards"
  on public.boards for select using (
    owner_id = auth.uid() or public.can_access_board(id)
  );

drop policy if exists "Authenticated users can create boards" on public.boards;
create policy "Authenticated users can create boards"
  on public.boards for insert with check (auth.uid() = owner_id);

-- Owners can update any board field; editors can update title without stealing ownership
drop policy if exists "Board owners can update boards" on public.boards;
drop policy if exists "Owners and editors can update boards" on public.boards;
create policy "Owners and editors can update boards"
  on public.boards for update
  using (public.can_edit_board(id))
  with check (
    public.can_edit_board(id) and
    (
      case
        when public.is_board_owner(id) then true
        else owner_id = (select b.owner_id from public.boards b where b.id = id)
      end
    )
  );

drop policy if exists "Board owners can delete boards" on public.boards;
create policy "Board owners can delete boards"
  on public.boards for delete using (owner_id = auth.uid());

-- ------------------------------------------------------------
-- Board Members Policies
-- ------------------------------------------------------------
drop policy if exists "Members can view board members" on public.board_members;
create policy "Members can view board members"
  on public.board_members for select using (
    user_id = auth.uid() or public.can_access_board(board_id)
  );

drop policy if exists "Board owners can add members" on public.board_members;
create policy "Board owners can add members"
  on public.board_members for insert with check (
    public.is_board_owner(board_id)
  );

drop policy if exists "Board owners can update members" on public.board_members;
create policy "Board owners can update members"
  on public.board_members for update using (
    public.is_board_owner(board_id)
  );

-- Owner can remove members; non-owners can remove themselves (leave board)
drop policy if exists "Board owners or self can remove members" on public.board_members;
create policy "Board owners or self can remove members"
  on public.board_members for delete using (
    public.is_board_owner(board_id) or (user_id = auth.uid() and not public.is_board_owner(board_id))
  );

-- ------------------------------------------------------------
-- Board Snapshots Policies
-- ------------------------------------------------------------
drop policy if exists "Board members can view snapshots" on public.board_snapshots;
create policy "Board members can view snapshots"
  on public.board_snapshots for select using (
    public.can_access_board(board_id)
  );

drop policy if exists "Editors can insert snapshots" on public.board_snapshots;
create policy "Editors can insert snapshots"
  on public.board_snapshots for insert with check (
    public.can_edit_board(board_id)
  );

drop policy if exists "Editors can update snapshots" on public.board_snapshots;
create policy "Editors can update snapshots"
  on public.board_snapshots for update using (
    public.can_edit_board(board_id)
  );

-- ------------------------------------------------------------
-- Board Invites Policies
-- ------------------------------------------------------------
drop policy if exists "Board members and invitees can view invites" on public.board_invites;
create policy "Board members and invitees can view invites"
  on public.board_invites for select using (
    public.can_access_board(board_id) or lower(email) = lower(auth.jwt() ->> 'email')
  );

-- Board owners and editors can invite collaborators (editors cannot invite owners)
drop policy if exists "Board owners can create invites" on public.board_invites;
drop policy if exists "Board owners and editors can create invites" on public.board_invites;
create policy "Board owners and editors can create invites"
  on public.board_invites for insert with check (
    public.can_edit_board(board_id) and
    auth.uid() = invited_by and
    (
      case
        when role = 'owner' then public.is_board_owner(board_id)
        else true
      end
    )
  );

drop policy if exists "Board owners can delete invites" on public.board_invites;
drop policy if exists "Board owners or inviter can delete invites" on public.board_invites;
create policy "Board owners or inviter can delete invites"
  on public.board_invites for delete using (
    public.is_board_owner(board_id) or invited_by = auth.uid()
  );

-- ============================================================
-- Enable Realtime for board_snapshots and board_members (CDC)
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_snapshots'
  ) then
    alter publication supabase_realtime add table public.board_snapshots;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_members'
  ) then
    alter publication supabase_realtime add table public.board_members;
  end if;
end $$;
