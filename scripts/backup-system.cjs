require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
async function main() {
  const connection = await mysql.createConnection({ uri: process.env.DATABASE_URL || 'mysql://root:@localhost:3306/hr_onboarding', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = path.resolve(__dirname, '../backups', `system-repair-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, 'database.sql');
  const fd = fs.openSync(filename, 'wx');
  const manifest = { at: new Date().toISOString(), tables: {}, file: filename, sha256: '' };
  try {
    await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    const [tables] = await connection.query('SHOW FULL TABLES');
    fs.writeSync(fd, '-- Recover into an EMPTY database. No DROP/TRUNCATE statements are included.\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n');
    for (const table of tables.filter(t => Object.values(t)[1] === 'BASE TABLE')) {
      const name = Object.values(table)[0];
      const [definition] = await connection.query('SHOW CREATE TABLE ??', [name]);
      fs.writeSync(fd, `${definition[0]['Create Table']};\n`);
      const [rows, fields] = await connection.query('SELECT * FROM ??', [name]);
      manifest.tables[name] = rows.length;
      const columns = fields.map(f => connection.escapeId(f.name)).join(',');
      for (const row of rows) {
        const values = fields.map(f => { const value = row[f.name]; return connection.escape(value !== null && typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value); }).join(',');
        fs.writeSync(fd, `INSERT INTO ${connection.escapeId(name)} (${columns}) VALUES (${values});\n`);
      }
    }
    for (const table of tables.filter(t => Object.values(t)[1] === 'VIEW')) {
      const [definition] = await connection.query('SHOW CREATE VIEW ??', [Object.values(table)[0]]);
      fs.writeSync(fd, `${definition[0]['Create View']};\n`);
    }
    const [triggers] = await connection.query('SHOW TRIGGERS');
    for (const trigger of triggers) {
      fs.writeSync(fd, `DELIMITER $$\nCREATE TRIGGER ${connection.escapeId(trigger.Trigger)} ${trigger.Timing} ${trigger.Event} ON ${connection.escapeId(trigger.Table)} FOR EACH ROW ${trigger.Statement}$$\nDELIMITER ;\n`);
    }
    fs.writeSync(fd, 'SET FOREIGN_KEY_CHECKS=1;\n'); fs.closeSync(fd);
    await connection.commit();
    manifest.sha256 = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({ directory, tables: Object.keys(manifest.tables).length, rows: Object.values(manifest.tables).reduce((a,b) => a+b,0), sha256: manifest.sha256 }));
  } catch (error) { await connection.rollback(); throw error; }
  finally { await connection.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
