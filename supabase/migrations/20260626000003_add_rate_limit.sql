-- ============================================================
-- セキュリティ修正: レート制限
-- 同一メールアドレスから1時間以内に3件以上のINSERTを拒否する
-- ============================================================

-- レート制限チェック関数（SECURITY DEFINER でRLSを迂回してカウント）
CREATE OR REPLACE FUNCTION public.check_insert_rate_limit(p_email text)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT COUNT(*) < 3
  FROM public.document_requests
  WHERE email = p_email
    AND submitted_at > now() - interval '1 hour';
$$;

-- anon INSERT ポリシーをレート制限付きに更新
DROP POLICY IF EXISTS enable_insert_for_anon ON public.document_requests;

CREATE POLICY enable_insert_for_anon
  ON public.document_requests
  FOR INSERT
  TO anon
  WITH CHECK (
    public.check_insert_rate_limit(email)
  );
