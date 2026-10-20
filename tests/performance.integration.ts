/** End-to-end API tests use a freshly created, isolated database and synthetic employees only. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import mysql from 'mysql2/promise';

async function main() {
  const source = new URL(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/hr_onboarding');
  const testName = `hr_performance_test_${randomUUID().replace(/-/g, '')}`;
  const adminConnection = await mysql.createConnection({ host: source.hostname, port: Number(source.port || 3306), user: decodeURIComponent(source.username), password: decodeURIComponent(source.password) });
  let server: import('node:http').Server | undefined;
  let pool: import('mysql2/promise').Pool | undefined;
  let passed = 0;
  try {
    await adminConnection.query(`CREATE DATABASE \`${testName}\``);
    source.pathname = `/${testName}`; process.env.DATABASE_URL = source.toString(); process.env.JWT_SECRET = 'performance-isolated-test-secret-not-for-production';
    const { db } = await import('../src/lib/db'); pool = db;
    await db.query(`CREATE TABLE users (id VARCHAR(36) PRIMARY KEY, role VARCHAR(30), email VARCHAR(100), isActive BOOLEAN, mustChangePassword BOOLEAN DEFAULT 0)`);
    await db.query(`CREATE TABLE employee_information_employees (
      id VARCHAR(36) PRIMARY KEY, userId VARCHAR(36), reportingManagerId VARCHAR(36), firstName VARCHAR(100), lastName VARCHAR(100),
      callingName VARCHAR(100), employeeNumber VARCHAR(50), employeeNo VARCHAR(50), department VARCHAR(100), designation VARCHAR(100),
      departmentId VARCHAR(36), designationId VARCHAR(36), status VARCHAR(20), isActive BOOLEAN, organizationalRank VARCHAR(30) DEFAULT 'EMPLOYEE')`);
    await db.query('CREATE TABLE employee_information_personal_details (employeeId VARCHAR(36), firstName VARCHAR(100), lastName VARCHAR(100))');
    await db.query('CREATE TABLE eim_structures (id VARCHAR(36), name VARCHAR(100))');
    await db.query('CREATE TABLE designations (id VARCHAR(36), name VARCHAR(100))');
    await db.query(`CREATE TABLE user_module_permissions (userId VARCHAR(36),moduleId VARCHAR(80),moduleAccess BOOLEAN,canView BOOLEAN,canCreate BOOLEAN,canEdit BOOLEAN,canDelete BOOLEAN,canApprove BOOLEAN,canExport BOOLEAN,dataScope VARCHAR(30))`);
    const ids = Object.fromEntries(['admin', 'manager', 'employee', 'peer', 'outsider', 'ceo', 'unassigned', 'candidate'].map(k => [k, randomUUID()]));
    const { generateToken } = await import('../src/middleware/auth');
    const tokens: Record<string, string> = {};
    for (const [name, id] of Object.entries(ids)) {
      const role = name === 'admin' ? 'SUPER_ADMIN' : name === 'candidate' ? 'CANDIDATE' : 'EMPLOYEE';
      await db.query('INSERT INTO users (id, role, email, isActive) VALUES (?, ?, ?, 1)', [id, role, `${name}@performance.test`]);
      tokens[name] = generateToken({ userId: id, role, email: `${name}@performance.test` });
      if (name !== 'admin' && name !== 'candidate') await db.query(`INSERT INTO employee_information_employees
        (id,userId,reportingManagerId,firstName,lastName,employeeNumber,department,designation,status,isActive,organizationalRank)
        VALUES (?, ?, ?, ?, 'Test', ?, 'Engineering', ?, 'Active', 1, ?)`, [id, id, name === 'employee' ? ids.manager : ['manager', 'peer', 'outsider'].includes(name) ? ids.ceo : null, name, `TEST-${name}`, name === 'ceo' ? 'Chief Executive Officer' : 'Engineer', name === 'ceo' ? 'CEO' : name === 'manager' ? 'MANAGER' : 'EMPLOYEE']);
    }
    const express = (await import('express')).default;
    const routes = (await import('../src/modules/performance/performance.routes')).default;
    const app = express(); app.use(express.json()); app.use('/api/performance', routes);
    app.use((error: Error, _req: unknown, res: any, _next: unknown) => { console.error(error); res.status(500).json({ message: error.message }); });
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const port = (server.address() as import('node:net').AddressInfo).port;
    async function request(who: string, method: string, path: string, body?: unknown, expected = 200) {
      const response = await fetch(`http://127.0.0.1:${port}/api/performance${path}`, { method, headers: { 'Content-Type': 'application/json', ...(tokens[who] ? { Authorization: `Bearer ${tokens[who]}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const json = await response.json() as any;
      assert.equal(response.status, expected, `${who} ${method} ${path}: ${JSON.stringify(json)}`); return json.data;
    }
    const check = (name: string) => { passed++; console.log(`PASS ${passed}: ${name}`); };
    await request('anonymous', 'GET', '/workspace', undefined, 401);
    await request('candidate', 'GET', '/workspace', undefined, 403); check('Authentication and candidate exclusion');
    const templateInput = { name: 'Test Annual Review', description: '', goalWeight: 70,
      competencies: [{ id: 'ownership', name: 'Ownership', description: '', weight: 30 }],
      questions: [{ id: 'impact', section: 'Outcomes', prompt: 'What impact did you make?', required: true }] };
    await request('employee', 'POST', '/templates', templateInput, 403);
    await request('admin', 'POST', '/templates', { ...templateInput, goalWeight: 60 }, 400);
    const template = await request('admin', 'POST', '/templates', templateInput);
    await request('admin', 'POST', `/templates/${template.id}/publish`);
    await request('admin', 'PUT', `/templates/${template.id}`, templateInput, 409); check('Template weights, HR-only setup and publication lock');
    const { today } = await import('../src/modules/performance/rules');
    const date = today(); const year = Number(date.slice(0, 4));
    const cycleInput = { name: 'Test cycle', description: '', startDate: `${year}-01-01`, endDate: `${year}-12-31`, selfDeadline: `${year}-11-01`, managerDeadline: `${year}-12-01`, templateId: template.id, employeeIds: [ids.employee, ids.outsider], feedbackRequired: true, developmentRequired: true };
    await request('admin', 'POST', '/cycles', { ...cycleInput, endDate: `${year}-02-30` }, 400);
    await request('admin', 'POST', '/cycles', { ...cycleInput, managerDeadline: `${year}-10-01` }, 400);
    const cycle = await request('admin', 'POST', '/cycles', cycleInput);
    assert.equal((await request('employee', 'GET', '/workspace')).cycles.length, 0);
    await request('admin', 'POST', `/cycles/${cycle.id}/launch`);
    await request('admin', 'POST', `/cycles/${cycle.id}/launch`, undefined, 409);
    await request('admin', 'PUT', `/cycles/${cycle.id}`, cycleInput, 409); check('Date validation, private drafts, launch and immutable cycle setup');
    const adminWorkspace = await request('admin', 'GET', '/workspace');
    const reviewId = adminWorkspace.reviews.find((r: any) => r.employeeId === ids.employee).id;
    assert.equal(adminWorkspace.reviews.length, 2);
    assert.equal((await request('manager', 'GET', '/workspace')).reviews.length, 1);
    assert.equal((await request('employee', 'GET', '/workspace')).reviews.length, 1);
    assert.equal((await request('ceo', 'GET', '/workspace')).reviews.length, 2);
    assert.equal((await request('unassigned', 'GET', '/workspace')).reviews.length, 0);
    await request('outsider', 'GET', `/reviews/${reviewId}`, undefined, 403); check('Employee, direct manager, CEO and unassigned employee scope');
    const goal = await request('admin', 'POST', '/library', { title: 'Ship reliable work', measure: 'Release and validate all milestones', weight: 70, milestones: [{ id: 'a', title: 'Build', weight: 40 }, { id: 'b', title: 'Verify', weight: 60 }] });
    const assign = { cycleId: cycle.id, goalIds: [goal.id], employeeIds: [ids.employee], dueDate: `${year}-12-31` };
    await request('manager', 'POST', '/assign-goals', { ...assign, employeeIds: [ids.outsider] }, 403);
    await request('manager', 'POST', '/assign-goals', assign);
    await request('manager', 'POST', '/assign-goals', assign, 409);
    const extraGoal = await request('admin', 'POST', '/library', { title: 'Extra', measure: 'Extra work', weight: 5, milestones: [] });
    await request('admin', 'POST', '/assign-goals', { ...assign, goalIds: [extraGoal.id], dueDate: `${year + 1}-01-01` }, 400); check('Goal assignment scope, duplicates and due-date limits');
    let review = await request('employee', 'GET', `/reviews/${reviewId}`);
    const action = async (who: string, action: string, payload?: unknown, expected = 200, version = review.version) => {
      const result = await request(who, 'POST', `/reviews/${reviewId}/actions`, { action, payload, version }, expected);
      if (expected === 200) review = await request('employee', 'GET', `/reviews/${reviewId}`);
      return result;
    };
    await action('employee', 'checkin', { goalId: review.goals[0].id, progress: 100, completedMilestoneIds: ['a'], comment: 'Build finished', blockers: '', evidence: 'Test evidence' });
    assert.equal(review.progress, 40); check('Milestone progress is calculated from completed weights');
    const stale = review.version - 1;
    await action('employee', 'self-save', {}, 409, stale);
    await action('employee', 'self-share', undefined, 400); check('Save-conflict handling and required assessment answers');
    const assessment = { answers: { impact: 'Released a reliable service' }, goalRatings: { [review.goals[0].id]: 4 }, competencyRatings: { ownership: 3 }, comment: 'Good outcome with room to improve.' };
    await action('employee', 'self-save', assessment);
    assert.deepEqual((await request('manager', 'GET', `/reviews/${reviewId}`)).self.answers, {});
    await action('manager', 'self-save', assessment, 403);
    await action('manager', 'manager-save', assessment, 409);
    await action('employee', 'self-share');
    await action('employee', 'self-save', assessment, 409);
    await action('manager', 'manager-save', assessment);
    assert.equal(review.manager.comment, '');
    await action('manager', 'manager-share');
    assert.equal(review.scores.total, 74); assert.equal(review.progress, 40); check('Draft privacy, owner-only submission and 74-point weighted score independent of progress');
    await action('manager', 'close', undefined, 409);
    await action('manager', 'feedback-invite', { reviewerId: ids.peer, relationship: 'Peer', dueDate: `${year}-12-31` });
    const invitation = (await request('peer', 'GET', '/workspace')).invitations[0];
    await request('peer', 'GET', `/reviews/${reviewId}`, undefined, 403);
    await action('outsider', 'feedback-submit', { requestId: invitation.id, strengths: 'Strong delivery', improvements: 'Forecast sooner', rating: 4 }, 403);
    await action('peer', 'feedback-submit', { requestId: invitation.id, strengths: 'Strong delivery', improvements: 'Forecast sooner', rating: 4 });
    assert.equal(review.feedback[0].strengths, ''); check('Reviewer-only feedback and restricted employee visibility before closure');
    await action('manager', 'feedback-withdraw', { requestId: invitation.id }, 409);
    await action('manager', 'feedback-invite', { reviewerId: ids.outsider, relationship: 'Project peer', dueDate: `${year}-12-31` });
    const declinedRequest = (await request('outsider', 'GET', '/workspace')).invitations[0];
    await action('outsider', 'feedback-decline', { requestId: declinedRequest.id });
    await action('manager', 'feedback-withdraw', { requestId: declinedRequest.id });
    assert.equal(review.feedback.length, 1); check('Declined requests can be withdrawn; submitted feedback is protected');
    await action('manager', 'development', { title: 'Mentor a colleague', description: 'Run weekly sessions', ownerId: ids.employee, dueDate: `${year + 1}-02-01`, status: 'PLANNED' });
    const career = { targetRole: 'Senior Engineer', timeframe: '12–18 months', strengths: ['Ownership'], growthAreas: ['Mentoring'], successEvidence: ['Lead one release'] };
    await action('outsider', 'career-direction', career, 403);
    await action('employee', 'career-direction', career);
    assert.deepEqual(review.careerDirection, career);
    await action('manager', 'meeting', { date, notes: 'Reviewed evidence and agreed development actions.' });
    await action('manager', 'close');
    assert.equal(review.finalScore, 74); assert.equal(review.feedback[0].strengths, 'Strong delivery');
    await action('employee', 'checkin', { goalId: review.goals[0].id, progress: 100, completedMilestoneIds: ['a', 'b'], comment: 'Late change' }, 409);
    await action('employee', 'acknowledge'); assert.ok(review.acknowledgedAt);
    await request('admin', 'POST', `/cycles/${cycle.id}/close`, undefined, 409); check('Closure prerequisites, immutable snapshot, acknowledgement and cycle close guard');
    const future = await request('admin', 'POST', '/cycles', { ...cycleInput, name: 'Scheduled cycle', startDate: `${year + 1}-01-01`, selfDeadline: `${year + 1}-06-01`, managerDeadline: `${year + 1}-07-01`, endDate: `${year + 1}-12-31`, employeeIds: [ids.employee] });
    await request('admin', 'POST', `/cycles/${future.id}/launch`);
    const futureReview = (await request('employee', 'GET', '/workspace')).reviews.find((r: any) => r.cycleId === future.id);
    await request('employee', 'POST', `/reviews/${futureReview.id}/actions`, { action: 'self-save', payload: assessment, version: 1 }, 409); check('Scheduled review tasks stay locked until the start date');
    const notifications = (await request('employee', 'GET', '/workspace')).notifications;
    assert.ok(notifications.length > 0); await request('employee', 'POST', `/notifications/${notifications[0].id}/read`);
    assert.ok((await request('employee', 'GET', '/workspace')).notifications.find((n: any) => n.id === notifications[0].id).readAt); check('Persisted in-app notifications and read state');
    console.log(`\n${passed} integration checks passed using synthetic data.`);
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    if (pool) await pool.end();
    // Only the uniquely named database created by this test is eligible for cleanup.
    assert.match(testName, /^hr_performance_test_[a-f0-9]{32}$/);
    await adminConnection.query(`DROP DATABASE IF EXISTS \`${testName}\``);
    await adminConnection.end();
    console.log('Isolated test database removed; the HR database was not changed.');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
