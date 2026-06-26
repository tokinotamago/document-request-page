-- レート制限を 3件/時 → 10件/時 に緩和
CREATE OR REPLACE FUNCTION public.check_insert_rate_limit(p_email text)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT COUNT(*) < 10
  FROM public.document_requests
  WHERE email = p_email
    AND submitted_at > now() - interval '1 hour';
$$;
