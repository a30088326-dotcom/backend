import type { Actor, Cycle, LibraryGoal, Review, Template } from './types';
import { emptyAssessment } from './types';
import { canManage, canRead, closureProblems, ensure, progress, score } from './rules';
import * as store from './store';

export function publicReview(actor: Actor, review: Review, cycle: Cycle) {
  const copy = structuredClone(review);
  const own = actor.employeeId === review.employeeId;
  const privileged = actor.admin || actor.executive || canManage(actor, review);
  if (!own && !review.self.sharedAt) copy.self = emptyAssessment();
  if (!privileged && !review.manager.sharedAt) copy.manager = emptyAssessment();
  // Responses are attributed, not anonymous. Reviewer drafts are never persisted.
  copy.feedback = review.feedback.map(f => ({ ...f,
    reviewerId: privileged || f.reviewerId === actor.employeeId || review.closedAt ? f.reviewerId : '',
    strengths: privileged || f.reviewerId === actor.employeeId || review.closedAt ? f.strengths : '',
    improvements: privileged || f.reviewerId === actor.employeeId || review.closedAt ? f.improvements : '',
    rating: privileged || f.reviewerId === actor.employeeId || review.closedAt ? f.rating : null,
  }));
  return { ...copy, employee: actor.employees.find(e => e.id === review.employeeId), cycle,
    canManage: canManage(actor, review), isOwner: own, progress: progress(review),
    scores: privileged || review.manager.sharedAt ? score(review) : null,
    closureProblems: privileged ? closureProblems(cycle, review) : [],
  };
}
export async function reviewDetails(actor: Actor, id: string) {
  const review = await store.get<Review>('reviews', id);
  ensure(canRead(actor, review), 'You do not have access to this review.', 403);
  const cycle = await store.get<Cycle>('cycles', review.cycleId);
  ensure(cycle.status !== 'DRAFT' || actor.admin, 'Review not available.', 404);
  const history = await store.history(id);
  return { ...publicReview(actor, review, cycle), history };
}
export async function workspace(actor: Actor) {
  const [allCycles, allReviews, templates, library] = await Promise.all([
    store.list<Cycle>('cycles'), store.list<Review>('reviews'), store.list<Template>('templates'), store.list<LibraryGoal>('library'),
  ]);
  const cycleMap = new Map(allCycles.map(c => [c.id, c]));
  const visible = allReviews.filter(r => canRead(actor, r) && cycleMap.get(r.cycleId)?.status !== 'DRAFT');
  const cycleIds = new Set(visible.map(r => r.cycleId));
  const isManager = actor.employees.some(e => e.managerId === actor.employeeId && !!actor.employeeId);
  const invitations = allReviews.flatMap(r => r.feedback.filter(f => f.reviewerId === actor.employeeId).map(f => ({ ...f,
    reviewId: r.id, version: r.version, employeeName: actor.employees.find(e => e.id === r.employeeId)?.name || 'Employee',
    cycleName: cycleMap.get(r.cycleId)?.name || '', closed: !!r.closedAt,
    // The invited reviewer receives only the shared summary, never other reviews/ratings.
    managerComment: r.manager.sharedAt ? r.manager.comment : '',
  })));
  const notifications = await store.notifications(actor.userId);
  const cycles = allCycles.filter(c => actor.admin || (actor.executive && c.status !== 'DRAFT') || cycleIds.has(c.id))
    .map(c => ({ ...c, employeeIds: actor.admin || actor.executive ? c.employeeIds : c.employeeIds.filter(id => canRead(actor, { employeeId: id })) }));
  const reviews = visible.map(r => {
    const cycle = cycleMap.get(r.cycleId)!;
    const allowedScore = actor.admin || actor.executive || canManage(actor, r) || !!r.manager.sharedAt;
    return { id: r.id, cycleId: r.cycleId, employeeId: r.employeeId, employee: actor.employees.find(e => e.id === r.employeeId),
      cycleName: cycle.name, selfSharedAt: r.self.sharedAt, managerSharedAt: r.manager.sharedAt,
      closedAt: r.closedAt, acknowledgedAt: r.acknowledgedAt, progress: progress(r), goals: r.goals.length,
      dueDate: !r.self.sharedAt ? cycle.selfDeadline : !r.manager.sharedAt ? cycle.managerDeadline : cycle.endDate,
      score: allowedScore && r.manager.sharedAt ? (r.finalScore ?? score(r).total) : null,
      pendingFeedback: r.feedback.filter(f => f.status === 'PENDING').length,
      receivedFeedback: r.feedback.filter(f => f.status === 'SUBMITTED').length,
      developmentActions: r.development.length, completedActions: r.development.filter(d => d.status === 'COMPLETED').length,
      updatedAt: r.updatedAt, canManage: canManage(actor, r),
    };
  });
  return { actor: { employeeId: actor.employeeId, admin: actor.admin, executive: actor.executive, manager: isManager, rank:actor.employees.find(e=>e.id===actor.employeeId)?.organizationalRank },
    employees: actor.employees.filter(e => e.active && (canRead(actor, {employeeId:e.id})))
      .map(({ userId, ...e }) => ({ ...e, hasLogin: !!userId })),
    cycles, reviews, templates: actor.admin ? templates : templates.filter(t => t.published),
    library: actor.admin || actor.executive || isManager ? library : [], invitations, notifications };
}
