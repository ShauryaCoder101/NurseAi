const { Pool } = require('pg');
const p = new Pool({
  connectionString: 'postgresql://postgres.paxdkwuewfwntpmooddf:edcsTGfsxG7C3lSv@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

(async () => {
  // Check for orphaned bench_records (no matching bench_pres)
  const r = await p.query(`
    SELECT br.id, br.file_name, br.source_audio_record_id
    FROM bench_records br
    WHERE br.batch = 'benchmark-2'
      AND NOT EXISTS (SELECT 1 FROM bench_pres bp WHERE bp.bench_record_id = br.id)
  `);
  console.log(`Orphaned bench_records (no bench_pres): ${r.rows.length}`);
  r.rows.forEach(row => console.log(`  - ${row.file_name} (${row.id})`));

  if (r.rows.length > 0) {
    const ids = r.rows.map(row => row.id);
    const d = await p.query(
      `DELETE FROM bench_records WHERE id = ANY($1::uuid[])`,
      [ids]
    );
    console.log(`\nDeleted ${d.rowCount} orphaned records`);
  }

  // Also verify total counts
  const total = await p.query(`SELECT batch, COUNT(*) as cnt FROM bench_records GROUP BY batch ORDER BY batch`);
  console.log('\n=== Total bench_records by batch ===');
  total.rows.forEach(r => console.log(`  ${r.batch}: ${r.cnt}`));

  const withPres = await p.query(`
    SELECT br.batch, COUNT(*) as cnt 
    FROM bench_records br 
    JOIN bench_pres bp ON bp.bench_record_id = br.id 
    WHERE bp.status = 'completed'
    GROUP BY br.batch ORDER BY br.batch
  `);
  console.log('\n=== Completed cases (with bench_pres) ===');
  withPres.rows.forEach(r => console.log(`  ${r.batch}: ${r.cnt}`));

  await p.end();
})();
