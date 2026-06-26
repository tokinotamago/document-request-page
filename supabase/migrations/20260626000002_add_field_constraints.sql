-- ============================================================
-- セキュリティ修正: フィールド値・長さの制約をDBレベルで追加
-- クライアントバリデーション迂回・ストレージ圧迫攻撃を防ぐ
-- NOT VALID: 既存レコードはスキップし、新規INSERTのみに適用
-- ============================================================

-- source の許可値制限
ALTER TABLE public.document_requests
  DROP CONSTRAINT IF EXISTS check_source;
ALTER TABLE public.document_requests
  ADD CONSTRAINT check_source
    CHECK (source IN ('exhibition_2025', 'exhibition_2026'))
    NOT VALID;

-- exhibit_periods: 許可された値の配列のみ受け付ける
ALTER TABLE public.document_requests
  DROP CONSTRAINT IF EXISTS check_exhibit_periods;
ALTER TABLE public.document_requests
  ADD CONSTRAINT check_exhibit_periods
    CHECK (
      exhibit_periods IS NULL OR
      exhibit_periods <@ ARRAY['2026_autumn','2027_spring','undecided']::text[]
    )
    NOT VALID;

-- exhibit_areas: 許可された値の配列のみ受け付ける
ALTER TABLE public.document_requests
  DROP CONSTRAINT IF EXISTS check_exhibit_areas;
ALTER TABLE public.document_requests
  ADD CONSTRAINT check_exhibit_areas
    CHECK (
      exhibit_areas IS NULL OR
      exhibit_areas <@ ARRAY[
        'food_supplement','organic_natural','beauty_wellness',
        'body_mind_recovery','health_beauty_factory','age_tech_lab','undecided'
      ]::text[]
    )
    NOT VALID;

-- フィールド長制限
ALTER TABLE public.document_requests
  DROP CONSTRAINT IF EXISTS check_company_name_len,
  DROP CONSTRAINT IF EXISTS check_last_name_len,
  DROP CONSTRAINT IF EXISTS check_first_name_len,
  DROP CONSTRAINT IF EXISTS check_last_name_kana_len,
  DROP CONSTRAINT IF EXISTS check_first_name_kana_len,
  DROP CONSTRAINT IF EXISTS check_department_len,
  DROP CONSTRAINT IF EXISTS check_job_title_len,
  DROP CONSTRAINT IF EXISTS check_email_len,
  DROP CONSTRAINT IF EXISTS check_phone_len,
  DROP CONSTRAINT IF EXISTS check_exhibit_products_len,
  DROP CONSTRAINT IF EXISTS check_target_industry_len,
  DROP CONSTRAINT IF EXISTS check_other_shows_len,
  DROP CONSTRAINT IF EXISTS check_online_meeting_len,
  DROP CONSTRAINT IF EXISTS check_other_notes_len,
  DROP CONSTRAINT IF EXISTS check_website_len;

ALTER TABLE public.document_requests
  ADD CONSTRAINT check_company_name_len      CHECK (length(company_name)      <= 200) NOT VALID,
  ADD CONSTRAINT check_last_name_len         CHECK (length(last_name)          <= 100) NOT VALID,
  ADD CONSTRAINT check_first_name_len        CHECK (length(first_name)         <= 100) NOT VALID,
  ADD CONSTRAINT check_last_name_kana_len    CHECK (length(last_name_kana)     <= 100) NOT VALID,
  ADD CONSTRAINT check_first_name_kana_len   CHECK (length(first_name_kana)    <= 100) NOT VALID,
  ADD CONSTRAINT check_department_len        CHECK (length(department)         <= 200) NOT VALID,
  ADD CONSTRAINT check_job_title_len         CHECK (length(job_title)          <= 100) NOT VALID,
  ADD CONSTRAINT check_email_len             CHECK (length(email)              <= 254) NOT VALID,
  ADD CONSTRAINT check_phone_len             CHECK (length(phone)              <=  30) NOT VALID,
  ADD CONSTRAINT check_exhibit_products_len  CHECK (length(exhibit_products)   <= 500) NOT VALID,
  ADD CONSTRAINT check_target_industry_len   CHECK (length(target_industry)    <= 500) NOT VALID,
  ADD CONSTRAINT check_other_shows_len       CHECK (length(other_shows)        <= 500) NOT VALID,
  ADD CONSTRAINT check_online_meeting_len    CHECK (length(online_meeting)     <= 2000) NOT VALID,
  ADD CONSTRAINT check_other_notes_len       CHECK (length(other_notes)        <= 5000) NOT VALID,
  ADD CONSTRAINT check_website_len           CHECK (length(website)            <= 500) NOT VALID;
