/** Opt-in, insert-only demo data. Never run automatically at application startup. */
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { v5 as uuid } from 'uuid';
import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../src/lib/db';
import { directory, type DirectoryEmployee } from '../src/shared/services/organization.service';
import { ensurePerformanceSchema } from '../src/modules/performance/schema';
import type { Assessment, Cycle, Goal, LibraryGoal, Review, Template } from '../src/modules/performance/types';
import { emptyAssessment } from '../src/modules/performance/types';
import { assessmentProblems, assessmentSchema, closureProblems, cycleSchema, librarySchema, score, templateSchema, today, validateCycle, validateTemplate } from '../src/modules/performance/rules';
import { list, save } from '../src/modules/performance/store';

const namespace = uuid('readyhr-performance-demo-v1', uuid.URL);
const id = (key: string) => uuid(key, namespace);
const demo = '[DEMO — fictional practice data]';
const date = (offset: number) => new Date(Date.parse(`${today()}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
const at = (offset: number) => `${date(offset)}T08:00:00.000Z`;
type Family = 'leadership' | 'engineering' | 'product' | 'finance' | 'software' | 'cloud' | 'quality' | 'support';
const goalsByFamily: Record<Family, [string, string, string, string]> = {
  leadership: ['Deliver the quarterly business plan', 'Agree three company priorities, review delivery monthly and document decisions.', 'Build leadership capability', 'Complete three coaching sessions and a succession-readiness action plan.'],
  engineering: ['Improve engineering delivery predictability', 'Deliver 90% of agreed roadmap commitments with a fortnightly risk review.', 'Strengthen engineering quality practices', 'Introduce a shared quality checklist and mentor two technical leads.'],
  product: ['Validate the product roadmap with customers', 'Run five discovery sessions and prioritise the next release using recorded evidence.', 'Improve product and support handovers', 'Publish release guidance and reduce repeat questions through two team workshops.'],
  finance: ['Complete accurate monthly finance reporting', 'Deliver management accounts by the fifth working day with all reconciliations checked.', 'Improve budget visibility', 'Maintain a monthly variance dashboard and document three cost-control opportunities.'],
  software: ['Deliver reliable software increments', 'Complete agreed sprint stories with peer review, automated tests and no critical escaped defects.', 'Improve maintainability and knowledge sharing', 'Refactor one high-change component and publish two implementation guides.'],
  cloud: ['Improve cloud reliability and recovery readiness', 'Review service alerts, test one recovery runbook and meet the agreed availability target.', 'Automate operational toil', 'Automate two recurring deployment or infrastructure tasks and record the time saved.'],
  quality: ['Increase risk-based regression coverage', 'Automate critical customer journeys and verify all release-blocking defects before sign-off.', 'Improve defect prevention', 'Run two root-cause reviews and add preventive checks to the release checklist.'],
  support: ['Improve customer response and resolution', 'Meet the agreed response SLA on 95% of tickets and document clear resolution notes.', 'Strengthen the support knowledge base', 'Publish four reusable troubleshooting articles and complete a peer handover session.'],
};
function family(e: DirectoryEmployee): Family {
  const d = e.department.toLowerCase();
  if (d.includes('executive')) return 'leadership';
  if (d === 'engineering') return 'engineering';
  if (d.includes('product')) return 'product';
  if (d.includes('finance')) return 'finance';
  if (d.includes('cloud')) return 'cloud';
  if (d.includes('quality')) return 'quality';
  if (d.includes('support')) return 'support';
  return 'software';
}
const template: Template = {
  id: id('template'), name: 'DEMO · Balanced performance review', description: `${demo} Goals 70%, competencies 30%. Sample ratings are not actual employee evaluations.`,
  published: true, goalWeight: 70,
  competencies: [
    { id: 'ownership', name: 'Ownership & delivery', description: 'Follows through and escalates risks early.', weight: 10 },
    { id: 'collaboration', name: 'Collaboration & communication', description: 'Shares context and supports colleagues.', weight: 10 },
    { id: 'learning', name: 'Learning & improvement', description: 'Applies feedback and improves working practices.', weight: 10 },
  ],
  questions: [
    { id: 'achievements', section: 'Results', prompt: 'What were the most important achievements and their impact?', required: true },
    { id: 'challenges', section: 'Reflection', prompt: 'What challenges arose and what was learned?', required: true },
    { id: 'support', section: 'Growth', prompt: 'What support or development will improve the next cycle?', required: true },
  ],
};
const library: LibraryGoal[] = Object.entries(goalsByFamily).flatMap(([key, values]) => [0, 1].map(n => ({
  id: id(`library-${key}-${n}`), title: `DEMO · ${values[n * 2]}`, measure: `${demo} ${values[n * 2 + 1]}`, weight: n === 0 ? 40 : 30,
  milestones: [
    { id: `${key}-${n}-plan`, title: 'Agree scope and success measures', weight: 25, complete: false as const },
    { id: `${key}-${n}-deliver`, title: 'Deliver and review the agreed work', weight: 50, complete: false as const },
    { id: `${key}-${n}-evidence`, title: 'Record evidence and share learning', weight: 25, complete: false as const },
  ],
})));

function makeCycles(employees: DirectoryEmployee[]): Cycle[] {
  const common = { templateId: template.id, feedbackRequired: true, developmentRequired: true, createdAt: new Date().toISOString(), demo: true };
  return [
    { ...common, id: id('cycle-active'), name: 'DEMO · Current performance review', description: `${demo} Ready to explore: assigned goals, self drafts, manager reviews, feedback, development and closure. Uses current employees and reporting managers.`, startDate: date(-60), selfDeadline: date(21), managerDeadline: date(35), endDate: date(60), employeeIds: employees.map(e => e.id), status: 'ACTIVE' },
    { ...common, id: id('cycle-completed'), name: 'DEMO · Previous completed review', description: `${demo} Completed examples for reports and employee acknowledgement. Owner excluded because the Owner has no reporting manager.`, startDate: date(-240), selfDeadline: date(-130), managerDeadline: date(-110), endDate: date(-90), employeeIds: employees.filter(e => e.managerId).map(e => e.id), status: 'CLOSED' },
    { ...common, id: id('cycle-upcoming'), name: 'DEMO · Upcoming review draft', description: `${demo} An optional preconfigured next cycle. It stays hidden from employees until HR launches it; the current demo needs no setup.`, startDate: date(61), selfDeadline: date(140), managerDeadline: date(160), endDate: date(180), employeeIds: employees.map(e => e.id), status: 'DRAFT' },
  ];
}
function makeReview(e: DirectoryEmployee, index: number, cycle: Cycle, employees: DirectoryEmployee[]): Review {
  const completed = cycle.status === 'CLOSED';
  // Keep Kasun's own current assessment editable and give his manager examples to act on.
  const overrides: Record<string, number> = { 'EMP-024': 3, 'EMP-025': 2, 'EMP-026': 4, 'EMP-027': 1 };
  const stage = completed ? 6 : !e.managerId ? 0 : overrides[e.employeeNumber] ?? index % 6;
  const reviewId = id(`review-${cycle.id}-${e.id}`);
  const base = completed ? -120 : -12;
  const selected = library.filter(g => [id(`library-${family(e)}-0`), id(`library-${family(e)}-1`)].includes(g.id));
  const goals: Goal[] = selected.map((g, n) => {
    const count = completed ? 3 : stage >= 4 ? 3 : stage >= 2 ? 2 : n === 0 ? 2 : 1;
    const milestones = g.milestones.map((m, j) => ({ ...m, complete: j < count }));
    const progress = milestones.filter(m => m.complete).reduce((s, m) => s + m.weight, 0);
    return { ...structuredClone(g), id: id(`goal-${reviewId}-${n}`), libraryId: g.id, milestones, dueDate: cycle.endDate, progress,
      evidence: `${demo} ${e.name}: sample ${family(e)} delivery notes, checklist and team handover record.`,
      checkIns: [
        { id: id(`checkin-${reviewId}-${n}-1`), at: at(base - 8), by: e.userId!, progress: 25, comment: `${demo} Scope and success measures agreed for my ${e.designation} responsibilities.`, blockers: '' },
        { id: id(`checkin-${reviewId}-${n}-2`), at: at(base - 5), by: e.userId!, progress, comment: `${demo} Milestones reviewed; ${progress}% of the weighted work is complete.`, blockers: progress < 100 ? 'Demo: awaiting the next peer review slot.' : '' },
      ],
    };
  });
  const assessment = (manager: boolean): Assessment => ({
    answers: {
      achievements: `${demo} ${manager ? `${e.name} has` : 'I have'} progressed the agreed ${family(e)} outcomes, with evidence in the goal check-ins.`,
      challenges: `${demo} Competing priorities required a clearer weekly plan and earlier escalation. The sample action is a short weekly checkpoint.`,
      support: `${demo} Continue practical coaching${e.managerName ? ` with ${e.managerName}` : ''} and share a short improvement demonstration with the team.`,
    },
    goalRatings: Object.fromEntries(goals.map((g, n) => [g.id, 3 + (index + n + (manager ? 1 : 0)) % 3])),
    competencyRatings: Object.fromEntries(template.competencies.map((c, n) => [c.id, 3 + (index + n) % 3])),
    comment: `${demo} ${manager ? `Sample manager assessment for ${e.name}, mapped to ${e.managerName}.` : `Sample self-reflection for ${e.name}.`} The ratings and comments are invented solely to demonstrate the workflow.`,
    sharedAt: manager ? stage >= 3 ? at(base + 2) : null : stage >= 2 ? at(base) : null,
  });
  const self = assessment(false);
  if (stage === 0) { self.answers = { achievements: self.answers.achievements }; self.goalRatings = {}; self.competencyRatings = {}; }
  let peers = employees.filter(p => p.id !== e.id && p.id !== e.managerId && p.department === e.department);
  if (!peers.length) peers = employees.filter(p => p.id !== e.id && p.id !== e.managerId);
  const reviewer = e.employeeNumber === 'EMP-024' ? employees.find(p => p.employeeNumber === 'EMP-027') || peers[0] : peers[index % peers.length];
  const submitted = stage >= 4;
  const r: Review = {
    id: reviewId, cycleId: cycle.id, employeeId: e.id, template: structuredClone(template), goals,
    self, manager: stage >= 2 ? assessment(true) : emptyAssessment(),
    feedback: stage >= 3 ? [{ id: id(`feedback-${reviewId}`), reviewerId: reviewer.id, relationship: 'Demo peer collaboration', dueDate: completed ? date(-105) : date(28),
      status: submitted ? 'SUBMITTED' : 'PENDING', strengths: submitted ? `${demo} ${e.name} shares useful context and follows through on agreed work.` : '',
      improvements: submitted ? `${demo} Share progress updates earlier so teammates can plan their work.` : '', rating: submitted ? 4 : null, submittedAt: submitted ? at(base + 4) : null }] : [],
    development: [{ id: id(`development-${reviewId}-1`), title: `DEMO · ${family(e)} skills practice`, description: `${demo} Complete one practical learning session and demonstrate an improvement in the next team meeting.`, ownerId: e.id, dueDate: completed ? date(-95) : date(45), status: completed ? 'COMPLETED' : stage >= 2 ? 'IN_PROGRESS' : 'PLANNED' }],
    meetingDate: stage >= 4 ? date(base + 5) : null,
    meetingNotes: stage >= 4 ? `${demo} Example discussion between ${e.name} and ${e.managerName}: reviewed outcomes, clarified feedback and agreed the development action.` : '',
    closedAt: stage >= 5 ? at(base + 6) : null,
    acknowledgedAt: completed && index % 3 !== 0 && e.employeeNumber !== 'EMP-027' ? at(base + 7) : null,
    finalScore: null, version: 1, updatedAt: new Date().toISOString(),
  };
  if (r.closedAt) r.finalScore = score(r).total;
  return r;
}
function validate(cycles: Cycle[], reviews: Review[], employees: DirectoryEmployee[]) {
  templateSchema.parse(template); validateTemplate(template);
  for (const g of library) librarySchema.parse(g);
  for (const c of cycles) { cycleSchema.parse(c); validateCycle(c); }
  for (const r of reviews) {
    const c = cycles.find(c => c.id === r.cycleId)!;
    const e = employees.find(e => e.id === r.employeeId)!;
    if (!c.employeeIds.includes(e.id) || !e.userId) throw new Error('Review mapping is invalid.');
    for (const a of [r.self, r.manager]) {
      assessmentSchema.parse(a);
      if (a.sharedAt && assessmentProblems(r, a).length) throw new Error(`Incomplete shared assessment: ${e.employeeNumber}`);
    }
    if (r.manager.sharedAt && (!e.managerId || !r.self.sharedAt)) throw new Error('Invalid manager stage.');
    if (r.feedback.some(f => f.reviewerId === e.id || !employees.some(p => p.id === f.reviewerId && p.userId))) throw new Error('Invalid feedback mapping.');
    if (r.closedAt && (closureProblems(c, r).length || r.finalScore !== score(r).total)) throw new Error(`Invalid closed review: ${e.employeeNumber}`);
    for (const g of r.goals) {
      if (g.dueDate < c.startDate || g.dueDate > c.endDate || g.progress !== g.milestones.filter(m => m.complete).reduce((s, m) => s + m.weight, 0)) throw new Error('Invalid goal dates/progress.');
    }
  }
}
async function main() {
  await ensurePerformanceSchema();
  const employees = (await directory()).filter(e => e.active).sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber));
  const owner = employees.find(e => e.organizationalRank === 'OWNER');
  if (!owner?.userId || employees.some(e => !e.userId) || employees.length < 2) throw new Error('Active employees, login mappings and an Owner are required.');
  const cycles = makeCycles(employees);
  const reviews = cycles.filter(c => c.status !== 'DRAFT').flatMap(c => employees.filter(e => c.employeeIds.includes(e.id)).map(e => makeReview(e, employees.indexOf(e), c, employees)));
  validate(cycles, reviews, employees);
  const summary = { employees: employees.length, cycles: cycles.map(c => ({ name: c.name, status: c.status, employees: c.employeeIds.length })), templates: 1, libraryGoals: library.length, reviews: reviews.length, goals: reviews.reduce((s, r) => s + r.goals.length, 0) };
  const connection = await db.getConnection();
  let locked = false;
  try {
    const [locks] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK('readyhr-performance-demo-v1', 5) AS acquired");
    if (locks[0].acquired !== 1) throw new Error('Another demo setup is running.');
    locked = true;
    const existing = await list<Cycle>('cycles', connection);
    const found = cycles.filter(c => existing.some(e => e.id === c.id));
    if (found.length) {
      if (found.length !== cycles.length || found.some(c => !existing.find(e => e.id === c.id)?.demo)) throw new Error('Partial demo setup detected; existing data was left untouched.');
      const stored = (await list<Review>('reviews', connection)).filter(r => found.some(c => c.id === r.cycleId));
      console.log(JSON.stringify({ status: 'already-present; no records changed', reviews: stored.length, cycles: found.length }, null, 2));
      return;
    }
    if (!process.argv.includes('--apply')) { console.log(JSON.stringify({ status: 'preview; use --apply to insert', ...summary }, null, 2)); return; }
    await connection.beginTransaction();
    try {
      const snapshot: Record<string, unknown> = {};
      for (const table of ['templates', 'cycles', 'library', 'reviews', 'audit', 'notifications']) {
        const [rows] = await connection.query(`SELECT * FROM hr_performance_${table}`); snapshot[`hr_performance_${table}`] = rows;
      }
      const backup = path.resolve(__dirname, '../backups', `performance-before-demo-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      await mkdir(path.dirname(backup), { recursive: true });
      await writeFile(backup, JSON.stringify(snapshot, null, 2), { flag: 'wx' });
      await save('templates', template, connection, true);
      for (const goal of library) await save('library', goal, connection, true);
      for (const cycle of cycles) await save('cycles', cycle, connection, true);
      for (const r of reviews) {
        await save('reviews', r, connection, true);
        await connection.query('INSERT INTO hr_performance_audit (id, entity_id, actor_id, event) VALUES (?, ?, ?, ?)', [id(`audit-${r.id}`), r.id, owner.userId, r.closedAt ? 'DEMO_CLOSED_EXAMPLE_CREATED' : 'DEMO_REVIEW_EXAMPLE_CREATED']);
        if (r.cycleId === id('cycle-active')) {
          const e = employees.find(e => e.id === r.employeeId)!;
          await connection.query('INSERT INTO hr_performance_notifications (id, user_id, review_id, message) VALUES (?, ?, ?, ?)', [id(`notice-${r.id}`), e.userId, r.id, `DEMO: Your practice review is ready with goals, check-ins and development actions. Sample ratings are not actual evaluations.`]);
          if (r.feedback.some(f => f.status === 'PENDING')) {
            const f = r.feedback[0]; const peer = employees.find(e => e.id === f.reviewerId)!;
            await connection.query('INSERT INTO hr_performance_notifications (id, user_id, review_id, message) VALUES (?, ?, ?, ?)', [id(`feedback-notice-${r.id}`), peer.userId, r.id, `DEMO: Practice 360° feedback is requested for ${e.name}.`]);
          }
        }
      }
      await connection.commit();
      console.log(JSON.stringify({ status: 'created', ...summary, backup }, null, 2));
    } catch (error) { await connection.rollback(); throw error; }
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK('readyhr-performance-demo-v1')");
    connection.release();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.end());
