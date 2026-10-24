const path = require('node:path');
const { randomUUID } = require('node:crypto');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

// Preserve the three master definitions from src/seed.ts without its demo users,
// allocations, or updates to existing configuration. Entitlement rules remain
// in LeaveRulesEvaluator and may calculate a different employee-specific amount.
const defaults = [
  { code: 'ANN', name: 'Annual Leave', color: '#10b981', allowHalfDays: 1,
    requireCoveringEmp: 1, yearlyEntitlement: 14, carryForwardEnabled: 1,
    carryForwardMaxDays: 7, showReason: 0 },
  { code: 'CAS', name: 'Casual Leave', color: '#3b82f6', allowHalfDays: 1,
    yearlyEntitlement: 7, showReason: 1 },
  { code: 'MED', name: 'Medical Leave', color: '#ef4444', allowHalfDays: 0,
    yearlyEntitlement: 14, needMedicalCertificate: 1, maxDaysWithoutMedCert: 2,
    requireAttachment: 1, showReason: 1, commentMandatory: 1 },
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL first.');
  const target = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
    throw new Error('This setup script is restricted to local MySQL.');
  }
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const lockName = `${target.pathname.slice(1)}:leave-lookups`;
  let locked = false;
  try {
    const [[lock]] = await connection.query('SELECT GET_LOCK(?,5) acquired', [lockName]);
    if (lock.acquired !== 1) throw new Error('Another leave setup is running.');
    locked = true;
    await connection.beginTransaction();
    const inserted = [], preserved = [];
    for (const definition of defaults) {
      const [existing] = await connection.query(
        'SELECT id FROM leave_types WHERE code=? OR name=? LIMIT 1', [definition.code, definition.name]);
      if (existing.length) { preserved.push(definition.code); continue; }
      await connection.query('INSERT INTO leave_types SET ?', {
        id: randomUUID(), isActive: 1, requireCoveringEmp: 0,
        needMedicalCertificate: 0, maxDaysWithoutMedCert: 2, requireAttachment: 0,
        isNoPayLeave: 0, isMaternityLeave: 0, carryForwardEnabled: 0,
        carryForwardMaxDays: 0, showBalance: 1, allowNegativeBalance: 0,
        commentMandatory: 0, autoCalculateEndDate: 1,
        category: 'Planned Leave', unit: 'Working Days', paymentType: 'Paid',
        allowFullDay: 1, ...definition,
      });
      inserted.push(definition.code);
    }
    const year = new Date().getFullYear();
    const [existingYears] = await connection.query('SELECT id FROM leave_years WHERE year=?', [year]);
    if (!existingYears.length) {
      await connection.query('INSERT INTO leave_years SET ?', {
        id: randomUUID(), year, displayName: `${year} Annual`, isActive: 1,
        startDate: `${year}-01-01`, endDate: `${year}-12-31`,
      });
    }
    await connection.commit();
    console.log(JSON.stringify({ inserted, preserved, year, yearCreated: !existingYears.length }));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
    await connection.end();
  }
}

main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
