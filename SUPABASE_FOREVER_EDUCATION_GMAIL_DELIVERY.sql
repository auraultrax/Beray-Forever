-- Gmail OTP delivery metadata for Forever Education.
-- The verification code itself is never stored in plaintext; code_hmac remains the verifier.
alter table public.education_email_challenges
  add column if not exists sent_at timestamptz,
  add column if not exists sender_email text,
  add column if not exists mail_provider text,
  add column if not exists provider_message_id text;

comment on column public.education_email_challenges.code_hmac is
  'HMAC-SHA-256 verification digest; plaintext OTP is intentionally never persisted.';
comment on column public.education_email_challenges.sent_at is
  'Timestamp when the provider accepted the OTP email for sending.';
comment on column public.education_email_challenges.provider_message_id is
  'Delivery provider message identifier; does not contain the OTP.';
