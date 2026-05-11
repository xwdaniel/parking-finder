// Test-only side-effect module. Import it FIRST (before any module that reads
// DATABASE_URL at load time — config.ts → db/pool.ts) in tests that need the
// server wired up. It forces the pool at a deliberately-unreachable address so
// `/health`-style tests exercise the "database down" path regardless of any real
// DATABASE_URL in the shell or backend/.env (dotenv won't override an already-set
// var, and this unconditional assignment beats it anyway).
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/parkfree_test';
process.env.PGSSL = 'disable';
process.env.LOG_LEVEL ??= 'silent';

export {};
