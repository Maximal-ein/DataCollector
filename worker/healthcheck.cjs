// Healthcheck воркера (docker-compose): проверяет доступность PostgreSQL
// из контейнера. Обычный CJS-файл — не входит в TypeScript-сборку.
const { Client } = require('pg')

if (!process.env.DATABASE_URL) {
  process.exit(1)
}

const client = new Client({ connectionString: process.env.DATABASE_URL })
client
  .connect()
  .then(() => client.end())
  .then(() => process.exit(0))
  .catch(() => process.exit(1))
