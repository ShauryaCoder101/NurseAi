// PostgreSQL Database Configuration
const {Pool} = require('pg');
const dns = require('dns');

// Prefer IPv4 lookups on platforms that support it (Node 18+)
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

let pool;

async function buildDbConfig() {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    let resolvedHost = url.hostname;
    try {
      const ipv4Addresses = await dns.promises.resolve4(url.hostname);
      if (ipv4Addresses && ipv4Addresses.length > 0) {
        resolvedHost = ipv4Addresses[0];
      }
    } catch (err) {
      console.warn(
        '⚠️  No IPv4 address resolved for DB host; using hostname:',
        err.message
      );
    }

    return {
      host: resolvedHost,
      port: parseInt(url.port, 10) || 5432,
      database: url.pathname.replace('/', '') || 'postgres',
      user: decodeURIComponent(url.username || ''),
      password: decodeURIComponent(url.password || ''),
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      ssl: {
        rejectUnauthorized: false,
      },
    };
  }

  const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'nurseai',
  user: process.env.DB_USER || 'postgres',
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  };

  // Only add password if it's explicitly set (not empty string)
  // If DB_PASSWORD is not set or empty, PostgreSQL will use trust/md5 auth if configured
  if (process.env.DB_PASSWORD !== undefined && process.env.DB_PASSWORD !== '') {
    config.password = process.env.DB_PASSWORD;
  }

  return config;
}

const poolReady = (async () => {
  const dbConfig = await buildDbConfig();
  pool = new Pool(dbConfig);

// Test connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});
})();

// Function to generate 16-digit UID
function generateUID() {
  // Generate 16-digit numeric UID
  return Math.floor(1000000000000000 + Math.random() * 9000000000000000).toString();
}

// Initialize database tables
async function initializeDatabase() {
  await poolReady;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Users table with 16-digit UID
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        uid VARCHAR(16) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone_number VARCHAR(20) NOT NULL,
        password VARCHAR(255) NOT NULL,
        is_verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // OTP table
    await client.query(`
      CREATE TABLE IF NOT EXISTS otps (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        otp VARCHAR(6) NOT NULL,
        purpose VARCHAR(20) DEFAULT 'verify',
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'otps' AND column_name = 'purpose'
        ) THEN
          ALTER TABLE otps ADD COLUMN purpose VARCHAR(20) DEFAULT 'verify';
        END IF;
      END $$;
    `);

    await client.query(`
      UPDATE otps SET purpose = 'verify' WHERE purpose IS NULL;
    `);

    // Transcripts table - linked to user UID
    await client.query(`
      CREATE TABLE IF NOT EXISTS transcripts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_uid VARCHAR(16) NOT NULL,
        title VARCHAR(255),
        content TEXT NOT NULL,
        patient_name VARCHAR(255),
        patient_id VARCHAR(255),
        source VARCHAR(50) DEFAULT 'manual',
        audio_record_id UUID,
        suggestion_completed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `);

    // Add patient_id column if it doesn't exist (for existing databases)
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'transcripts' AND column_name = 'patient_id'
        ) THEN
          ALTER TABLE transcripts ADD COLUMN patient_id VARCHAR(255);
        END IF;
      END $$;
    `);

    // Patient tasks table - linked to user UID
    await client.query(`
      CREATE TABLE IF NOT EXISTS patient_tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_uid VARCHAR(16) NOT NULL,
        patient_name VARCHAR(255) NOT NULL,
        patient_id VARCHAR(255),
        task_description VARCHAR(255) NOT NULL,
        scheduled_time VARCHAR(50) NOT NULL,
        emergency_level VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `);

    // Add patient_id column if it doesn't exist (for existing databases)
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'patient_tasks' AND column_name = 'patient_id'
        ) THEN
          ALTER TABLE patient_tasks ADD COLUMN patient_id VARCHAR(255);
        END IF;
      END $$;
    `);

    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'transcripts' AND column_name = 'source'
        ) THEN
          ALTER TABLE transcripts ADD COLUMN source VARCHAR(50) DEFAULT 'manual';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'transcripts' AND column_name = 'audio_record_id'
        ) THEN
          ALTER TABLE transcripts ADD COLUMN audio_record_id UUID;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'transcripts' AND column_name = 'suggestion_completed'
        ) THEN
          ALTER TABLE transcripts ADD COLUMN suggestion_completed BOOLEAN DEFAULT FALSE;
        END IF;
      END $$;
    `);

    // Audio recordings table - linked to user UID
    await client.query(`
      CREATE TABLE IF NOT EXISTS audio_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_uid VARCHAR(16) NOT NULL,
        patient_name VARCHAR(255),
        patient_id VARCHAR(255),
        file_path TEXT NOT NULL,
        file_name VARCHAR(255),
        file_size BIGINT,
        mime_type VARCHAR(100),
        photo_path TEXT,
        photo_name VARCHAR(255),
        photo_size BIGINT,
        photo_mime VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `);

    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_uid ON users(uid)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_otps_email ON otps(email)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_otps_email_purpose ON otps(email, purpose)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_transcripts_user_uid ON transcripts(user_uid)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_patient_tasks_user_uid ON patient_tasks(user_uid)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audio_records_user_uid ON audio_records(user_uid)
    `);

    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'audio_records' AND column_name = 'photo_path'
        ) THEN
          ALTER TABLE audio_records ADD COLUMN photo_path TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'audio_records' AND column_name = 'photo_name'
        ) THEN
          ALTER TABLE audio_records ADD COLUMN photo_name VARCHAR(255);
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'audio_records' AND column_name = 'photo_size'
        ) THEN
          ALTER TABLE audio_records ADD COLUMN photo_size BIGINT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'audio_records' AND column_name = 'photo_mime'
        ) THEN
          ALTER TABLE audio_records ADD COLUMN photo_mime VARCHAR(100);
        END IF;
      END $$;
    `);

    await client.query('COMMIT');
    console.log('Database tables initialized');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error initializing database:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Initialize on module load
initializeDatabase().catch((err) => {
  console.error('Failed to initialize database:', err);
});

// Database helper functions
const dbHelpers = {
  // Run query (INSERT, UPDATE, DELETE)
  run: async (sql, params = []) => {
    await poolReady;
    const client = await pool.connect();
    try {
      const result = await client.query(sql, params);
      return {
        lastID: result.rows[0]?.id || null,
        changes: result.rowCount || 0,
      };
    } catch (err) {
      throw err;
    } finally {
      client.release();
    }
  },

  // Get single row
  get: async (sql, params = []) => {
    await poolReady;
    const client = await pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows[0] || null;
    } catch (err) {
      throw err;
    } finally {
      client.release();
    }
  },

  // Get all rows
  all: async (sql, params = []) => {
    await poolReady;
    const client = await pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows || [];
    } catch (err) {
      throw err;
    } finally {
      client.release();
    }
  },

  // Execute query (for transactions)
  query: async (sql, params = []) => {
    await poolReady;
    const client = await pool.connect();
    try {
      const result = await client.query(sql, params);
      return result;
    } catch (err) {
      throw err;
    } finally {
      client.release();
    }
  },

  // Get a client for transactions
  getClient: async () => {
    await poolReady;
    return await pool.connect();
  },
};

// Graceful shutdown
process.on('SIGINT', async () => {
  await poolReady;
  await pool.end();
  console.log('Database pool closed');
  process.exit(0);
});

module.exports = {pool, dbHelpers, generateUID};
