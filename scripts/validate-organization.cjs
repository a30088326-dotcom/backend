require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');

(async () => {
  const c = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await c.query("SELECT id, employeeNo, reportingManagerId, organizationalRank, status, isActive FROM employee_information_employees");
  const active = rows.filter(r => r.status === 'Active' && r.isActive !== 0);
  const byId = new Map(active.map(r => [r.id, r]));
  const owner = active.filter(r => r.organizationalRank === 'OWNER');
  const errors = [];
  if (owner.length !== 1) errors.push(`expected exactly one Owner, found ${owner.length}`);
  for (const employee of active) {
    const visited = new Set([employee.id]);
    let current = employee;
    while (current.reportingManagerId) {
      if (visited.has(current.reportingManagerId)) { errors.push(`cycle at ${employee.employeeNo}`); break; }
      visited.add(current.reportingManagerId);
      current = byId.get(current.reportingManagerId);
      if (!current) { errors.push(`missing manager in path for ${employee.employeeNo}`); break; }
    }
    if (employee.organizationalRank !== 'OWNER' && !employee.reportingManagerId) errors.push(`unmanaged employee ${employee.employeeNo}`);
  }
  console.log(JSON.stringify({ activeEmployees: active.length, owner: owner[0]?.employeeNo || null, errors }, null, 2));
  await c.end();
  process.exitCode = errors.length ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
