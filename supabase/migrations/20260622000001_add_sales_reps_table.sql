-- 営業担当者マスターテーブル
create table if not exists public.sales_reps (
  id         uuid        default gen_random_uuid() primary key,
  name       text        not null unique,
  created_at timestamptz default now() not null
);

alter table public.sales_reps enable row level security;

create policy enable_select_for_authenticated
  on public.sales_reps for select to authenticated using (true);

create policy enable_insert_for_authenticated
  on public.sales_reps for insert to authenticated with check (true);

create policy enable_delete_for_authenticated
  on public.sales_reps for delete to authenticated using (true);

-- 既存の document_requests に入っている sales_rep 値を移行（重複スキップ）
insert into public.sales_reps (name)
select distinct sales_rep
from   public.document_requests
where  sales_rep is not null
on conflict (name) do nothing;
