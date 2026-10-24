import mysql from 'mysql2/promise';

// Extract database details from DATABASE_URL
// e.g., mysql://root:password@localhost:3306/hr_onboarding
const url = process.env.DATABASE_URL || 'mysql://root:@localhost:3306/hr_onboarding';

export const db = mysql.createPool({
  uri: url,
  timezone: '+05:30',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: ['DATE'],
});

export default db;
