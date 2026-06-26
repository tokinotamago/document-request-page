-- ============================================================
-- セキュリティ修正: submitted_at をサーバー側で強制設定
-- クライアントから任意の日時を注入できる脆弱性を塞ぐ
-- ============================================================

-- BEFORE INSERT トリガーで submitted_at を常に now() で上書き
-- クライアントが何を送っても無効化される
CREATE OR REPLACE FUNCTION public.force_submitted_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  NEW.submitted_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_force_submitted_at ON public.document_requests;

CREATE TRIGGER trg_force_submitted_at
  BEFORE INSERT ON public.document_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.force_submitted_at();

-- DEFAULT も念のため設定
ALTER TABLE public.document_requests
  ALTER COLUMN submitted_at SET DEFAULT now();
