const { Pool, types } = require('pg');
require('dotenv').config();

// Forçar pg a retornar TIMESTAMP como string raw (sem interpretar com TZ local)
// Isso evita o problema de +3h quando TZ=America/Bahia no servidor
types.setTypeParser(1114, (val) => val + 'Z'); // TIMESTAMP WITHOUT TIMEZONE → adiciona Z (UTC)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Necessário para conexões seguras com o Neon
  }
});

module.exports = pool;