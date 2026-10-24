import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireAdmin } from '../../../middleware/auth';
import { repository } from '../../../storage/repository';
import schemas from '../../../storage/entity-schemas.json';
import { LeaveRulesEvaluator } from '../services/leaveRulesEvaluator';
import { LeaveError } from '../services/application.service';
import { nativeHandler as handler } from './native-shared';

const router = Router();
router.get('/types', handler(async (_req, res) => { res.json({ success: true, data: (await repository().find('leave_types', row => !!Number(row.isActive))).sort((a, b) => String(a.name).localeCompare(String(b.name))) }); }));
router.post('/types', requireAdmin, handler(async (req, res) => {
  const input = z.object({ name: z.string().trim().min(1).max(191), code: z.string().trim().min(1).max(50).optional() }).passthrough().parse(req.body);
  const allowed = new Set(Object.keys(schemas.leave_types.columns).filter(column => !['id', 'createdAt', 'updatedAt'].includes(column)));
  const values = Object.fromEntries(Object.entries(input).filter(([key]) => allowed.has(key)));
  const data = await repository().create('leave_types', { ...values, id: randomUUID(), name: input.name, code: input.code || `${input.name.slice(0, 3).toUpperCase()}${randomUUID().slice(0, 6)}`, color: input.color || '#2563eb' });
  res.status(201).json({ success: true, data });
}));
router.get('/years', handler(async (_req, res) => { res.json({ success: true, data: (await repository().find('leave_years', row => !!Number(row.isActive))).sort((a, b) => Number(b.year) - Number(a.year)) }); }));
router.get('/holidays', handler(async (req, res) => {
  const year = Number(req.query.year || new Date().getUTCFullYear());
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new LeaveError(400, 'Enter a valid calendar year.');
  const repo = repository();
  const [calendars, days, types] = await Promise.all([repo.find('holidaycalendar', row => Number(row.year) === year), repo.find('calendarday', () => true), repo.find('daytype', () => true)]);
  const holidays = days.filter(day => calendars.some(calendar=>day.holidayCalendarId===calendar.id&&(calendar.activeRevision?day.revision===calendar.activeRevision:!day.revision))).flatMap(day => {
    const type = types.find(type => type.id === day.dayTypeId);
    return type ? [{ id: day.id, date: day.date, name: type.name, dayType: type.type, color: type.displayColor }] : [];
  }).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  res.json({ success: true, data: { holidays } });
}));
for (const path of ['/workflows', '/company/settings', '/company/teams', '/attendance/shifts']) router.post(path, requireAdmin, (_req, res) => { res.status(501).json({ success: false, message: 'This legacy setup endpoint is unavailable; use the active HR configuration module.' }); });

const scripts = Router();
scripts.use(requireAdmin);
const ruleInput = z.object({ name: z.string().trim().min(1).max(191), description: z.string().max(4000).nullish(), content: z.string().max(20000), isDefault: z.union([z.boolean(), z.number()]).optional() });
scripts.get('/scripts', handler(async (_req, res) => { res.json((await repository().find('leave_rule_scripts', () => true)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))); }));
scripts.get('/scripts/:id', handler(async (req, res) => {
  const item = await repository().get('leave_rule_scripts', { id: String(req.params.id) });
  if (!item) throw new LeaveError(404, 'Script not found');
  res.json(item);
}));
scripts.post('/scripts', handler(async (req, res) => {
  const data = ruleInput.parse(req.body);
  // Compile the restricted grammar before saving; no application/server code is evaluated.
  LeaveRulesEvaluator.validateCustomScript(data.content);
  const saved=await repository().transaction(async tx=>{
    if(data.isDefault)for(const row of await tx.find('leave_rule_scripts',r=>Number(r.isDefault)===1))await tx.replace('leave_rule_scripts',{...row,isDefault:0});
    return tx.create('leave_rule_scripts',{...data,id:randomUUID(),isDefault:data.isDefault?1:0});
  });
  res.json(saved);
}));
scripts.put('/scripts/:id', handler(async (req, res) => {
  const data = ruleInput.parse(req.body);
  LeaveRulesEvaluator.validateCustomScript(data.content);
  const saved=await repository().transaction(async tx=>{
    const item=await tx.get('leave_rule_scripts',{id:String(req.params.id)});
    if(!item)throw new LeaveError(404,'Script not found');
    if(data.isDefault)for(const row of await tx.find('leave_rule_scripts',r=>Number(r.isDefault)===1&&r.id!==item.id))await tx.replace('leave_rule_scripts',{...row,isDefault:0});
    return tx.replace('leave_rule_scripts',{...item,...data,isDefault:data.isDefault?1:0});
  });
  res.json(saved);
}));
scripts.delete('/scripts/:id', handler(async (req, res) => {
  const item = await repository().get('leave_rule_scripts', { id: String(req.params.id) });
  if (!item) throw new LeaveError(404, 'Script not found');
  await repository().remove('leave_rule_scripts', { id: item.id }, item._version);
  res.json({ success: true });
}));
scripts.post('/scripts/test', handler(async (req, res) => {
  const data = z.object({ employeeId: z.string().min(1), leaveTypeId: z.string().min(1), leaveYear: z.coerce.number().int().min(2000).max(2100), scriptContent: z.string().max(20000).optional() }).parse(req.body);
  res.json(await LeaveRulesEvaluator.evaluate(data, data.scriptContent));
}));
router.use('/rules', scripts);
export default router;
