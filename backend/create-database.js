// Create PostgreSQL Database
require('dotenv').config();
const {Pool} = require('pg');

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: 'postgres', // Connect to default postgres database first
  user: process.env.DB_USER || 'postgres',
};

if (process.env.DB_PASSWORD && process.env.DB_PASSWORD.trim() !== '') {
  config.password = process.env.DB_PASSWORD;
}

console.log('\n📊 Creating database "nurseai"...\n');

const pool = new Pool(config);

pool.query('CREATE DATABASE nurseai', (err, res) => {
  if (err) {
    if (err.code === '42P04') {
      console.log('✅ Database "nurseai" already exists!\n');
      pool.end();
      process.exit(0);
    } else {
      console.error('❌ Error creating database:', err.message);
      pool.end();
      process.exit(1);
    }
  } else {
    console.log('✅ Database "nurseai" created successfully!\n');
    pool.end();
    process.exit(0);
  }
});
