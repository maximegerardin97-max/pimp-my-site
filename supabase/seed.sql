-- Create storage bucket for screenshots
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', true)
on conflict (id) do nothing;

-- Create scans table
create table if not exists public.scans (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	url text not null,
	status text not null default 'processing', -- processing | completed | failed
	screenshot_paths text[] default '{}',
	error text
);

-- RLS
alter table public.scans enable row level security;

-- Allow anyone (anon) to insert scans
create policy if not exists "scans_insert_anon"
	on public.scans for insert to anon with check (true);

-- Allow anon to select scans (demo)
create policy if not exists "scans_select_all"
	on public.scans for select to anon using (true);

-- Storage policies for screenshots bucket
create policy if not exists "screenshots_read"
	on storage.objects for select using ( bucket_id = 'screenshots' );

create policy if not exists "screenshots_insert"
	on storage.objects for insert to anon with check ( bucket_id = 'screenshots' );

create policy if not exists "screenshots_update"
	on storage.objects for update to anon using ( bucket_id = 'screenshots' )
	with check ( bucket_id = 'screenshots' );
