-- 管理画面(admin.html)向けの準備
-- 1. 対応状況(status)とupdated_atをdocument_requestsに追加
-- 2. authenticatedロール(=Supabase Authでログインした管理者)にSELECT/UPDATE/DELETEを許可

-- ----------------------------------------------------------------
-- status / updated_at 列の追加
-- ----------------------------------------------------------------
alter table public.document_requests
  add column if not exists status text not null default 'lead',
  add column if not exists updated_at timestamptz not null default now();

alter table public.document_requests
  add constraint document_requests_status_check
  check (status in (
    'lead',         -- リード
    'approach',     -- アプローチ
    'considering',  -- 検討中
    'won',          -- 受注
    'lost',         -- 失注
    'unreachable',  -- 連絡つかず
    'not_target'    -- 営業対象外
  ));

create index if not exists document_requests_status_idx
  on public.document_requests (status);

-- updateされたら updated_at を自動更新
create or replace function public.set_document_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_document_requests_updated_at on public.document_requests;

create trigger trg_document_requests_updated_at
  before update on public.document_requests
  for each row
  execute function public.set_document_requests_updated_at();

-- ----------------------------------------------------------------
-- 管理者(authenticated)向けRLSポリシー
-- 既存の enable_insert_for_anon (anonによるINSERT) はそのまま維持
-- ----------------------------------------------------------------
create policy enable_select_for_authenticated
  on public.document_requests
  for select
  to authenticated
  using (true);

create policy enable_update_for_authenticated
  on public.document_requests
  for update
  to authenticated
  using (true)
  with check (true);

create policy enable_delete_for_authenticated
  on public.document_requests
  for delete
  to authenticated
  using (true);
