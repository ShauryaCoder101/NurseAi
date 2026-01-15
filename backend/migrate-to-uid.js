// Migration script to drop old tables and recreate with UID structure
// Run this once to migrate from UUID to 16-digit UID
require('dotenv').config();
const {pool} = require('./src/config/database');

async function migrateDatabase() {
  const client = await pool.connect();
  try {
    console.log('🔄 Starting database migration to UID structure...\n');
    
    await client.query('BEGIN');

    // Drop existing tables (this will delete all data!)
    console.log('⚠️  Dropping existing tables...');
    await client.query('DROP TABLE IF EXISTS patient_tasks CASCADE');
    await client.query('DROP TABLE IF EXISTS transcripts CASCADE');
    await client.query('DROP TABLE IF EXISTS otps CASCADE');
    await client.query('DROP TABLE IF EXISTS users CASCADE');
    console.log('✅ Old tables dropped\n');

    // Recreate tables with new UID structure
    console.log('📋 Creating new tables with UID structure...');
    
    // Users table with 16-digit UID
    await client.query(`
      CREATE TABLE users (
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
      CREATE TABLE otps (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        otp VARCHAR(6) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Transcripts table - linked to user UID
    await client.query(`
      CREATE TABLE transcripts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_uid VARCHAR(16) NOT NULL,
        title VARCHAR(255),
        content TEXT NOT NULL,
        patient_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `);

    // Patient tasks table - linked to user UID
    await client.query(`
      CREATE TABLE patient_tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_uid VARCHAR(16) NOT NULL,
        patient_name VARCHAR(255) NOT NULL,
        task_description VARCHAR(255) NOT NULL,
        scheduled_time VARCHAR(50) NOT NULL,
        emergency_level VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `);

    // Create indexes
    await client.query('CREATE INDEX idx_users_email ON users(email)');
    await client.query('CREATE INDEX idx_users_uid ON users(uid)');
    await client.query('CREATE INDEX idx_otps_email ON otps(email)');
    await client.query('CREATE INDEX idx_transcripts_user_uid ON transcripts(user_uid)');
    await client.query('CREATE INDEX idx_patient_tasks_user_uid ON patient_tasks(user_uid)');

    await client.query('COMMIT');
    console.log('✅ Database migration completed successfully!\n');
    console.log('📊 New structure:');
    console.log('   - users table: uid (16-digit), email, phone_number, password');
    console.log('   - transcripts table: linked via user_uid');
    console.log('   - patient_tasks table: linked via user_uid\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

migrateDatabase()
  .then(() => {
    console.log('✅ Migration script completed');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Migration script failed:', err);
    process.exit(1);
  });
