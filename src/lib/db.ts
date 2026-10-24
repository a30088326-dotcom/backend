import mysql, { type Pool } from 'mysql2/promise';

// Extract database details from DATABASE_URL
// e.g., mysql://root:password@localhost:3306/hr_onboarding
let pool: Pool | undefined;
function mysqlPool() {
  if (process.env.DATABASE_PROVIDER === 'dynamodb') throw new Error('SQL access is disabled for the DynamoDB runtime.');
  if (process.env.DATABASE_PROVIDER && process.env.DATABASE_PROVIDER !== 'mysql') throw new Error('Unsupported database provider.');
  return pool ||= mysql.createPool({
    uri: process.env.DATABASE_URL || 'mysql://root:@localhost:3306/hr_onboarding',
    timezone: '+05:30', waitForConnections: true, connectionLimit: 10, queueLimit: 0, dateStrings: ['DATE'],
  });
}
// Keep the working local adapter lazy. Cloud startup never creates a MySQL pool,
// and any missed legacy query fails closed instead of connecting to localhost.
export const db: Pool = new Proxy({} as Pool, {
  get(target, property, receiver) {
    if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
    if (property === 'end') return () => pool ? pool.end() : Promise.resolve();
    return (...args: unknown[]) => {
      const connection = mysqlPool();
      const method = Reflect.get(connection, property);
      if (typeof method !== 'function') throw new Error('Unsupported database adapter operation.');
      return method.apply(connection, args);
    };
  },
});

export default db;
