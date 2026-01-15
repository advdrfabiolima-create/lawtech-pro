require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

pool.query('SELECT NOW()')
  .then(res => {
    console.log('✅ Conectou no banco:', res.rows[0]);
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ ERRO DE CONEXÃO:', err.message);
    process.exit(1);
  });
