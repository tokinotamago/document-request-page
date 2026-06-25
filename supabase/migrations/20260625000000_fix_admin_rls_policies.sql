-- ============================================================
-- RLSポリシー修正: "authenticated = 管理者" の誤った前提を解消
-- 管理者ユーザーには Supabase Dashboard で
--   Authentication > Users > [対象ユーザー] > Edit > app_metadata
--   に {"role": "admin"} を設定してから適用すること
-- ============================================================

-- ----------------------------------------------------------------
-- document_requests: 既存の過剰なポリシーをすべて削除して再作成
-- ----------------------------------------------------------------
drop policy if exists enable_select_for_authenticated on public.document_requests;
drop policy if exists enable_update_for_authenticated on public.document_requests;
drop policy if exists enable_delete_for_authenticated on public.document_requests;

create policy admin_select on public.document_requests
  for select to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

create policy admin_update on public.document_requests
  for update to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

create policy admin_delete on public.document_requests
  for delete to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- ----------------------------------------------------------------
-- sales_reps: 同じく管理者のみに限定
-- ----------------------------------------------------------------
drop policy if exists enable_select_for_authenticated on public.sales_reps;
drop policy if exists enable_insert_for_authenticated on public.sales_reps;
drop policy if exists enable_delete_for_authenticated on public.sales_reps;

create policy admin_select on public.sales_reps
  for select to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

create policy admin_insert on public.sales_reps
  for insert to authenticated
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

create policy admin_delete on public.sales_reps
  for delete to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );
