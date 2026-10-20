export interface Employee {
  id: string; userId: string | null; name: string; employeeNumber: string;
  department: string; designation: string; managerId: string | null; managerName: string;
  active: boolean; organizationalRank?: string;
}
export interface Actor {
  userId: string; employeeId: string | null; admin: boolean; executive: boolean;
  employees: Employee[];
}
export interface Question { id: string; section: string; prompt: string; required: boolean }
export interface Competency { id: string; name: string; description: string; weight: number }
export interface Template {
  id: string; name: string; description: string; published: boolean;
  goalWeight: number; competencies: Competency[]; questions: Question[];
}
export interface Cycle {
  demo?: boolean;
  id: string; name: string; description: string; startDate: string; endDate: string;
  selfDeadline: string; managerDeadline: string; templateId: string; employeeIds: string[];
  feedbackRequired: boolean; developmentRequired: boolean;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED'; createdAt: string;
}
export interface Milestone { id: string; title: string; weight: number; complete: boolean }
export interface LibraryGoal {
  id: string; title: string; measure: string; weight: number; milestones: Milestone[];
}
export interface CheckIn { id: string; at: string; by: string; progress: number; comment: string; blockers: string }
export interface Goal extends LibraryGoal {
  libraryId: string; dueDate: string; progress: number; evidence: string; checkIns: CheckIn[];
}
export interface Assessment {
  answers: Record<string, string>; goalRatings: Record<string, number>;
  competencyRatings: Record<string, number>; comment: string; sharedAt: string | null;
  overallRating?: number;
}
export interface Feedback {
  id: string; reviewerId: string; relationship: string; dueDate: string;
  status: 'PENDING' | 'SUBMITTED' | 'DECLINED'; strengths: string; improvements: string;
  rating: number | null; submittedAt: string | null;
}
export interface DevelopmentAction {
  id: string; title: string; description: string; ownerId: string; dueDate: string;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED';
}
export interface CareerDirection {
  targetRole: string; timeframe: string; strengths: string[]; growthAreas: string[]; successEvidence: string[];
}
export interface Review {
  id: string; cycleId: string; employeeId: string; template: Template;
  goals: Goal[]; self: Assessment; manager: Assessment; feedback: Feedback[];
  development: DevelopmentAction[]; careerDirection?: CareerDirection; meetingDate: string | null; meetingNotes: string;
  closedAt: string | null; acknowledgedAt: string | null; finalScore: number | null;
  version: number; updatedAt: string;
}
export const emptyAssessment = (): Assessment => ({
  answers: {}, goalRatings: {}, competencyRatings: {}, comment: '', sharedAt: null,
});
