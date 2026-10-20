import { z } from 'zod';
import type { Actor, Assessment, Cycle, Review, Template } from './types';
import { descendants } from '../../shared/services/organization.service';

export class PerformanceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function ensure(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new PerformanceError(status, message);
}
export const idSchema = z.string().uuid();
const text = z.string().trim().min(1).max(500);
const longText = z.string().trim().max(10000);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, 'Enter a valid calendar date');
export const templateSchema = z.object({
  name: text, description: longText.default(''), goalWeight: z.number().min(5).max(95),
  competencies: z.array(z.object({ id: text, name: text, description: longText.default(''), weight: z.number().positive().max(95) })).min(1).max(20),
  questions: z.array(z.object({ id: text, section: text, prompt: text, required: z.boolean() })).min(1).max(40),
});
export const cycleSchema = z.object({
  name: text, description: longText.default(''), startDate: dateSchema, endDate: dateSchema,
  selfDeadline: dateSchema, managerDeadline: dateSchema, templateId: idSchema,
  employeeIds: z.array(idSchema).min(1).max(2000),
  feedbackRequired: z.boolean(), developmentRequired: z.boolean(),
});
export const librarySchema = z.object({
  title: text, measure: longText.refine(v => v.length > 0, 'A success measure is required'), weight: z.number().min(5).max(95),
  milestones: z.array(z.object({ id: text, title: text, weight: z.number().positive().max(100), complete: z.literal(false).default(false) })).max(30),
});
export const assessmentSchema = z.object({
  answers: z.record(longText), goalRatings: z.record(z.number().int().min(1).max(5)),
  competencyRatings: z.record(z.number().int().min(1).max(5)), comment: longText,
  overallRating: z.number().int().min(1).max(5).optional(),
});
export const checkinSchema = z.object({
  goalId: idSchema, progress: z.number().min(0).max(100), completedMilestoneIds: z.array(z.string()).max(30),
  comment: longText.refine(v => v.length > 0, 'Explain your progress'), blockers: longText.default(''), evidence: longText.default(''),
});
export const developmentSchema = z.object({
  id: idSchema.optional(), title: text, description: longText.default(''), ownerId: idSchema,
  dueDate: dateSchema, status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED']),
});
export const careerDirectionSchema = z.object({
  targetRole: z.string().trim().min(1).max(200),
  timeframe: z.string().trim().min(1).max(100),
  strengths: z.array(z.string().trim().min(1).max(120)).max(12),
  growthAreas: z.array(z.string().trim().min(1).max(120)).max(12),
  successEvidence: z.array(z.string().trim().min(1).max(120)).max(12),
});
export function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
export const equalWeight = (a: number, b: number) => Math.abs(a - b) < 0.001;
export function validateTemplate(t: Pick<Template, 'goalWeight' | 'competencies' | 'questions'>) {
  ensure(equalWeight(t.goalWeight + sum(t.competencies.map(c => c.weight)), 100), 'Goal and competency weights must total 100%.');
  ensure(new Set(t.competencies.map(c => c.id)).size === t.competencies.length, 'Competency IDs must be unique.');
  ensure(new Set(t.questions.map(q => q.id)).size === t.questions.length, 'Question IDs must be unique.');
}
export function validateCycle(c: Pick<Cycle, 'startDate' | 'endDate' | 'selfDeadline' | 'managerDeadline' | 'employeeIds'>) {
  ensure(c.startDate <= c.selfDeadline && c.selfDeadline <= c.managerDeadline && c.managerDeadline <= c.endDate,
    'Dates must be ordered: cycle start → self-assessment deadline → manager deadline → cycle end.');
  ensure(new Set(c.employeeIds).size === c.employeeIds.length, 'Select each employee only once.');
}
export const canManage = (a: Actor, r: Pick<Review, 'employeeId'>) =>
  a.employeeId !== r.employeeId && (a.admin || a.employees.some(e => e.id === r.employeeId && e.managerId === a.employeeId && !!a.employeeId));
export const canRead = (a: Actor, r: Pick<Review, 'employeeId'>) => a.admin || a.executive || a.employeeId === r.employeeId || descendants(a.employees, a.employeeId).includes(r.employeeId);
export function requireOpen(c: Cycle, r?: Review) {
  ensure(c.status === 'ACTIVE' && c.startDate <= today(), 'This cycle is not open. HR must launch it and its start date must be reached.', 409);
  ensure(!r?.closedAt, 'Closed reviews are read-only.', 409);
}
export function assessmentProblems(r: Review, a: Assessment): string[] {
  const problems: string[] = [];
  for (const q of r.template.questions) if (q.required && !a.answers[q.id]?.trim()) problems.push(`Answer: ${q.prompt}`);
  if (!a.comment.trim()) problems.push('Add an overall assessment comment.');
  for (const g of r.goals) if (!a.goalRatings[g.id]) problems.push(`Rate goal: ${g.title}`);
  for (const c of r.template.competencies) if (!a.competencyRatings[c.id]) problems.push(`Rate competency: ${c.name}`);
  return problems;
}
export function score(r: Review) {
  const goals = sum(r.goals.map(g => (r.manager.goalRatings[g.id] || 0) / 5 * g.weight));
  const competencies = sum(r.template.competencies.map(c => (r.manager.competencyRatings[c.id] || 0) / 5 * c.weight));
  return { goals: +goals.toFixed(2), competencies: +competencies.toFixed(2), total: +(goals + competencies).toFixed(2) };
}
export function progress(r: Review) {
  const weight = sum(r.goals.map(g => g.weight));
  return weight ? Math.round(sum(r.goals.map(g => g.progress * g.weight)) / weight) : 0;
}
export function closureProblems(c: Cycle, r: Review) {
  const problems: string[] = [];
  if (!r.self.sharedAt) problems.push('Employee must share their self-assessment.');
  if (!r.manager.sharedAt) problems.push('Manager must share their assessment.');
  if (r.manager.sharedAt) problems.push(...assessmentProblems(r, r.manager));
  if (c.feedbackRequired && (!r.feedback.length || r.feedback.some(f => f.status !== 'SUBMITTED'))) problems.push('All required 360° feedback must be received.');
  if (c.developmentRequired && !r.development.length) problems.push('Agree at least one development action.');
  if (!r.meetingDate) problems.push('Record the final review meeting.');
  return problems;
}
