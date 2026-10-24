const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

// Deliberately excludes users, employees, documents, invitations, permissions,
// employee transactions, reviews, assigned goals, conversations and audit logs.
const settingsTables = new Set([
  'eim_attachment_types', 'eim_benefit_salary_grades', 'eim_benefits', 'eim_blood_groups',
  'eim_companies', 'eim_corporate_titles', 'eim_cost_centres', 'eim_currencies',
  'eim_dynamic_fields', 'eim_employee_categories', 'eim_employee_groups', 'eim_employee_titles',
  'eim_extracurricular_categories', 'eim_extracurricular_types', 'eim_functional_roles',
  'eim_functions', 'eim_genders', 'eim_geography', 'eim_hierarchy_config', 'eim_hierarchy_settings',
  'eim_job_profiles', 'eim_languages', 'eim_locations', 'eim_marital_statuses',
  'eim_membership_types', 'eim_nationalities', 'eim_proficiency_levels',
  'eim_qual_classifications', 'eim_qual_types', 'eim_quals', 'eim_rating_methods',
  'eim_relationship_types', 'eim_religions', 'eim_salary_grades', 'eim_statutory_classifications',
  'eim_structures', 'eim_subjects', 'designations', 'employment_types',
  'attendance_shifts', 'attendance_roster_groups', 'attendance_roster_group_shifts',
  'daytype', 'calendargroup', 'holidaycalendar', 'calendarday',
  'leave_types', 'leave_years', 'leave_groups', 'leave_group_types', 'leave_rule_scripts',
  'reporting_hierarchy_levels', 'performance_review_templates',
  'performance_review_template_sections', 'performance_review_template_questions',
  'performance_review_template_question_options', 'performance_cycles',
  'hr_performance_templates', 'hr_performance_library',
]);
const identityLookups = new Set([
  'eim_genders', 'eim_nationalities', 'eim_currencies', 'eim_relationship_types', 'leave_types',
]);
const personColumn = /^(created_?by(?:id)?|updated_?by(?:id)?|published_?by|owner_?id|unitHeadEmployeeId|employee_?id|manager_?id)$/i;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
  const directory = path.resolve(process.argv[2] || '');
  if (!process.argv[2]) throw new Error('Provide a reviewed system backup directory.');
  const apply = process.argv.includes('--apply');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const sql = fs.readFileSync(path.join(directory, 'database.sql'), 'utf8');
  if (hash(sql) !== manifest.sha256) throw new Error('Backup checksum mismatch.');
  const target = new URL(process.env.DATABASE_URL || '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
    throw new Error('Restore is restricted to local MySQL.');
  }
  const connection = await mysql.createConnection({ uri: process.env.DATABASE_URL, dateStrings: true });
  const targetDb = target.pathname.slice(1);
  const staging = `hr_settings_restore_${crypto.randomUUID().replace(/-/g, '')}`;
  let created = false, locked = false;
  const lockName = `${targetDb}:module-settings-restore`;
  try {
    const [[lock]] = await connection.query('SELECT GET_LOCK(?,5) acquired', [lockName]);
    if (lock.acquired !== 1) throw new Error('Another settings restore is running.');
    locked = true;
    await connection.query('CREATE DATABASE ??', [staging]); created = true;
    const [existingTables] = await connection.query('SHOW TABLES');
    const allTables = existingTables.map(row => Object.values(row)[0]);
    const tables = allTables.filter(table => settingsTables.has(table));
    const [foreignKeys] = await connection.query(`SELECT TABLE_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME IS NOT NULL`, [targetDb]);
    const ordered = [], visiting = new Set();
    const visit = table => {
      if (ordered.includes(table)) return;
      if (visiting.has(table)) throw new Error('Cyclic settings dependency.');
      visiting.add(table);
      for (const fk of foreignKeys.filter(f => f.TABLE_NAME === table && f.REFERENCED_TABLE_NAME !== table && tables.includes(f.REFERENCED_TABLE_NAME))) visit(fk.REFERENCED_TABLE_NAME);
      visiting.delete(table); ordered.push(table);
    };
    tables.forEach(visit);
    tables.splice(0, tables.length, ...ordered);
    for (const table of tables) {
      // LIKE copies columns/indexes, but not foreign keys; no backup DDL is executed.
      await connection.query('CREATE TABLE ??.?? LIKE ??.??', [staging, table, targetDb, table]);
    }
    const loaded = {};
    for (const line of sql.split(/\r?\n/)) {
      const match = line.match(/^INSERT INTO `([a-z0-9_]+)` (\([^;]+\)) VALUES (.+);$/);
      if (!match || !tables.includes(match[1])) continue;
      const table = match[1];
      // Single-statement mode is intentional. Non-whitelisted SQL never runs.
      await connection.query(`INSERT INTO ${connection.escapeId(staging)}.${connection.escapeId(table)} ${match[2]} VALUES ${match[3]}`);
      loaded[table] = (loaded[table] || 0) + 1;
    }
    for (const table of tables) {
      if ((loaded[table] || 0) !== (manifest.tables[table] || 0)) {
        throw new Error(`Backup row count mismatch: ${table}`);
      }
    }
    const [columns] = await connection.query(
      'SELECT TABLE_NAME,COLUMN_NAME,IS_NULLABLE,COLUMN_KEY,DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? ORDER BY ORDINAL_POSITION', [targetDb]);
    const meta = new Map(tables.map(table => [table, columns.filter(c => c.TABLE_NAME === table)]));
    const rows = new Map(), idMap = new Map(), plans = [];
    for (const table of tables) {
      const [backup] = await connection.query('SELECT * FROM ??.??', [staging, table]);
      const [current] = await connection.query('SELECT * FROM ??', [table]);
      rows.set(table, current);
      const primary = meta.get(table).filter(c => c.COLUMN_KEY === 'PRI').map(c => c.COLUMN_NAME);
      if (!primary.length) throw new Error(`Missing primary key: ${table}`);
      const key = primary[0];
      const comparable = ['code', ...(identityLookups.has(table) ? ['name'] : []), ...(table === 'leave_years' ? ['year'] : [])]
        .filter(k => meta.get(table).some(c => c.COLUMN_NAME === k));
      for (const row of backup) {
        let matches = current.filter(r => primary.every(k => r[k] === row[k]));
        if (!matches.length) {
          for (const candidate of comparable) {
            matches = current.filter(r => row[candidate] != null && r[candidate] != null && String(row[candidate]).toLowerCase() === String(r[candidate]).toLowerCase());
            if (matches.length) break;
          }
        }
        if (matches.length > 1) throw new Error(`Ambiguous existing setting: ${table}`);
        const found = matches[0];
        if (primary.length === 1 && typeof row[key] === 'string' && found && row[key] !== found[key]) idMap.set(row[key], found[key]);
        plans.push({ table, key, row, found });
      }
    }
    const remap = value => {
      if (typeof value === 'string') {
        if (idMap.has(value)) return idMap.get(value);
        return value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, id => idMap.get(id) || id);
      }
      if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
        if (Array.isArray(value)) return value.map(remap);
        return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, personColumn.test(key) ? null : remap(val)]));
      }
      return value;
    };
    // Fingerprint every excluded table, including the user's new onboarding data.
    const excludedBefore = {};
    for (const table of allTables.filter(table => !settingsTables.has(table))) {
      const [records] = await connection.query('SELECT * FROM ??', [table]);
      excludedBefore[table] = hash(JSON.stringify(records));
    }
    await connection.beginTransaction();
    const summary = {};
    for (const plan of plans) {
      const { table, key, found } = plan;
      const record = {};
      for (const col of meta.get(table)) {
        let value = plan.row[col.COLUMN_NAME];
        if (value === undefined) continue;
        if (personColumn.test(col.COLUMN_NAME) && value != null) {
          if (col.IS_NULLABLE !== 'YES') throw new Error(`Required employee attribution: ${table}.${col.COLUMN_NAME}`);
          value = null;
        }
        record[col.COLUMN_NAME] = remap(value);
        if (col.DATA_TYPE === 'json' && value != null) {
          const parsed = typeof value === 'string' ? JSON.parse(value) : value;
          record[col.COLUMN_NAME] = JSON.stringify(remap(parsed));
        }
      }
      summary[table] ||= { inserted: 0, restored: 0, preserved: 0 };
      if (found) {
        if (table === 'leave_types') {
          // Requested original leave configuration takes priority over freshly seeded defaults.
          delete record[key];
          await connection.query('UPDATE ?? SET ? WHERE ??=?', [table, record, key, found[key]]);
          summary[table].restored++;
        } else summary[table].preserved++;
      } else {
        await connection.query('INSERT INTO ?? SET ?', [table, record]);
        summary[table].inserted++;
      }
    }
    // Check declared relationships before committing; never disable target FK checks.
    for (const fk of foreignKeys.filter(f => settingsTables.has(f.TABLE_NAME))) {
      const [[result]] = await connection.query(`SELECT COUNT(*) n FROM ?? c LEFT JOIN ?? p ON c.??=p.?? WHERE c.?? IS NOT NULL AND p.?? IS NULL`,
        [fk.TABLE_NAME, fk.REFERENCED_TABLE_NAME, fk.COLUMN_NAME, fk.REFERENCED_COLUMN_NAME, fk.COLUMN_NAME, fk.REFERENCED_COLUMN_NAME]);
      if (result.n) throw new Error(`Unresolved configuration reference: ${fk.TABLE_NAME}.${fk.COLUMN_NAME}`);
    }
    for (const [table, fingerprint] of Object.entries(excludedBefore)) {
      const [records] = await connection.query('SELECT * FROM ??', [table]);
      if (hash(JSON.stringify(records)) !== fingerprint) throw new Error(`Protected records changed: ${table}`);
    }
    if (apply) await connection.commit(); else await connection.rollback();
    const result = { applied: apply, backupAt: manifest.at, sourceSha256: manifest.sha256,
      employeeRecordsImported: 0, protectedTablesUnchanged: Object.keys(excludedBefore).length,
      remappedSettingIds: idMap.size, tables: summary };
    const report = path.join(__dirname, `../repair-audit/module-settings-restore${apply ? '' : '-preview'}.json`);
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) {
    await connection.rollback(); throw error;
  } finally {
    // Only this invocation's randomly named staging database is disposable.
    if (created && /^hr_settings_restore_[a-f0-9]{32}$/.test(staging)) {
      await connection.query('DROP DATABASE ??', [staging]);
    }
    if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
    await connection.end();
  }
}

main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
