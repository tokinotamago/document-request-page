-- 営業担当者(sales_rep)列を追加
alter table public.document_requests
  add column if not exists sales_rep text;
