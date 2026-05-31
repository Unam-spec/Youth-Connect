const { Client } = require('pg');
const connectionString = 'postgresql://postgres.oobjbxurtbtwcvfhpyak:7Ag0QPtPI2oaa7Wa@aws-0-eu-west-1.pooler.supabase.com:6543/postgres';

async function main() {
  const client = new Client({ connectionString });
  await client.connect();

  console.log('--- Checking messages schema ---');
  const res = await client.query(`
    SELECT column_name, data_type, ordinal_position
    FROM information_schema.columns
    WHERE table_name = 'messages' AND table_schema = 'public'
    ORDER BY ordinal_position;
  `);
  console.log(res.rows);

  console.log('\n--- Checking pg_publication_tables ---');
  const pubRes = await client.query(`
    SELECT * FROM pg_publication_tables WHERE tablename = 'messages';
  `);
  console.log(pubRes.rows);

  console.log('\n--- Checking RLS policies ---');
  const rlsRes = await client.query(`
    SELECT tablename, policyname, permissive, roles, cmd, qual, with_check 
    FROM pg_policies 
    WHERE tablename = 'messages';
  `);
  console.log(rlsRes.rows);

  await client.end();
}

main().catch(console.error);
