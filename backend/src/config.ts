import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  isProd: process.env.NODE_ENV === 'production',

  databaseUrl: required('DATABASE_URL'),
  // 'disable' for a local non-SSL Postgres; anything else (or unset) ⇒ SSL on
  // (Supabase / Neon require it), accepting their managed certs.
  pgSslDisabled: process.env.PGSSL === 'disable',

  // TfL Unified API key — used from Step 10 (journey planning). Optional until then.
  tflAppKey: process.env.TFL_APP_KEY ?? null,

  // Socrata app token — optional; raises the anonymous rate limit on Camden's
  // open-data API (used by the Camden CPZ adapter, step 3).
  socrataAppToken: process.env.SOCRATA_APP_TOKEN ?? null,
} as const;
