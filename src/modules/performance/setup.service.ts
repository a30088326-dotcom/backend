import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { Actor, Cycle, LibraryGoal, Review, Template } from './types';
import { emptyAssessment } from './types';
import { cycleSchema, dateSchema, ensure, idSchema, librarySchema, sum, equalWeight, templateSchema, validateCycle, validateTemplate } from './rules';
import * as store from './store';

export async function saveTemplate(actor: Actor, input: unknown, id?: string) {
  ensure(actor.admin, 'Only HR administrators can configure templates.', 403);
  const data = templateSchema.parse(input); validateTemplate(data);
  return store.transaction(async connection => {
    if (id) { const old = await store.get<Template>('templates', id, connection, true); ensure(!old.published, 'Published templates are locked. Create a new version.', 409); }
    const template: Template = { ...data, id: id || randomUUID(), published: false };
    await store.save('templates', template, connection, !id);
    await store.audit(template.id, actor, id ? 'TEMPLATE_UPDATED' : 'TEMPLATE_CREATED', connection);
    return template;
  });
}
export async function publishTemplate(actor: Actor, id: string) {
  ensure(actor.admin, 'Only HR administrators can publish templates.', 403);
  return store.transaction(async connection => {
    const template = await store.get<Template>('templates', id, connection, true);
    validateTemplate(template); template.published = true;
    await store.save('templates', template, connection); await store.audit(id, actor, 'TEMPLATE_PUBLISHED', connection);
    return template;
  });
}
export async function deleteTemplate(actor: Actor, id: string) {
  ensure(actor.admin, 'Only HR administrators can delete templates.', 403);
  return store.transaction(async connection => {
    await store.get<Template>('templates', id, connection, true);
    await connection.query('DELETE FROM hr_performance_templates WHERE id = ?', [id]);
    await store.audit(id, actor, 'TEMPLATE_DELETED', connection);
    return { deleted: true };
  });
}
export async function saveCycle(actor: Actor, input: unknown, id?: string) {
  ensure(actor.admin, 'Only HR administrators can configure review cycles.', 403);
  const data = cycleSchema.parse(input); validateCycle(data);
  ensure(data.employeeIds.every(id => actor.employees.some(e => e.id === id && e.active)), 'Only active employees can participate.');
  await store.get<Template>('templates', data.templateId);
  return store.transaction(async connection => {
    const old = id ? await store.get<Cycle>('cycles', id, connection, true) : null;
    ensure(!old || old.status === 'DRAFT', 'Only draft cycles can be edited.', 409);
    const cycle: Cycle = { ...data, ...(old?.demo ? { demo: true } : {}), id: id || randomUUID(), status: 'DRAFT', createdAt: old?.createdAt || new Date().toISOString() };
    await store.save('cycles', cycle, connection, !id); await store.audit(cycle.id, actor, id ? 'CYCLE_UPDATED' : 'CYCLE_CREATED', connection);
    return cycle;
  });
}
export async function transitionCycle(actor: Actor, id: string, action: string) {
  ensure(actor.admin, 'Only HR administrators can change cycle status.', 403);
  return store.transaction(async connection => {
    const cycle = await store.get<Cycle>('cycles', id, connection, true);
    if (action === 'launch') {
      ensure(cycle.status === 'DRAFT', 'Only a draft cycle can be launched.', 409);
      validateCycle(cycle);
      const template = await store.get<Template>('templates', cycle.templateId, connection);
      ensure(template.published, 'Publish the template first.'); validateTemplate(template);
      // Existing launched reviews keep their immutable question snapshot. New reviews
      // use the current four-section form even when an older template had Development.
      const reviewTemplate = { ...template, questions: template.questions.filter(question => !/^development$/i.test(question.section.trim())) };
      ensure(reviewTemplate.questions.length > 0, 'Add a question outside the removed Development section before launching.');
      ensure(cycle.employeeIds.every(id => actor.employees.some(e => e.id === id && e.active)), 'Remove inactive or deleted employees before launching.');
      for (const employeeId of cycle.employeeIds) {
        const review: Review = { id: randomUUID(), cycleId: id, employeeId, template: reviewTemplate, goals: [], self: emptyAssessment(), manager: emptyAssessment(),
          feedback: [], development: [], meetingDate: null, meetingNotes: '', closedAt: null, acknowledgedAt: null,
          finalScore: null, version: 1, updatedAt: new Date().toISOString() };
        await store.save('reviews', review, connection, true);
        await store.audit(review.id, actor, 'REVIEW_ASSIGNED', connection);
        await store.notify(employeeId, review.id, `You have been included in ${cycle.name}. Tasks open on ${cycle.startDate}.`, actor, connection);
      }
      cycle.status = 'ACTIVE';
    } else if (action === 'close') {
      ensure(cycle.status === 'ACTIVE', 'Only an active cycle can be closed.', 409);
      const reviews = (await store.list<Review>('reviews', connection)).filter(r => r.cycleId === id);
      ensure(reviews.length > 0 && reviews.every(r => r.closedAt), 'Close every employee review before closing the cycle.', 409);
      cycle.status = 'CLOSED';
    } else if (action === 'archive') {
      ensure(cycle.status === 'CLOSED', 'Only closed cycles can be archived.', 409); cycle.status = 'ARCHIVED';
    } else if (action === 'delete') {
      await connection.query('DELETE n FROM hr_performance_notifications n INNER JOIN hr_performance_reviews r ON n.review_id = r.id WHERE r.cycle_id = ?', [id]);
      await connection.query('DELETE a FROM hr_performance_audit a INNER JOIN hr_performance_reviews r ON a.entity_id = r.id WHERE r.cycle_id = ?', [id]);
      await connection.query('DELETE FROM hr_performance_reviews WHERE cycle_id = ?', [id]);
      await connection.query('DELETE FROM hr_performance_audit WHERE entity_id = ?', [id]);
      await connection.query('DELETE FROM hr_performance_cycles WHERE id = ?', [id]);
      return { deleted: true };
    } else ensure(false, 'Unknown cycle action.');
    await store.save('cycles', cycle, connection); await store.audit(id, actor, `CYCLE_${action.toUpperCase()}`, connection);
    return cycle;
  });
}
export async function saveLibraryGoal(actor: Actor, input: unknown, id?: string) {
  ensure(actor.admin, 'Only HR administrators can edit the common goal library.', 403);
  const data = librarySchema.parse(input);
  ensure(!data.milestones.length || equalWeight(sum(data.milestones.map(m => m.weight)), 100), 'Milestone weights must total 100%.');
  ensure(new Set(data.milestones.map(m => m.id)).size === data.milestones.length, 'Milestone IDs must be unique.');
  return store.transaction(async connection => {
    if (id) await store.get('library', id, connection, true);
    const goal: LibraryGoal = { ...data, id: id || randomUUID() };
    await store.save('library', goal, connection, !id); await store.audit(goal.id, actor, id ? 'LIBRARY_GOAL_UPDATED' : 'LIBRARY_GOAL_CREATED', connection);
    return goal;
  });
}
export async function deleteLibraryGoal(actor: Actor, id: string) {
  ensure(actor.admin, 'Only HR administrators can delete goals from the library.', 403);
  return store.transaction(async connection => {
    await store.get('library', id, connection, true);
    await connection.query('DELETE FROM hr_performance_library WHERE id = ?', [id]);
    await store.audit(id, actor, 'LIBRARY_GOAL_DELETED', connection);
    return { deleted: true };
  });
}
const assignSchema = z.object({ cycleId: idSchema, goalIds: z.array(idSchema).min(1).max(30), employeeIds: z.array(idSchema).min(1).max(2000), dueDate: dateSchema });
export async function assignGoals(actor: Actor, input: unknown) {
  const data = assignSchema.parse(input);
  ensure(new Set(data.goalIds).size === data.goalIds.length && new Set(data.employeeIds).size === data.employeeIds.length, 'Duplicate assignments are not allowed.');
  return store.transaction(async connection => {
    const cycle = await store.get<Cycle>('cycles', data.cycleId, connection, true);
    ensure(cycle.status === 'ACTIVE', 'Launch the cycle before assigning goals.', 409);
    ensure(data.dueDate >= cycle.startDate && data.dueDate <= cycle.endDate && /^\d{4}-\d{2}-\d{2}$/.test(data.dueDate), 'Goal due date must be within the cycle.');
    const goals = await Promise.all(data.goalIds.map(id => store.get<LibraryGoal>('library', id, connection)));
    const reviews = (await store.list<Review>('reviews', connection)).filter(r => r.cycleId === cycle.id && data.employeeIds.includes(r.employeeId));
    ensure(reviews.length === data.employeeIds.length, 'Every selected employee must be in this cycle.');
    for (const review of reviews) {
      const employee = actor.employees.find(e => e.id === review.employeeId);
      ensure(actor.admin || (!!actor.employeeId && (employee?.managerId === actor.employeeId || employee?.id === actor.employeeId)), 'You can assign goals only to your direct reports or yourself.', 403);
      ensure(!review.closedAt && !review.self.sharedAt && !review.manager.sharedAt, 'Goals are locked once an assessment is shared.', 409);
      ensure(!review.goals.some(g => data.goalIds.includes(g.libraryId)), 'One or more goals are already assigned to this employee.', 409);
      review.goals.push(...goals.map(g => ({ ...g, id: randomUUID(), libraryId: g.id, dueDate: data.dueDate, progress: 0, evidence: '', checkIns: [] })));
      review.version++; review.updatedAt = new Date().toISOString();
      await store.save('reviews', review, connection); await store.audit(review.id, actor, 'GOALS_ASSIGNED', connection);
      await store.notify(review.employeeId, review.id, `${goals.length} goal(s) assigned in ${cycle.name}.`, actor, connection);
    }
    return { assigned: reviews.length * goals.length };
  });
}
