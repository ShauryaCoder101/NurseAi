// Test PostgreSQL Connection
require('dotenv').config();
const {Pool} = require('pg');

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'nurseai',
  user: process.env.DB_USER || 'postgres',
};

// PostgreSQL requires password for SCRAM authentication
// If password is empty, we need to set it to an empty string explicitly
// or the user needs to set it in .env
if (process.env.DB_PASSWORD !== undefined) {
  config.password = process.env.DB_PASSWORD || '';
} else {
  // If not set at all, use empty string (for trust auth if configured)
  config.password = '';
}

console.log('\n📊 Testing PostgreSQL Connection...');
console.log('Configuration:');
console.log(`  Host: ${config.host}`);
console.log(`  Port: ${config.port}`);
console.log(`  Database: ${config.database}`);
console.log(`  User: ${config.user}`);
console.log(`  Password: ${config.password ? '*** (set)' : '(empty - using trust authentication)'}\n`);

const pool = new Pool(config);

pool.query('SELECT version()', (err, res) => {
  if (err) {
    console.error('❌ PostgreSQL Connection Failed!');
    console.error(`Error Code: ${err.code || 'UNKNOWN'}`);
    console.error(`Error Message: ${err.message}\n`);
    
    if (err.code === 'ECONNREFUSED') {
      console.log('💡 PostgreSQL server is not running or not accessible on port 5432');
      console.log('   Make sure PostgreSQL service is running\n');
    } else if (err.code === '28P01') {
      console.log('💡 Authentication failed');
      console.log('   Check DB_USER and DB_PASSWORD in backend/.env file\n');
    } else if (err.code === '3D000') {
      console.log('💡 Database "nurseai" does not exist');
      console.log('   Create it with: CREATE DATABASE nurseai;\n');
    } else if (err.message.includes('password must be a string')) {
      console.log('💡 Password configuration issue');
      console.log('   Set DB_PASSWORD in backend/.env (leave empty if using trust auth)\n');
    }
    
    process.exit(1);
  } else {
    console.log('✅ PostgreSQL Connected Successfully!\n');
    console.log(`Database: ${process.env.DB_NAME}`);
    console.log(`PostgreSQL Version: ${res.rows[0].version.split(',')[0]}\n`);
    
    // Test if database tables exist
    pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'", (err2, res2) => {
      if (err2) {
        console.log('⚠️  Could not check tables:', err2.message);
      } else {
        if (res2.rows.length > 0) {
          console.log('📋 Existing tables:');
          res2.rows.forEach(row => console.log(`   - ${row.table_name}`));
        } else {
          console.log('📋 No tables found (will be created on first server start)');
        }
      }
      pool.end();
      process.exit(0);
    });
  }
});
