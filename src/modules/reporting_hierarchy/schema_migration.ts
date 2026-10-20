import 'dotenv/config';
import mysql from 'mysql2/promise';

async function migrate() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL environment variable is not set');
  console.log('Starting DB migration for Reporting Hierarchy...');
  
  const conn = await mysql.createConnection(url);
  
  try {
    // Check if reportingEffectiveFrom exists
    const [cols]: any = await conn.query(`
      SELECT COLUMN_NAME 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'employee_information_employees' 
        AND COLUMN_NAME = 'reportingEffectiveFrom'
    `);
    
    if (cols.length === 0) {
      console.log('Adding reportingEffectiveFrom column...');
      await conn.query(`ALTER TABLE employee_information_employees ADD COLUMN reportingEffectiveFrom DATE NULL`);
    } else {
      console.log('reportingEffectiveFrom already exists.');
    }

    // Check if foreign key exists
    const [fks]: any = await conn.query(`
      SELECT CONSTRAINT_NAME 
      FROM information_schema.KEY_COLUMN_USAGE 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'employee_information_employees' 
        AND CONSTRAINT_NAME = 'fk_emp_reporting_manager'
    `);
    
    if (fks.length === 0) {
      console.log('Adding fk_emp_reporting_manager foreign key constraint...');
      // Ensure column is VARCHAR(36) to match id, it should be already
      await conn.query(`
        ALTER TABLE employee_information_employees 
        ADD CONSTRAINT fk_emp_reporting_manager 
        FOREIGN KEY (reportingManagerId) 
        REFERENCES employee_information_employees(id) 
        ON DELETE SET NULL
      `);
    } else {
      console.log('fk_emp_reporting_manager already exists.');
    }

    // Also check if reporting_hierarchy_audit table exists, create if not
    const [auditTables]: any = await conn.query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'reporting_hierarchy_audit'
    `);

    if (auditTables.length === 0) {
      console.log('Creating reporting_hierarchy_audit table...');
      await conn.query(`
        CREATE TABLE reporting_hierarchy_audit (
          id VARCHAR(36) PRIMARY KEY,
          employee_id VARCHAR(36) NOT NULL,
          action VARCHAR(100) NOT NULL,
          previous_manager_id VARCHAR(36) NULL,
          new_manager_id VARCHAR(36) NULL,
          effective_date DATE NULL,
          reason TEXT NULL,
          remarks TEXT NULL,
          transfer_pending_approvals TINYINT(1) DEFAULT 0,
          changed_by VARCHAR(36) NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } else {
      console.log('reporting_hierarchy_audit table already exists.');
    }

    // Check reporting_relationships table
    const [relTables]: any = await conn.query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'reporting_relationships'
    `);

    if (relTables.length === 0) {
      console.log('Creating reporting_relationships table...');
      await conn.query(`
        CREATE TABLE reporting_relationships (
          id VARCHAR(36) PRIMARY KEY,
          employee_id VARCHAR(36) NOT NULL,
          manager_id VARCHAR(36) NULL,
          relationship_type VARCHAR(50) DEFAULT 'PRIMARY',
          effective_start_date DATE NOT NULL,
          effective_end_date DATE NULL,
          reason TEXT NULL,
          remarks TEXT NULL,
          status VARCHAR(50) DEFAULT 'Active',
          created_by VARCHAR(36) NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_by VARCHAR(36) NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
    } else {
      console.log('reporting_relationships table already exists.');
    }

    console.log('Migration successful.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await conn.end();
  }
}

migrate();
