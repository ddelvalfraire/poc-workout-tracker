import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'
import { requireEnv } from './src/lib/env' // relative: drizzle-kit does not resolve the @/ alias

config({ path: '.env.local' }) // drizzle-kit does NOT read .env.local by default

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    // 5432 direct/session pooler for DDL — NOT the 6543 transaction pooler
    url: requireEnv('DATABASE_URL_DIRECT'),
  },
})
