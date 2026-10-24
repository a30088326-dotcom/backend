import type { RowDataPacket } from 'mysql2';
import { db } from '../../lib/db';
import type { Actor } from './types';
import { canRead } from './rules';
import { repository } from '../../storage/repository';
import type { EntityName } from '../../storage/table-definitions';

// The pre-existing performance tables use a different workflow and identifiers.
// Keep their records intact and expose them as a scoped, read-only archive.
export async function historicalPerformance(actor: Actor) {
  if (process.env.DATABASE_PROVIDER === 'dynamodb') return nativeHistory(actor);
  const [cycles] = await db.query<RowDataPacket[]>(`SELECT id, name, description, start_date AS startDate,
    end_date AS endDate, status FROM performance_cycles ORDER BY start_date DESC`);
  const [reviews] = await db.query<RowDataPacket[]>(`SELECT id, performance_cycle_id AS cycleId,
    employee_id AS employeeId, reviewer_id AS reviewerId, self_assessment AS selfAssessment,
    manager_review AS managerReview, manager_score AS managerScore, employee_score AS employeeScore,
    status, submitted_at AS submittedAt, reviewed_at AS reviewedAt, closed_date AS closedAt
    FROM performance_reviews ORDER BY updated_at DESC`);
  const [goals] = await db.query<RowDataPacket[]>(`SELECT id, performance_cycle_id AS cycleId,
    employee_id AS employeeId, title, description, target, progress, status, category, priority,
    due_date AS dueDate, success_measurement AS successMeasurement
    FROM performance_goals ORDER BY updated_at DESC`);
  const [checkIns] = await db.query<RowDataPacket[]>(`SELECT id, goal_id AS goalId,
    check_in_date AS checkInDate, progress, status, comment, blocker, support_required AS supportRequired
    FROM performance_goal_checkins ORDER BY check_in_date DESC`);
  const [feedback] = await db.query<RowDataPacket[]>(`SELECT id, performance_cycle_id AS cycleId,
    employee_id AS employeeId, feedback, created_at AS createdAt
    FROM performance_feedback ORDER BY created_at DESC`);
  const [development] = await db.query<RowDataPacket[]>(`SELECT id, performance_cycle_id AS cycleId,
    employee_id AS employeeId, development_area AS area, action_plan AS actionPlan,
    target_date AS targetDate, status FROM performance_development_plans ORDER BY target_date DESC`);
  const allowed = (employeeId: string) => canRead(actor, { employeeId });
  const visibleReviews = reviews.filter(row => allowed(row.employeeId));
  const visibleGoals = goals.filter(row => allowed(row.employeeId));
  const visibleGoalIds = new Set(visibleGoals.map(row => row.id));
  const cycleIds = new Set([...visibleReviews, ...visibleGoals].map(row => row.cycleId));
  const employeeById = new Map(actor.employees.map(employee => [employee.id, employee]));
  const reviewerName = (id: string) => employeeById.get(id)?.name || '';
  return {
    cycles: cycles.filter(row => actor.admin || actor.executive || cycleIds.has(row.id)),
    reviews: visibleReviews.map(row => {
      const owner = actor.employeeId === row.employeeId;
      const managerShared = ['MANAGER_SHARED', 'READY_TO_CLOSE', 'CLOSED'].includes(row.status);
      const selfShared = !!row.submittedAt;
      const reviewer = actor.employeeId === row.reviewerId;
      const managerVisible = actor.admin || actor.executive || reviewer || managerShared;
      return { ...row,
        selfAssessment: owner || actor.admin || actor.executive || selfShared ? row.selfAssessment : null,
        managerReview: managerVisible ? row.managerReview : null,
        managerScore: managerVisible ? row.managerScore : null,
        employee: employeeById.get(row.employeeId) || null,
        reviewerName: reviewerName(row.reviewerId),
      };
    }),
    goals: visibleGoals.map(row => ({ ...row,
      employeeName: employeeById.get(row.employeeId)?.name || 'Employee',
    })),
    checkIns: checkIns.filter(row => visibleGoalIds.has(row.goalId)),
    feedback: feedback.filter(row => allowed(row.employeeId) &&
      (actor.admin || actor.executive || actor.employeeId !== row.employeeId ||
        visibleReviews.some(review => review.employeeId === row.employeeId && review.cycleId === row.cycleId && !!review.closedAt)))
      .map(row => ({ ...row,
      employeeName: employeeById.get(row.employeeId)?.name || 'Employee',
    })),
    development: development.filter(row => allowed(row.employeeId)).map(row => ({ ...row,
      employeeName: employeeById.get(row.employeeId)?.name || 'Employee',
    })),
  };
}

