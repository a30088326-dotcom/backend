import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { Actor, Cycle, Review } from './types';
import { assessmentProblems, assessmentSchema, canManage, canRead, careerDirectionSchema, checkinSchema, closureProblems, dateSchema, developmentSchema, ensure, idSchema, requireOpen, score, sum, today } from './rules';
import * as store from './store';

const feedbackInviteSchema = z.object({ reviewerId: idSchema, relationship: z.string().trim().min(1).max(100), dueDate: dateSchema });
const feedbackAnswerSchema = z.object({ requestId: idSchema, strengths: z.string().trim().min(1).max(10000), improvements: z.string().trim().min(1).max(10000), rating: z.number().int().min(1).max(5) });
export async function changeReview(actor: Actor, id: string, input: unknown) {
  const request = z.object({ action: z.string(), version: z.number().int().positive(), payload: z.unknown().optional() }).parse(input);
  const initial = await store.get<Review>('reviews', id);
  // All writers lock cycle before review, preventing assignment/closure races.
  return store.transaction(async connection => {
    const cycle = await store.get<Cycle>('cycles', initial.cycleId, connection, true);
    const review = await store.get<Review>('reviews', id, connection, true);
    const { action, payload } = request;
    const reviewerAction = action === 'feedback-submit' || action === 'feedback-decline';
    ensure(canRead(actor, review) || (reviewerAction && review.feedback.some(f => f.reviewerId === actor.employeeId)), 'You do not have access to this review.', 403);
    ensure(review.version === request.version, 'This review changed in another session. Refresh it before saving.', 409);
    const owner = actor.employeeId === review.employeeId;
    const manage = canManage(actor, review);
    if (action === 'acknowledge') {
      ensure(owner && review.closedAt, 'Only the employee can acknowledge their closed review.', 403);
      ensure(!review.acknowledgedAt, 'Already acknowledged.', 409);
      review.acknowledgedAt = new Date().toISOString();
    } else {
      requireOpen(cycle, review);
      if (action === 'self-save' || action === 'manager-save') {
        const isSelf = action === 'self-save';
        ensure(isSelf ? owner : manage, 'You cannot write this assessment.', 403);
        const assessment = isSelf ? review.self : review.manager;
        ensure(!assessment.sharedAt, 'Shared assessments are locked.', 409);
        if (!isSelf) ensure(review.self.sharedAt, 'The employee must share their assessment first.', 409);
        const data = assessmentSchema.parse(payload);
        ensure(Object.keys(data.goalRatings).every(id => review.goals.some(g => g.id === id)), 'Unknown goal rating.');
        ensure(Object.keys(data.competencyRatings).every(id => review.template.competencies.some(c => c.id === id)), 'Unknown competency rating.');
        ensure(Object.keys(data.answers).every(id => review.template.questions.some(q => q.id === id)), 'Unknown assessment question.');
        Object.assign(assessment, data);
      } else if (action === 'self-share' || action === 'manager-share') {
        const isSelf = action === 'self-share';
        ensure(isSelf ? owner : manage, 'You cannot share this assessment.', 403);
        if (!isSelf) ensure(review.self.sharedAt, 'The employee must share their assessment first.', 409);
        const assessment = isSelf ? review.self : review.manager;
        ensure(!assessment.sharedAt, 'Assessment already shared.', 409);
        const problems = assessmentProblems(review, assessment); ensure(!problems.length, problems.join(' '));
        assessment.sharedAt = new Date().toISOString();
        const recipient = isSelf ? actor.employees.find(e => e.id === review.employeeId)?.managerId : review.employeeId;
        if (recipient) await store.notify(recipient, id, `${isSelf ? 'Self' : 'Manager'} assessment shared in ${cycle.name}.`, actor, connection);
      } else if (action === 'checkin') {
        ensure(owner || manage, 'Only the employee or their manager can add check-ins.', 403);
        const data = checkinSchema.parse(payload); const goal = review.goals.find(g => g.id === data.goalId);
        ensure(goal, 'Goal not found.', 404);
        ensure(data.completedMilestoneIds.every(id => goal.milestones.some(m => m.id === id)), 'Unknown milestone.');
        goal.milestones.forEach(m => { m.complete = data.completedMilestoneIds.includes(m.id); });
        goal.progress = goal.milestones.length ? sum(goal.milestones.filter(m => m.complete).map(m => m.weight)) : data.progress;
        goal.evidence = data.evidence;
        goal.checkIns.push({ id: randomUUID(), at: new Date().toISOString(), by: actor.userId, progress: goal.progress, comment: data.comment, blockers: data.blockers });
      } else if (action === 'feedback-invite') {
        ensure(manage, 'Only the reporting manager or HR can invite reviewers.', 403);
        ensure(review.manager.sharedAt, 'Share the manager assessment first.', 409);
        const data = feedbackInviteSchema.parse(payload);
        ensure(data.reviewerId !== review.employeeId && actor.employees.some(e => e.id === data.reviewerId && e.active && e.userId), 'Choose another active employee with a login.');
        ensure(review.feedback.length < 5, 'A maximum of five reviewers can be invited.');
        ensure(!review.feedback.some(f => f.reviewerId === data.reviewerId), 'This reviewer was already invited.', 409);
        ensure(data.dueDate >= today() && data.dueDate <= cycle.endDate, 'Feedback due date must be today or later, within this cycle.');
        review.feedback.push({ ...data, id: randomUUID(), status: 'PENDING', strengths: '', improvements: '', rating: null, submittedAt: null });
        await store.notify(data.reviewerId, id, `360° feedback requested for ${actor.employees.find(e => e.id === review.employeeId)?.name || 'an employee'}.`, actor, connection);
      } else if (action === 'feedback-withdraw') {
        ensure(manage, 'Only the reporting manager or HR can withdraw an unanswered request.', 403);
        const data = z.object({ requestId: idSchema }).parse(payload);
        const feedback = review.feedback.find(f => f.id === data.requestId);
        ensure(feedback, 'Feedback request not found.', 404);
        ensure(feedback.status !== 'SUBMITTED', 'Submitted feedback cannot be withdrawn.', 409);
        review.feedback = review.feedback.filter(f => f.id !== data.requestId);
        await store.notify(feedback.reviewerId, id, `The 360° feedback request for ${cycle.name} has been withdrawn.`, actor, connection);
      } else if (reviewerAction) {
        const data = action === 'feedback-submit' ? feedbackAnswerSchema.parse(payload) : z.object({ requestId: idSchema }).parse(payload);
        const feedback = review.feedback.find(f => f.id === data.requestId);
        ensure(feedback && feedback.reviewerId === actor.employeeId, 'Only the invited reviewer can respond.', 403);
        ensure(feedback.status === 'PENDING', 'This feedback request has already been answered.', 409);
        if (action === 'feedback-submit') Object.assign(feedback, feedbackAnswerSchema.parse(payload), { status: 'SUBMITTED', submittedAt: new Date().toISOString() });
        else feedback.status = 'DECLINED';
      } else if (action === 'development') {
        ensure(owner || manage, 'You cannot change this development plan.', 403);
        const data = developmentSchema.parse(payload);
        const managerId = actor.employees.find(e => e.id === review.employeeId)?.managerId;
        ensure([review.employeeId, managerId].includes(data.ownerId), 'Action owner must be the employee or reporting manager.');
        if (data.id) { const existing = review.development.find(d => d.id === data.id); ensure(existing, 'Action not found.', 404); Object.assign(existing, data); }
        else review.development.push({ ...data, id: randomUUID() });
      } else if (action === 'career-direction') {
        ensure(owner || manage, 'You cannot change this career direction.', 403);
        review.careerDirection = careerDirectionSchema.parse(payload);
      } else if (action === 'meeting') {
        ensure(manage, 'Only the manager or HR can record the review meeting.', 403);
        const data = z.object({ date: dateSchema, notes: z.string().trim().min(1).max(10000) }).parse(payload);
        ensure(data.date >= cycle.startDate && data.date <= today(), 'Record a meeting held between the cycle start and today.');
        review.meetingDate = data.date; review.meetingNotes = data.notes;
      } else if (action === 'close') {
        ensure(manage, 'Only the manager or HR can close this review.', 403);
        const problems = closureProblems(cycle, review); ensure(!problems.length, problems.join(' '), 409);
        review.finalScore = score(review).total; review.closedAt = new Date().toISOString();
        await store.notify(review.employeeId, id, `Your ${cycle.name} review is closed and ready for acknowledgement.`, actor, connection);
      } else if (action === 'remind') {
        ensure(manage, 'Only the manager or HR can send reminders.', 403);
        const [recent] = await connection.query<any[]>('SELECT id FROM hr_performance_audit WHERE entity_id = ? AND event = ? AND at > DATE_SUB(NOW(), INTERVAL 1 DAY)', [id, 'REMIND']);
        ensure(!recent.length, 'A reminder has already been sent in the last 24 hours.', 409);
        if (!review.self.sharedAt) await store.notify(review.employeeId, id, `Reminder: share your self-assessment for ${cycle.name} (due ${cycle.selfDeadline}).`, actor, connection);
        else if (!review.manager.sharedAt) {
          const managerId = actor.employees.find(e => e.id === review.employeeId)?.managerId;
          ensure(managerId, 'Assign a reporting manager in Employee Information first.');
          await store.notify(managerId, id, `Reminder: manager assessment due ${cycle.managerDeadline} for ${cycle.name}.`, actor, connection);
        } else for (const f of review.feedback.filter(f => f.status === 'PENDING')) await store.notify(f.reviewerId, id, `Reminder: 360° feedback requested by ${f.dueDate}.`, actor, connection);
      } else ensure(false, 'Unknown review action.');
    }
    review.version++; review.updatedAt = new Date().toISOString();
    await store.save('reviews', review, connection); await store.audit(id, actor, action.toUpperCase().replace(/-/g, '_'), connection);
    return { id: review.id, version: review.version };
  });
}
