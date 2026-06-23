-- 営業メモ(memo)列を追加
alter table public.document_requests
  add column if not exists memo text;
