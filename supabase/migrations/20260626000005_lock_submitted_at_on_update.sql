-- ============================================================
-- セキュリティ修正: submitted_at を UPDATE で変更不可にする
--
-- force_submitted_at トリガーは BEFORE INSERT のみのため、
-- 管理者 JWT で直接 REST API を叩けば submitted_at を任意の値に
-- 書き換えられる（KPI 改ざん）。BEFORE UPDATE トリガーで封鎖する。
-- ============================================================

CREATE OR REPLACE FUNCTION public.lock_submitted_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  NEW.submitted_at := OLD.submitted_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lock_submitted_at_on_update ON public.document_requests;
CREATE TRIGGER lock_submitted_at_on_update
  BEFORE UPDATE ON public.document_requests
  FOR EACH ROW EXECUTE FUNCTION public.lock_submitted_at();
