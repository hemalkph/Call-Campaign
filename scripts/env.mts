// Loads .env.local for command-line scripts (Next.js does this itself for the app).
try {
  process.loadEnvFile(".env.local");
} catch {}