async function nativeHistory(actor: Actor) {
  const aliases: Record<string,string> = { start_date:'startDate', end_date:'endDate', performance_cycle_id:'cycleId', employee_id:'employeeId', reviewer_id:'reviewerId', self_assessment:'selfAssessment', manager_review:'managerReview', manager_score:'managerScore', employee_score:'employeeScore', submitted_at:'submittedAt', reviewed_at:'reviewedAt', closed_date:'closedAt', due_date:'dueDate', success_measurement:'successMeasurement', goal_id:'goalId', check_in_date:'checkInDate', support_required:'supportRequired', created_at:'createdAt', development_area:'area', action_plan:'actionPlan', target_date:'targetDate' };
  // Preserve the archive's selected-column privacy boundary. Full DynamoDB records
  // also contain private manager comments and feedback author identifiers.
  const fields: Partial<Record<EntityName, string[]>> = {
    performance_cycles: ['id','name','description','start_date','end_date','status'],
    performance_reviews: ['id','performance_cycle_id','employee_id','reviewer_id','self_assessment','manager_review','manager_score','employee_score','status','submitted_at','reviewed_at','closed_date'],
    performance_goals: ['id','performance_cycle_id','employee_id','title','description','target','progress','status','category','priority','due_date','success_measurement'],
    performance_goal_checkins: ['id','goal_id','check_in_date','progress','status','comment','blocker','support_required'],
    performance_feedback: ['id','performance_cycle_id','employee_id','feedback','created_at'],
    performance_development_plans: ['id','performance_cycle_id','employee_id','development_area','action_plan','target_date','status'],
  };
  const read = async (table: EntityName, order: string) => (await repository().find(table, () => true)).sort((a,b) => String(b[order] || '').localeCompare(String(a[order] || ''))).map(row => Object.fromEntries(fields[table]!.map(key => [aliases[key] || key,row[key]])));
  const [cycles,reviews,goals,checkIns,feedback,development] = await Promise.all([read('performance_cycles','start_date'),read('performance_reviews','updated_at'),read('performance_goals','updated_at'),read('performance_goal_checkins','check_in_date'),read('performance_feedback','created_at'),read('performance_development_plans','target_date')]);
  const allowed = (employeeId: string) => canRead(actor, { employeeId });
  const visibleReviews = reviews.filter(row => allowed(row.employeeId));
  const visibleGoals = goals.filter(row => allowed(row.employeeId));
  const goalIds = new Set(visibleGoals.map(row => row.id));
  const cycleIds = new Set([...visibleReviews,...visibleGoals].map(row => row.cycleId));
  const byId = new Map(actor.employees.map(employee => [employee.id,employee]));
  return { cycles:cycles.filter(row => actor.admin || actor.executive || cycleIds.has(row.id)),
    reviews:visibleReviews.map(row => { const managerVisible = actor.admin || actor.executive || actor.employeeId === row.reviewerId || ['MANAGER_SHARED','READY_TO_CLOSE','CLOSED'].includes(row.status); return { ...row, selfAssessment:actor.employeeId === row.employeeId || actor.admin || actor.executive || row.submittedAt ? row.selfAssessment : null, managerReview:managerVisible ? row.managerReview : null, managerScore:managerVisible ? row.managerScore : null, employee:byId.get(row.employeeId) || null, reviewerName:byId.get(row.reviewerId)?.name || '' }; }),
    goals:visibleGoals.map(row => ({ ...row,employeeName:byId.get(row.employeeId)?.name || 'Employee' })), checkIns:checkIns.filter(row => goalIds.has(row.goalId)),
    feedback:feedback.filter(row => allowed(row.employeeId) && (actor.admin || actor.executive || actor.employeeId !== row.employeeId || visibleReviews.some(review => review.employeeId === row.employeeId && review.cycleId === row.cycleId && !!review.closedAt))).map(row => ({ ...row,employeeName:byId.get(row.employeeId)?.name || 'Employee' })),
    development:development.filter(row => allowed(row.employeeId)).map(row => ({ ...row,employeeName:byId.get(row.employeeId)?.name || 'Employee' })) };
}
