const { Pool } = require('pg');
require('dotenv').config();

// Si existe DATABASE_URL (Railway / Heroku / producción) lo preferimos.
// Si no, usamos las variables individuales (entorno local).
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      // Railway usa red interna (.railway.internal) sin SSL.
      // Conexiones externas a Postgres en la nube sí requieren SSL.
      ssl: process.env.DATABASE_URL.includes('.railway.internal')
        ? false
        : { rejectUnauthorized: false }
    }
  : {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    };

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Error en el pool de conexión:', err);
});

const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Query ejecutada:', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Error en la query:', error);
    throw error;
  }
};

module.exports = {
  query,
  pool
};
