const path = require('node:path');
const { randomUUID } = require('node:crypto');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Small reference lists for a new local installation; no employee/demo records.
const defaults = {
  eim_genders: [['MALE', 'Male'], ['FEMALE', 'Female'], ['OTHER', 'Other'], ['UNDISCLOSED', 'Prefer not to say']],
  eim_nationalities: [
    ['LK', 'Sri Lankan'], ['IN', 'Indian'], ['PK', 'Pakistani'],
    ['BD', 'Bangladeshi'], ['NP', 'Nepali'], ['MV', 'Maldivian'],
    ['GB', 'British'], ['AU', 'Australian'], ['US', 'American'],
    ['CA', 'Canadian'], ['OTHER', 'Other'],
  ],
  eim_currencies: [['LKR', 'Sri Lankan Rupee'], ['USD', 'US Dollar'], ['EUR', 'Euro'], ['GBP', 'British Pound']],
  eim_relationship_types: [['FATHER', 'Father'], ['MOTHER', 'Mother'], ['SPOUSE', 'Spouse'], ['CHILD', 'Child'], ['SIBLING', 'Sibling'], ['OTHER', 'Other']],
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL in backend/.env first.');
  const target = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
    throw new Error('This setup script is restricted to local MySQL.');
  }
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const lockName = `${target.pathname.slice(1)}:onboarding-lookups`;
  let locked = false;
  try {
    const [[lock]] = await connection.query('SELECT GET_LOCK(?,5) acquired', [lockName]);
    if (lock.acquired !== 1) throw new Error('Another reference-data setup is running.');
    locked = true;
    await connection.beginTransaction();
    const inserted = {};
    for (const [table, entries] of Object.entries(defaults)) {
      inserted[table] = 0;
      for (const [code, name] of entries) {
        const [existing] = await connection.query('SELECT id FROM ?? WHERE code=? OR name=? LIMIT 1', [table, code, name]);
        if (existing.length) continue; // Keep existing names and inactive settings.
        await connection.query('INSERT INTO ?? (id,code,name,isActive) VALUES (?,?,?,1)', [table, randomUUID(), code, name]);
        inserted[table]++;
      }
    }
    await connection.commit();
    console.log(JSON.stringify({ database: target.pathname.slice(1), inserted }));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
    await connection.end();
  }
}

main().catch(error => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
