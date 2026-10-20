require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/hr_onboarding');
  try {
    const [tables] = await connection.query('SHOW FULL TABLES');
    const report = { at: new Date().toISOString(), tables: {}, employees: [], users: [], departments: {}, hierarchy: [], issues: {} };
    for (const row of tables) {
      const name = Object.values(row)[0];
      const [columns] = await connection.query('SHOW COLUMNS FROM ??', [name]);
      const [[count]] = await connection.query('SELECT COUNT(*) AS n FROM ??', [name]);
      report.tables[name] = { count: Number(count.n), columns: columns.map(c => ({ name: c.Field, type: c.Type, key: c.Key })) };
    }
    [report.employees] = await connection.query(`SELECT e.*, u.name AS userName, u.role AS userRole, u.isActive AS userActive,
      pd.firstName AS personalFirstName, pd.lastName AS personalLastName, pd.fullName AS personalFullName,
      ws.departmentId AS wsDepartmentId, ws.designationId AS wsDesignationId,
      d.name AS mappedDepartment, des.name AS mappedDesignation
      FROM employee_information_employees e
      LEFT JOIN users u ON u.id = e.userId
      LEFT JOIN employee_information_personal_details pd ON pd.employeeId = e.id
      LEFT JOIN employee_information_workstation_details ws ON ws.employeeId = e.id
      LEFT JOIN eim_structures d ON d.id = e.departmentId
      LEFT JOIN designations des ON des.id = e.designationId ORDER BY e.employeeNumber`);
    // Keep this audit focused on organizational mappings; exclude contact and personal identifiers.
    report.employees = report.employees.map(e => Object.fromEntries(Object.entries(e).filter(([k]) => !['email', 'phone', 'barcodeNo', 'payrollNo', 'avatar'].includes(k))));
    [report.users] = await connection.query('SELECT id, name, role, isActive, supervisorId FROM users');
    for (const name of ['departments', 'designations', 'eim_structures', 'eim_corporate_titles', 'eim_job_profiles', 'reporting_hierarchy_levels', 'user_module_permissions']) {
      if (report.tables[name]) [report.departments[name]] = await connection.query('SELECT * FROM ??', [name]);
    }
    if (report.tables.reporting_relationships) [report.hierarchy] = await connection.query('SELECT * FROM reporting_relationships');
    report.issues.duplicateEmployeeNumbers = report.employees.filter((e, i, rows) => rows.findIndex(x => x.employeeNumber === e.employeeNumber) !== i).map(e => e.id);
    report.issues.duplicateUserMappings = report.employees.filter((e, i, rows) => e.userId && rows.findIndex(x => x.userId === e.userId) !== i).map(e => e.id);
    report.issues.missingUsers = report.employees.filter(e => !e.userName).map(e => e.id);
    const output = path.resolve(__dirname, '../repair-audit'); fs.mkdirSync(output, { recursive: true });
    const filename = path.join(output, 'database-audit.json'); fs.writeFileSync(filename, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ file: filename, tableCounts: Object.fromEntries(Object.entries(report.tables).map(([k, v]) => [k, v.count])), employees: report.employees.map(e => ({ id: e.id, no: e.employeeNumber, name: e.personalFullName || `${e.firstName || ''} ${e.lastName || ''}`, userName: e.userName, role: e.userRole, active: e.isActive, status: e.status, rank: e.organizationalRank, designation: e.designation, mappedDesignation: e.mappedDesignation, department: e.department, mappedDepartment: e.mappedDepartment, managerId: e.reportingManagerId, departmentId: e.departmentId, wsDepartmentId: e.wsDepartmentId, designationId: e.designationId, wsDesignationId: e.wsDesignationId })), issues: report.issues }, null, 2));
  } finally { await connection.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
