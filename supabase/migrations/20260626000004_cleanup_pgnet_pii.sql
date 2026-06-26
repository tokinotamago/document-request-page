-- ============================================================
-- セキュリティ修正: pg_net 内部テーブルの PII 定期削除
--
-- net.http_post() はリクエスト/レスポンスを net._http_response に保存する。
-- 顧客の氏名・メール・電話・住所が含まれるため、7日後に自動削除する。
-- ============================================================

-- pg_cron 拡張を有効化（Supabase ではデフォルト利用可能）
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 既存の同名ジョブがあれば削除してから登録
SELECT cron.unschedule('cleanup-pgnet-http-responses')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'cleanup-pgnet-http-responses'
  );

-- 毎日午前3時（UTC）に 7日以上経過したエントリを削除
SELECT cron.schedule(
  'cleanup-pgnet-http-responses',
  '0 3 * * *',
  $$
    DELETE FROM net._http_response
    WHERE created < now() - interval '7 days';
  $$
);
