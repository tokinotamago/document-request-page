-- sales_reps テーブルに通知先メールアドレス列を追加
ALTER TABLE public.sales_reps
  ADD COLUMN IF NOT EXISTS email text;
