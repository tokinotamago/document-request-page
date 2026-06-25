-- ============================================================
-- Database Webhook 代替実装:
-- document_requests への INSERT 時に notify-email Edge Function を呼び出す
--
-- pg_net 拡張（Supabase デフォルト有効）の net.http_post() を使い、
-- Dashboard の「Database Webhooks」UI と同等の動作を SQL で実現する。
--
-- ★ このファイルを適用する前に、Supabase SQL Editor で以下を1回だけ実行すること:
--
--   ALTER DATABASE postgres
--     SET app.webhook_secret TO '← WEBHOOK_SECRET の値をここに貼る';
--
--   実行後はページをリロードするか、接続し直すこと（設定が反映される）。
--   この ALTER 文はソースコードに含めないこと（シークレットがリポジトリに漏れるため）。
-- ============================================================

-- ----------------------------------------------------------------
-- トリガー関数: INSERT 発生時に Edge Function へ POST する
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_document_request_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _secret text := current_setting('app.webhook_secret', true);
BEGIN
  -- シークレット未設定の場合はスキップ（INSERT 自体は成功させる）
  IF _secret IS NULL OR _secret = '' THEN
    RAISE WARNING '[notify-email] app.webhook_secret が未設定のため通知をスキップしました';
    RETURN NEW;
  END IF;

  -- pg_net 経由で非同期 POST（INSERT のコミット後に実行される）
  PERFORM net.http_post(
    url     := 'https://wgxggqckupviquasiket.supabase.co/functions/v1/notify-email',
    body    := jsonb_build_object(
                 'type',       TG_OP,
                 'table',      TG_TABLE_NAME,
                 'schema',     TG_TABLE_SCHEMA,
                 'record',     to_jsonb(NEW),
                 'old_record', NULL
               )::text,
    headers := jsonb_build_object(
                 'Content-Type',     'application/json',
                 'x-webhook-secret', _secret
               )
  );

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------
-- トリガー: document_requests への INSERT 後に上記関数を実行
-- ----------------------------------------------------------------
DROP TRIGGER IF EXISTS on_document_request_insert ON public.document_requests;

CREATE TRIGGER on_document_request_insert
  AFTER INSERT ON public.document_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_document_request_insert();
