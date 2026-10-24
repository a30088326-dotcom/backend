import { createHash, randomUUID } from 'node:crypto';
import { repository } from '../../storage/repository';
import { StorageConflictError } from '../../storage/dynamodb';
import { emptyAssessment, type Actor, type Cycle, type Review, type Template } from './types';
import { ensure, PerformanceError, validateCycle, validateTemplate } from './rules';

type Launch = { token: string; cursor: number; template: Template; startedAt: string };
const parse = <T>(value: unknown): T => typeof value === 'string' ? JSON.parse(value) : value as T;
const receiptId = (token: string, label: string) => {
  const h = createHash('sha256').update(`${token}:${label}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
};

/** A draft cycle is the publication gate. Each chunk and its saved cursor commit
 * together; review IDs and receipts are deterministic, so an interrupted request
 * can safely resume without exposing an incomplete launch or duplicating work. */
export async function launchCycleNative(actor: Actor, id: string): Promise<Cycle> {
  ensure(actor.admin, 'Only HR administrators can change cycle status.', 403);
  const repo = repository();
  let token: string | undefined;
  try {
    await repo.transaction(async tx => {
      const row = await tx.get('hr_performance_cycles', { id });
      ensure(row, 'Record not found.', 404);
      const cycle = parse<Cycle>(row.data);
      ensure(cycle.status === 'DRAFT', 'Only a draft cycle can be launched.', 409);
      if (row._launch) { token = (row._launch as Launch).token; return; }
      validateCycle(cycle);
      const templateRow = await tx.get('hr_performance_templates', { id: cycle.templateId });
      ensure(templateRow, 'Record not found.', 404);
      const template = parse<Template>(templateRow.data);
      ensure(template.published, 'Publish the template first.');
      validateTemplate(template);
      const snapshot = { ...template, questions: template.questions.filter(q => !/^development$/i.test(q.section.trim())) };
      ensure(snapshot.questions.length > 0, 'Add a question outside the removed Development section before launching.');
      ensure(cycle.employeeIds.every(employeeId => actor.employees.some(e => e.id === employeeId && e.active)), 'Remove inactive or deleted employees before launching.');
      token = randomUUID();
      await tx.replace('hr_performance_cycles', { ...row, _launch: { token, cursor: 0, template: snapshot, startedAt: new Date().toISOString() } });
    });
  } catch (error) {
    if (!(error instanceof StorageConflictError)) throw error;
    const current = await repo.get('hr_performance_cycles', { id });
    ensure(current && parse<Cycle>(current.data).status === 'DRAFT' && current._launch, 'This cycle changed. Reload it and try again.', 409);
    token = current._launch.token;
  }
  let conflicts = 0;
  for (;;) {
    try {
      const completed = await repo.transaction(async tx => {
        const row = await tx.get('hr_performance_cycles', { id });
        ensure(row, 'Record not found.', 404);
        const cycle = parse<Cycle>(row.data);
        if (cycle.status === 'ACTIVE' && row._publishedLaunchToken === token) return cycle;
        const launch = row._launch as Launch | undefined;
        ensure(launch, 'This launch changed. Reload the cycle before retrying.', 409);
        ensure(cycle.status === 'DRAFT' && launch.token === token, 'This launch changed. Reload the cycle before retrying.', 409);
        const end = Math.min(launch.cursor + 10, cycle.employeeIds.length);
        const at = new Date().toISOString();
        for (const employeeId of cycle.employeeIds.slice(launch.cursor, end)) {
          const reviewId = receiptId(token!, employeeId);
          const review: Review = { id: reviewId, cycleId: id, employeeId, template: launch.template, goals: [], self: emptyAssessment(), manager: emptyAssessment(), feedback: [], development: [], meetingDate: null, meetingNotes: '', closedAt: null, acknowledgedAt: null, finalScore: null, version: 1, updatedAt: at };
          await tx.create('hr_performance_reviews', { id: reviewId, cycle_id: id, employee_id: employeeId, data: review, _launchToken: token, _launchCycleId: id });
          await tx.create('hr_performance_audit', { id: receiptId(token!, `${employeeId}:audit`), entity_id: reviewId, actor_id: actor.userId, event: 'REVIEW_ASSIGNED', at });
          const userId = actor.employees.find(e => e.id === employeeId)?.userId;
          if (userId) await tx.create('hr_performance_notifications', { id: receiptId(token!, `${employeeId}:notification`), user_id: userId, review_id: reviewId, message: `You have been included in ${cycle.name}. Tasks open on ${cycle.startDate}.`, read_at: null, at, _launchToken: token, _launchCycleId: id });
        }
        if (end < cycle.employeeIds.length) {
          await tx.replace('hr_performance_cycles', { ...row, _launch: { ...launch, cursor: end } });
          return undefined;
        }
        const active: Cycle = { ...cycle, status: 'ACTIVE' };
        await tx.replace('hr_performance_cycles', { ...row, data: active, _launch: null, _publishedLaunchToken: token });
        await tx.create('hr_performance_audit', { id: receiptId(token!, 'published'), entity_id: id, actor_id: actor.userId, event: 'CYCLE_LAUNCH', at });
        return active;
      });
      conflicts = 0;
      if (completed) return completed;
    } catch (error) {
      if (error instanceof StorageConflictError && conflicts++ < 10) continue;
      const current = await repo.get('hr_performance_cycles', { id });
      if (current && current._launch?.token === token) {
        const cycle = parse<Cycle>(current.data);
        throw new PerformanceError(409, `Launch progress saved (${current._launch.cursor}/${cycle.employeeIds.length}). Choose Launch again to resume safely.`);
      }
      throw error;
    }
  }
}
