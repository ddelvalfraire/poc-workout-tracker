import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { requireEnv } from '@/lib/env'
import * as schema from './schema'

// prepare:false is REQUIRED on the Supabase transaction pooler (port 6543).
const createClient = () => postgres(requireEnv('DATABASE_URL'), { prepare: false })

// Reuse the connection across dev HMR reloads so we don't exhaust the pool.
const globalForDb = globalThis as unknown as { dbClient?: ReturnType<typeof createClient> }
const client = globalForDb.dbClient ?? createClient()
if (process.env.NODE_ENV !== 'production') globalForDb.dbClient = client

export const db = drizzle({ client, schema })
