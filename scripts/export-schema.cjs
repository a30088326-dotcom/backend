require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');

const withoutDefiner = sql => sql.replace(/DEFINER\s*=\s*`[^`]*`@`[^`]*`\s*/g, '');

async function main() {
  const connection = await mysql.createConnection({
    uri: process.env.DATABASE_URL || 'mysql://root:@localhost:3306/hr_onboarding',
  });
  try {
    const [objects] = await connection.query('SHOW FULL TABLES');
    const tables = [];
    const views = [];
    for (const object of objects) {
      const [name, type] = Object.values(object);
      const [rows] = await connection.query('SHOW CREATE TABLE ??', [name]);
      const sql = withoutDefiner(rows[0][type === 'VIEW' ? 'Create View' : 'Create Table']);
      if (type === 'VIEW') views.push({ name, sql });
      else tables.push({ name, sql: sql.replace(/ AUTO_INCREMENT=\d+/g, '') });
    }
    const [triggers] = await connection.query('SHOW TRIGGERS');
    const [routines] = await connection.query('SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE() ORDER BY ROUTINE_NAME');
    const routineDefinitions = [];
    for (const routine of routines) {
      const type = routine.ROUTINE_TYPE;
      if (!['PROCEDURE', 'FUNCTION'].includes(type)) throw new Error('Unexpected routine type');
      const [rows] = await connection.query(`SHOW CREATE ${type} ??`, [routine.ROUTINE_NAME]);
      routineDefinitions.push({ name: routine.ROUTINE_NAME, type, sql: withoutDefiner(rows[0][type === 'PROCEDURE' ? 'Create Procedure' : 'Create Function']) });
    }
    const [events] = await connection.query('SHOW EVENTS');
    const eventDefinitions = [];
    for (const event of events) {
      const [rows] = await connection.query('SHOW CREATE EVENT ??', [event.Name]);
      eventDefinitions.push({ name: event.Name, sql: withoutDefiner(rows[0]['Create Event']) });
    }
    const [foreignKeys] = await connection.query('SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, CONSTRAINT_NAME AS constraintName, REFERENCED_TABLE_NAME AS referencedTable, REFERENCED_COLUMN_NAME AS referencedColumn FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION');
    const sql = [
      '-- Peoples Management database structure. Import into an EMPTY database.',
      '-- Schema only: no employee records, credentials, or other live data.',
      'SET NAMES utf8mb4;',
      'SET FOREIGN_KEY_CHECKS=0;',
      ...tables.map(table => `${table.sql};`),
      ...views.map(view => `${view.sql};`),
      ...routineDefinitions.map(routine => `DELIMITER $$\n${routine.sql}$$\nDELIMITER ;`),
      ...triggers.map(trigger => `DELIMITER $$\nCREATE TRIGGER ${connection.escapeId(trigger.Trigger)} ${trigger.Timing} ${trigger.Event} ON ${connection.escapeId(trigger.Table)} FOR EACH ROW ${trigger.Statement}$$\nDELIMITER ;`),
      ...eventDefinitions.map(event => `DELIMITER $$\n${event.sql}$$\nDELIMITER ;`),
      'SET FOREIGN_KEY_CHECKS=1;',
      '',
    ].join('\n\n');
    const manifest = {
      schemaOnly: true,
      tables: tables.map(table => table.name),
      views: views.map(view => view.name),
      triggers: triggers.map(trigger => trigger.Trigger),
      routines: routineDefinitions.map(({ name, type }) => ({ name, type })),
      events: eventDefinitions.map(event => event.name),
      foreignKeys,
    };
    console.log(JSON.stringify({ sql, manifest }));
  } finally {
    await connection.end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
