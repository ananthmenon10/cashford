// Apply a migration file to the project DB via the Supabase Management API.
// Usage: node scripts/apply-migration.mjs supabase/migrations/<file>.sql
// Requires SUPABASE_ACCESS_TOKEN in the environment (.env.local).
import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) { console.error('usage: node scripts/apply-migration.mjs <migration.sql>'); process.exit(1) }
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) { console.error('SUPABASE_ACCESS_TOKEN not set'); process.exit(1) }

const sql = readFileSync(file, 'utf8')
console.log(`applying ${file} (${sql.length} bytes) to fwqgyycqnslafpcetjqo …`)

const res = await fetch('https://api.supabase.com/v1/projects/fwqgyycqnslafpcetjqo/database/query', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
})
const body = await res.text()
if (!res.ok) {
  console.error(`FAILED: HTTP ${res.status}`)
  console.error(body.slice(0, 4000))
  process.exit(1)
}
console.log('OK', body.slice(0, 500))
