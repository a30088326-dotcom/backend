import { db } from '../../lib/db';

// A separate namespace preserves the retired module's historical records.
// No existing HR table or row is modified by this additive migration.
let pending: Promise<void> | undefined;
export function ensurePerformanceSchema() {
  if (process.env.DATABASE_PROVIDER === 'dynamodb') return Promise.resolve();
  if (!pending) pending = migrate().catch(error => { pending = undefined; throw error; });
  return pending;
}
async function migrate() {
  for (const table of ['hr_performance_templates', 'hr_performance_cycles', 'hr_performance_library']) {
    await db.query(`CREATE TABLE IF NOT EXISTS ${table} (
      id VARCHAR(36) PRIMARY KEY, data JSON NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`);
  }
  await db.query(`CREATE TABLE IF NOT EXISTS hr_performance_reviews (
    id VARCHAR(36) PRIMARY KEY, cycle_id VARCHAR(36) NOT NULL, employee_id VARCHAR(191) NOT NULL,
    data JSON NOT NULL, UNIQUE KEY unique_cycle_employee (cycle_id, employee_id),
    INDEX employee_lookup (employee_id),
    CONSTRAINT hr_pm_review_cycle FOREIGN KEY (cycle_id) REFERENCES hr_performance_cycles(id)
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE IF NOT EXISTS hr_performance_audit (
    id VARCHAR(36) PRIMARY KEY, entity_id VARCHAR(36) NOT NULL, actor_id VARCHAR(191) NOT NULL,
    event VARCHAR(100) NOT NULL, at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX entity_history (entity_id, at)
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE IF NOT EXISTS hr_performance_notifications (
    id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(191) NOT NULL, review_id VARCHAR(36) NOT NULL,
    message VARCHAR(500) NOT NULL, read_at DATETIME(3) NULL,
    at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX user_inbox (user_id, at),
    CONSTRAINT hr_pm_notification_review FOREIGN KEY (review_id) REFERENCES hr_performance_reviews(id)
  ) ENGINE=InnoDB`);
}
