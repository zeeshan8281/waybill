// Loads .env into process.env if the file exists (Node ≥20.12 built-in — no
// dependency). Import this FIRST so config is present before any module reads
// process.env at load time. On EigenCompute, env comes from sealed secrets.
try {
  process.loadEnvFile();
} catch {
  /* no .env file — fine */
}
