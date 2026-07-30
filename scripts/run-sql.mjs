// Run a SQL statement against the project DB via the Supabase Management API.
// Usage: node scripts/run-sql.mjs "select 1"
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) { console.error('SUPABASE_ACCESS_TOKEN not set'); process.exit(1) }
const res = await fetch('https://api.supabase.com/v1/projects/fwqgyycqnslafpcetjqo/database/query', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: process.argv[2] }),
})
const body = await res.text()
if (!res.ok) { console.error(`HTTP ${res.status}`, body.slice(0, 2000)); process.exit(1) }
console.log(body.slice(0, 3000))
