import type { RowDataPacket } from 'mysql2';
import { db } from '../../lib/db';
import type { Actor } from './types';
import { canRead } from './rules';

// The pre-existing performance tables use a different workflow and identifiers.
// Keep their records intact and expose them as a scoped, read-only archive.
export async function historicalPerformance(actor: Actor) {
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
