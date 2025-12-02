import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DO_DB_HOST,
  port: parseInt(process.env.DO_DB_PORT || '25060'),
  user: process.env.DO_DB_USER,
  password: process.env.DO_DB_PASSWORD,
  database: process.env.DO_DB_NAME,
  // SSL configuration - required for DigitalOcean managed databases
  ssl: process.env.DO_DB_SSL === 'false' ? false : {
    rejectUnauthorized: false,
  },
  max: 10,
  idleTimeoutMillis: 30000,
});

// Helper to execute read-only queries
export const doQuery = async (text: string, params: any[] = []) => {
  const client = await pool.connect();
  try {
    // Basic safety check - though the user should be read-only at DB level ideally
    if (!text.trim().toLowerCase().startsWith('select')) {
      throw new Error('Only SELECT queries are allowed on the DigitalOcean database.');
    }
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
};

export default pool;
