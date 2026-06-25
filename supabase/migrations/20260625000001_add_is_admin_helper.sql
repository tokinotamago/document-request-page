-- ============================================================
-- is_admin() ヘルパー関数
-- RLSポリシー内で繰り返し使われる JWT チェック式を一箇所に集約する
-- ============================================================
create or replace function public.is_admin()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
$$;

-- 既存ポリシーを is_admin() を使う形に置き換える
-- ----------------------------------------------------------------
-- document_requests
-- ----------------------------------------------------------------
drop policy if exists admin_select on public.document_requests;
drop policy if exists admin_update on public.document_requests;
drop policy if exists admin_delete on public.document_requests;

create policy admin_select on public.document_requests
  for select to authenticated
  using (public.is_admin());

create policy admin_update on public.document_requests
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy admin_delete on public.document_requests
  for delete to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------
-- sales_reps
-- ----------------------------------------------------------------
drop policy if exists admin_select on public.sales_reps;
drop policy if exists admin_insert on public.sales_reps;
drop policy if exists admin_delete on public.sales_reps;

create policy admin_select on public.sales_reps
  for select to authenticated
  using (public.is_admin());

create policy admin_insert on public.sales_reps
  for insert to authenticated
  with check (public.is_admin());

create policy admin_delete on public.sales_reps
  for delete to authenticated
  using (public.is_admin());
