// Read-only checks against the configured local HR database and running API.
require('dotenv').config();
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { v5: uuid } = require('uuid');
const { db } = require('../dist/lib/db');
const { directory, descendants } = require('../dist/shared/services/organization.service');
const { list } = require('../dist/modules/performance/store');
const { assessmentProblems, closureProblems, score } = require('../dist/modules/performance/rules');
const namespace = uuid('readyhr-performance-demo-v1', uuid.URL);
const id = key => uuid(key, namespace);
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
async function main() {
  const employees = (await directory()).filter(e => e.active);
  const cycles = await list('cycles'); const reviews = await list('reviews');
  const active = cycles.find(c => c.id === id('cycle-active'));
  const previous = cycles.find(c => c.id === id('cycle-completed'));
  const upcoming = cycles.find(c => c.id === id('cycle-upcoming'));
  assert.ok(active?.demo && previous?.demo && upcoming?.demo);
  assert.equal(active.status, 'ACTIVE'); assert.equal(previous.status, 'CLOSED'); assert.equal(upcoming.status, 'DRAFT');
  const current = reviews.filter(r => r.cycleId === active.id);
  const completed = reviews.filter(r => r.cycleId === previous.id);
  assert.equal(current.length, employees.length);
  assert.equal(completed.length, employees.filter(e => e.managerId).length);
  assert.equal(reviews.filter(r => r.cycleId === upcoming.id).length, 0);
  assert.deepEqual(current.map(r => r.employeeId).sort(), employees.map(e => e.id).sort());
  for (const r of [...current, ...completed]) {
    assert.equal(r.goals.length, 2); assert.equal(r.goals.reduce((n, g) => n + g.weight, 0), 70);
    assert.equal(r.development.length, 1);
    for (const g of r.goals) {
      assert.equal(g.progress, g.milestones.filter(m => m.complete).reduce((n, m) => n + m.weight, 0));
      assert.ok(g.checkIns.length >= 2 && g.evidence.includes('DEMO'));
    }
    for (const a of [r.self, r.manager]) if (a.sharedAt) assert.deepEqual(assessmentProblems(r, a), []);
    if (r.closedAt) { assert.deepEqual(closureProblems(r.cycleId === active.id ? active : previous, r), []); assert.equal(r.finalScore, score(r).total); }
    assert.ok(!r.manager.sharedAt || r.self.sharedAt);
    for (const f of r.feedback) { assert.notEqual(f.reviewerId, r.employeeId); assert.ok(employees.some(e => e.id === f.reviewerId && e.userId)); }
  }
  const backups = (await fs.readdir(path.resolve(__dirname, '../backups'))).filter(f => /^performance-before-demo-.*\.json$/.test(f)).sort();
  assert.ok(backups.length, 'Pre-insert backup must exist');
  const backup = JSON.parse(await fs.readFile(path.resolve(__dirname, '../backups', backups[0]), 'utf8'));
  let preserved = 0;
  for (const entity of ['templates', 'cycles', 'library', 'reviews']) {
    const stored = new Map((await list(entity)).map(r => [r.id, r]));
    for (const row of backup[`hr_performance_${entity}`]) { assert.deepEqual(stored.get(row.id), parse(row.data)); preserved++; }
  }
  const [users] = await db.query('SELECT id, role, email, mustChangePassword FROM users WHERE isActive = 1');
  const summaries = []; let resets = 0; let apiChecks = 0;
  async function get(user, route) {
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '2m' });
    const response = await fetch(`http://localhost:${process.env.PORT || 3001}/api/performance${route}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json(); apiChecks++;
    return { status: response.status, ...body };
  }
  for (const e of employees) {
    const user = users.find(u => u.id === e.userId); assert.ok(user, `No active login: ${e.employeeNumber}`);
    const result = await get(user, '/workspace');
    if (user.mustChangePassword) { assert.equal(result.status, 403); assert.equal(result.code, 'PASSWORD_CHANGE_REQUIRED'); resets++; continue; }
    assert.equal(result.status, 200); const w = result.data;
    const admin = ['SUPER_ADMIN', 'ADMIN'].includes(user.role);
    const executive = ['OWNER', 'CEO'].includes(e.organizationalRank);
    const allowed = new Set(admin || executive ? employees.map(p => p.id) : [e.id, ...descendants(employees, e.id)]);
    assert.ok(w.reviews.every(r => allowed.has(r.employeeId)), `Scope leak: ${e.employeeNumber}`);
    assert.equal(w.reviews.filter(r => r.cycleId === active.id).length, current.filter(r => allowed.has(r.employeeId)).length);
    if (!admin) assert.ok(!w.cycles.some(c => c.id === upcoming.id));
    const own = current.find(r => r.employeeId === e.id); const detail = await get(user, `/reviews/${own.id}`);
    assert.equal(detail.status, 200); assert.equal(detail.data.isOwner, true);
    if (!own.manager.sharedAt && !admin && !executive) assert.equal(detail.data.manager.comment, '');
    const outsider = current.find(r => !allowed.has(r.employeeId));
    if (outsider) assert.equal((await get(user, `/reviews/${outsider.id}`)).status, 403);
    if (['EMP-001', 'EMP-002', 'EMP-003', 'EMP-009', 'EMP-027'].includes(e.employeeNumber)) summaries.push({ employee: e.employeeNumber, activeReviewsVisible: w.reviews.filter(r => r.cycleId === active.id).length, totalReviewsVisible: w.reviews.length, invitedFeedback: w.invitations.filter(f => f.status === 'PENDING').length });
  }
  const kasun = employees.find(e => e.employeeNumber === 'EMP-027');
  assert.ok(kasun && !current.find(r => r.employeeId === kasun.id).self.sharedAt);
  assert.ok(current.some(r => r.feedback.some(f => f.reviewerId === kasun.id && f.status === 'PENDING')));
  console.log(JSON.stringify({ result: 'PASS', employees: employees.length, demoReviews: current.length + completed.length, demoGoals: (current.length + completed.length) * 2, preExistingRecordsUnchanged: preserved, apiChecks, accountsStillRequiringInitialPasswordChange: resets, roleScopes: summaries }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.end());
