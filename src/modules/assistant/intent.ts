import { localToday } from '../../shared/services/dashboard.service';
import { parseMonth } from './month';
export interface Intent { tool: string; args: Record<string, unknown>; interpretedAs?: string; corrected?: boolean; }
const clean = (s: string) => s.trim().replace(/[.!?]+$/, '').replace(/^["']|["']$/g, '').trim();
const day = (n: number) => new Date(Date.parse(`${localToday()}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const aliases: Record<string, string> = { mata: 'my', mage: 'my', pennanna: 'show', balanna: 'view', danna: 'apply', karanna: 'make', yawanna: 'send', denna: 'give', ain: 'remove', wena: 'change', tiyanawada: 'any', tika: 'all', monawada: 'what', tiyenne: 'have', kawda: 'who', eka: '', ekak: '', ta: '', ge: '', ekata: '', yata: 'under',
  leaves: 'leave', leav: 'leave', leve: 'leave', keave: 'leave', yo: 'you', reqest: 'request', requst: 'request', requset: 'request',
  shw: 'show', vie: 'view', mny: 'many', hav: 'have', balan: 'balance', mnth: 'month', aply: 'apply',
  onbord: 'onboard', onbording: 'onboarding', invte: 'invite', documnt: 'document',
  reporing: 'reporting', reportng: 'reporting', manger: 'manager', managr: 'manager',
  attendence: 'attendance', attandance: 'attendance', perfomance: 'performance', performence: 'performance',
  employe: 'employee', employes: 'employees', aproove: 'approve', aprove: 'approve',
  permision: 'permission', permissons: 'permissions', departmant: 'department', designtion: 'designation',
  tomorow: 'tomorrow', mondaye: 'monday', tuseday: 'tuesday', wensday: 'wednesday',
  thurday: 'thursday', firday: 'friday', saterday: 'saturday', sundey: 'sunday',
};
const vocabulary = [
  'leave','balance','remaining','available','request','requests','apply','cancel','approve','reject','approval','pending','history','status',
  'reporting','manager','team','direct','reports','employee','employees','profile','department','designation','organization','company',
  'attendance','correction','exception','roster','performance','review','reviews','assessment','goal','goals','feedback','cycle','template',
  'permission','permissions','access','user','users','account','password','onboard','onboarding','invite','invitation','document','documents','verification','dashboard','summary',
  'show','view','list','find','search','open','create','change','update','move','give','remove','enable','disable','export','rename','mark','clock','punch',
  'have','many','much','want','need','submit','take','next','today','tomorrow','month','annual','casual','sick','medical','maternity','paternity','monday','tuesday','wednesday','thursday','friday','saturday','sunday',
];
const vocabularySet = new Set(vocabulary);
function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
function correctWord(word: string) {
  const lower = word.toLowerCase();
  if (aliases[lower]) return aliases[lower];
  if (vocabularySet.has(lower)) return lower;
  if (lower.length < 4 || !/^[a-z]+$/.test(lower)) return word;
  // Four-letter English words are too easy to change into another valid word
  // (for example, "what" -> "want"), so short mistakes use explicit aliases.
  const limit = lower.length >= 7 ? 2 : lower.length >= 5 ? 1 : 0;
  let best = lower; let bestDistance = limit + 1;
  for (const candidate of vocabulary) {
    if (Math.abs(candidate.length - lower.length) > limit) continue;
    const score = distance(lower, candidate);
    if (score < bestDistance) { best = candidate; bestDistance = score; }
  }
  return bestDistance <= limit ? best : word;
}
/** Normalize command words; captured names and reasons are extracted from original text. */
export function normalizeIntentText(input: string) {
  const basic = clean(input).normalize('NFKC').replace(/[“”]/g, '"').replace(/[’]/g, "'").replace(/\s+/g, ' ');
  let spellingAdjusted = false;
  const corrected = basic.replace(/\b[A-Za-z]+\b/g, word => {
    const next = correctWord(word);
    if (next.toLowerCase() !== word.toLowerCase() && word.toLowerCase() !== 'leaves') spellingAdjusted = true;
    return next;
  });
  return { text: corrected, corrected: spellingAdjusted };
}

const labels: Record<string, string> = {
  'leave.balance': 'view your leave balance', 'leave.apply': 'apply for leave', 'leave.requests': 'view your leave requests',
  'leave.pending': 'view leave awaiting your approval', 'leave.cancel': 'cancel a leave request', 'leave.decide': 'approve or reject leave',
  'reporting.myManager': 'view your reporting manager', 'reporting.team': 'view your reporting team',
  'attendance.mine': 'view your attendance', 'attendance.team': 'view team attendance', 'attendance.correction': 'request an attendance correction', 'attendance.punch': 'mark your attendance',
  'help.capabilities': 'show available actions', 'leave.team': 'view team leave requests', 'requests.pending': 'view requests awaiting your review',
  'performance.review': 'open a performance review', 'performance.summary': 'view performance review progress',
  'self.profile': 'view your profile', 'employee.search': 'find permitted employees', 'navigation.open': 'open a Peoples Management page',
};
const intent = (tool: string, args: Record<string, unknown> = {}, corrected = false): Intent => ({ tool, args, corrected, interpretedAs: labels[tool] });
function dates(message: string) {
  const iso = message.match(/\b\d{4}-\d{2}-\d{2}\b/g);
  if (iso) return { startDate: iso[0], endDate: iso[1] || iso[0] };
  if (/\btomorrow\b/i.test(message)) return { startDate: day(1), endDate: day(1) };
  if (/\byesterday\b/i.test(message)) return { startDate: day(-1), endDate: day(-1) };
  if (/\btoday\b/i.test(message)) return { startDate: day(0), endDate: day(0) };
  const weekday = message.match(/\b(?:next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (weekday) {
    const wanted = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].indexOf(weekday[1].toLowerCase());
    const current = new Date(`${localToday()}T12:00:00Z`).getUTCDay();
    const offset = (wanted - current + 7) % 7 || 7;
    return { startDate: day(offset), endDate: day(offset) };
  }
  const months = 'january february march april may june july august september october november december'.split(' ');
  const match = message.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:\s*(?:to|through|-)\s*(\d{1,2}))?(?:,?\s+(20\d{2}))?/i);
  if (match) { const prefix = `${match[4] || localToday().slice(0, 4)}-${String(months.indexOf(match[1].toLowerCase()) + 1).padStart(2, '0')}-`; return { startDate: prefix + match[2].padStart(2, '0'), endDate: prefix + (match[3] || match[2]).padStart(2, '0') }; }
  return {};
}
const month = parseMonth;
/** Deterministic English routing; unknown/ambiguous instructions collect details, never guess a write. */
export function understand(input: string, selectedEmployeeId?: string): Intent | null {
  const normalized = normalizeIntentText(input);
  const m = normalized.text.replace(/^(please|can you|could you|would you)\s+/i, '');
  const found = (tool: string, args: Record<string, unknown> = {}) => intent(tool, args, normalized.corrected);
  let x: RegExpMatchArray | null;

  if (/^(?:approve|reject)\s+(?:the\s+)?(?:first|second|third|fourth|fifth|\d+)(?:\s+one)?$/i.test(m)) {
    const isApprove = /^approve/i.test(m);
    const num = m.match(/\d+/) ? parseInt(m.match(/\d+/)![0], 10) :
                /first/i.test(m) ? 1 : /second/i.test(m) ? 2 : /third/i.test(m) ? 3 : /fourth/i.test(m) ? 4 : /fifth/i.test(m) ? 5 : 1;
    return found('requests.resolve', { action: isApprove ? 'approve' : 'reject', index: num });
  }
  if (/^(?:requests|pending|approve\s+\d+|reject\s+\d+|leave|balance|manager|attendance|performance|onboarding|team|roster)$/i.test(m)) {
    if (/requests|pending/i.test(m)) return found('requests.pending');
    if (/leave/i.test(m)) return found('leave.balance');
    if (/balance/i.test(m)) return found('leave.balance');
    if (/manager/i.test(m)) return found('reporting.myManager');
    if (/attendance/i.test(m)) return found('attendance.mine', { month: day(0).slice(0, 7) });
    if (/performance/i.test(m)) return found('performance.summary');
    if (/onboarding/i.test(m)) return found('onboarding.invites');
    if (/team/i.test(m)) return found('reporting.team');
    if (/roster/i.test(m)) return found('attendance.team');
  }
  if (/^employee\s+(.+)$/i.test(m)) { const match = m.match(/^employee\s+(.+)$/i); return found('employee.search', { query: match ? clean(match[1]) : '' }); }
  // A leave request mentioning its approver is not a request to change that manager.
  if (!/\bleave\b/i.test(m) && !/\b(?:who|my|show|view|find|reporting)\b/i.test(m) && /^(.+)\s+manager$/i.test(m)) { const match = input.match(/^(.+)\s+manager[.!?]?$/i); return found('reporting.changeManager', { employee: match ? clean(match[1]) : '', manager: '' }); }
  if (/^(.+)\s+department$/i.test(m)) { const match = m.match(/^(.+)\s+department$/i); return found('employee.changeOrganization', { employee: match ? clean(match[1]) : '', field: 'department', value: '' }); }
  if (/^(today|yesterday|tomorrow)\s+attendance$/i.test(m)) return found('attendance.mine', { month: day(0).slice(0, 7) });
  if (/^pending\s+leave$/i.test(m)) return found('leave.pending');
  if (/^my\s+review$/i.test(m)) return found('performance.review', { employee: 'me' });

  if (/\b(?:complete|finish|activate)\b.*\b(?:onboarding|candidate)\b/i.test(m)) return found('onboarding.complete');
  if (/\bresend\b.*\b(?:invite|invitation|onboarding)\b/i.test(m)) return found('onboarding.resend',{...(input.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)?.[0]?{email:input.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)![0].replace(/[.,]$/,'')}:{})});
  if (/\b(?:update|edit|change)\b.*\bemployee\b.*\b(?:details|information|profile)\b/i.test(m)) return found('employee.updateDetails');
  if (/\b(?:create|new)\b.*\beim\b.*\b(?:table|module)\b/i.test(m)) return found('eim.createCollection');
  if (/\b(?:show|view|open)\b.*\beim\b.*\btable\b/i.test(m)) return found('eim.viewCollection');
  if (/\badd\b.*\beim\b.*\brecord\b/i.test(m)) return found('eim.addCollectionRecord');
  if (/\b(?:delete|remove)\b.*\bemployee\b/i.test(m)) return found('employee.delete',{...(input.match(/\bEMP[- ]\d+\b/i)?.[0]?{employeeNumber:input.match(/\bEMP[- ]\d+\b/i)![0].replace(' ','-')}:{})});
  if (/\b(?:prepare|create|send)\b.*\b(?:agreement|contract)\b/i.test(m)) return found('onboarding.agreement', { ...(input.match(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] ? {email:input.match(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)![0]} : {}) });
  if ((x = input.match(/^(?:please\s+)?(?:give|grant)\s+(.+?)\s+full access to\s+(.+?)[.!?]?$/i))) {
    const names:Record<string,string>={'onboarding':'onboarding','document verification':'document_verification','performance':'performance_management','employee information':'employee_information','attendance':'attendance_management','attendance roster':'attendance_management','eim':'eim_admin','eim admin':'eim_admin','reporting hierarchy':'reporting_hierarchy','leave management':'leave_management','leave approval':'leave_approval','dashboard':'reports_analytics','self service':'self_service'};
    return found('users.grantModule',{employee:clean(x[1]),...(names[x[2].toLowerCase()]?{module:names[x[2].toLowerCase()]}:{})});
  }
  if (/\b(?:create|add|new)\b.*\b(?:performance )?goal\b/i.test(m)) return found('performance.createGoal');
  if (/\b(?:assign|give)\b.*\bgoal\b/i.test(m)) return found('performance.assignGoal');
  if (/\b(?:create|add|new)\b.*\bshift\b/i.test(m)) return found('attendance.createShift');
  if (/\b(?:assign|give|change)\b.*\broster\b/i.test(m)) return found('attendance.assignRoster');
  if (/\b(?:joke|bored|funny)\b/i.test(m)) return found('help.chat', { topic: 'joke' });
  if (/^(?:hi|hello|hey|how are you|thanks|thank you)$/i.test(m)) return found('help.chat', { topic: m });
  if (/\b(?:onboard|invite)\b/i.test(m) && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(input)) {
    const email = input.match(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0];
    const name = input.replace(email || '', '').replace(/^(?:please\s+)?(?:onboard|invite)\s+(?:(?:a|an)\s+)?(?:(?:new\s+)?employee\s+)?/i, '').replace(/\b(?:email|named|called)\b\s*:?/gi, '').replace(/[,<>:]+/g, ' ').trim();
    return found('onboarding.invite', { ...(email ? { email } : {}), ...(name ? { name } : {}) });
  }
  if (/^(?:help|hi|hello|hey)$|\bwhat can (?:you|u) do\b|\b(?:your capabilities|available actions|what do you do)\b/i.test(m)) return found('help.capabilities');
  if (/\bwhat is my (?:designation|department|employee number)\b/i.test(m)) return found('self.profile');
  if (/\b(change|update|reset)\b.*\b(username|user name|email|login)\b|\b(?:employee|user)\b.*\b(username|user name|email|login)\b/i.test(m)) return { tool: 'users.updateCredentials', args: {} };
  if (/\b(passwords?|credentials?)\b/i.test(m)) {
    if (/\bmy\b/i.test(m) || /account/i.test(m) || /^(?:please )?(?:change|update|reset) (?:the )?(?:password|credential)s?$/i.test(m)) return found('account.password');
    return { tool: 'users.updateCredentials', args: {} };
  }
  if (/\b(add|create)\b.*\bbutton\b/i.test(m)) {
    const label = m.match(/button (?:called|named) ["']?(.+?)["']?(?: to | in | on |$)/i)?.[1];
    return { tool: 'builder.addButton', args: { ...( /eim|department/i.test(m) ? { page: 'eim' } : {}), ...(label ? { label: clean(label) } : /export.*department/i.test(m) ? { label: 'Export departments' } : {}), ...(/department/i.test(m) ? { action: 'eim.exportDepartments', arguments: {} } : {}) } };
  }
  if (/\b(add|create)\b.*\bfield\b/i.test(m)) { const label = m.match(/field (?:called|named) (.+)/i)?.[1]; return { tool: 'builder.addField', args: label ? { label: clean(label), name: clean(label).toLowerCase().replace(/[^a-z0-9]+/g, '_'), type: 'Text', employeeVisible: false } : {} }; }
  if (/\b(roll ?back|undo)\b.*\b(builder|extension|button|field|change)\b/i.test(m)) return { tool: 'builder.rollback', args: {} };
  if (/^(?:how (?:do|can)|what is|where (?:do|can))\b/i.test(m) && !/how (?:much|many)|my manager/i.test(m)) return { tool: 'help.guide', args: { topic: m } };
  if (/\b(who|show|view|find)\b.*\bmy (?:reporting )?manager\b|\bmy (?:reporting )?manager\b.*\b(who|show|view|find)\b/i.test(m)) return found('reporting.myManager');
  if (/^(?:who reports to me|show my team|show my direct reports|my reporting team)$/i.test(m)) return found('reporting.team');
  if (/without (?:a |valid )?(?:manager|login)|broken mappings|incomplete mappings/i.test(m)) return { tool: 'employee.diagnostics', args: {} };
  if ((x = m.match(/^make (.+?) report to (.+)$/i))) return { tool: 'reporting.changeManager', args: { employee: clean(x[1]), manager: clean(x[2]), effectiveDate: localToday() } };
  if ((x = m.match(/^change (.+?)(?:'s|’s) (?:reporting )?manager to (.+)$/i))) return { tool: 'reporting.changeManager', args: { employee: clean(x[1]), manager: clean(x[2]), effectiveDate: localToday() } };
  if ((x = m.match(/^change (?:his|her|their) (?:reporting )?manager to (.+)$/i))) return { tool: 'reporting.changeManager', args: { employee: selectedEmployeeId, manager: clean(x[1]), effectiveDate: localToday() } };
  if ((x = m.match(/^move (.+?) to (.+)$/i))) return { tool: 'employee.changeOrganization', args: { employee: /^(him|her|them)$/i.test(x[1]) ? selectedEmployeeId : clean(x[1]), field: 'department', value: clean(x[2]) } };
  if ((x = m.match(/^change (.+?)(?:'s|’s) (department|designation) to (.+)$/i))) return { tool: 'employee.changeOrganization', args: { employee: clean(x[1]), field: x[2].toLowerCase(), value: clean(x[3]) } };
  if ((x = m.match(/^create (?:a |an |new )?(department|designation)(?: (?:called|named))?(?: (.+))?$/i))) return { tool: 'eim.create', args: { kind: x[1].toLowerCase(), ...(x[2] ? { name: clean(x[2]) } : {}) } };
  if ((x = m.match(/^rename (?:the )?(department|designation) (.+?) to (.+)$/i))) return { tool: 'eim.rename', args: { kind: x[1].toLowerCase(), record: clean(x[2]), name: clean(x[3]) } };
  if (/\b(export departments|department summary)\b/i.test(m)) return { tool: 'eim.exportDepartments', args: {} };
  if (/^(show|list|view) (?:all )?(departments|designations|companies|locations|employment types)$/i.test(m)) return { tool: 'eim.list', args: { resource: /department/i.test(m) ? 'structures' : m.replace(/^(show|list|view) (?:all )?/i, '').replace(/ /g, '-').toLowerCase() } };
  if (/\b(create|new)\b.*\b(?:performance )?cycle\b/i.test(m)) return { tool: 'performance.createCycle', args: {} };
  if (/\b(approve|reject)\b.*\b(onboarding )?document\b|\bdocument\b.*\b(approve|reject)\b/i.test(m)) return found('onboarding.documentDecision', { decision: /reject/i.test(m) ? 'REJECTED' : 'APPROVED', ...(m.match(/[a-f0-9-]{36}/i) ? { documentId: m.match(/[a-f0-9-]{36}/i)![0] } : {}) });
  if (/\b(pending|waiting|show|list|view)\b.*\b(onboarding )?documents?\b|documents?.*verification/i.test(m)) return found('onboarding.documents');
  if (/\b(show|list|view|find)\b.*\b(?:onboarding (?:invites?|invitations?|requests?)|invites?)\b|\b(incomplete|pending)\b.*\bonboarding\b/i.test(m)) return found('onboarding.invites', { ...(/pending|incomplete/i.test(m) ? { status: 'PENDING' } : {}) });
  if (/\b(onboard|invite)\b.*\b(new )?(employee|person|candidate)\b|\bsend\b.*\b(onboarding request|invitation|invite)\b|\bcreate\b.*\bonboarding request\b/i.test(m)) return found('onboarding.invite');
  if (/\b(create|new)\b.*\b(review|performance) template\b/i.test(m)) return { tool: 'performance.createTemplate', args: {} };
  if (/\bpublish\b.*\b(review|performance) template\b/i.test(m)) return { tool: 'performance.publishTemplate', args: {} };
  if ((x = m.match(/^(launch|archive|close) (?:performance |review )?cycle(?: (.+))?$/i))) return { tool: 'performance.cycleAction', args: { action: x[1].toLowerCase(), ...(x[2] ? { cycle: clean(x[2]) } : {}) } };
  if (/\b(cycles|templates)\b/i.test(m) && /show|list|view/i.test(m)) return { tool: 'performance.cycles', args: {} };
  if (/^(?:(?:are there|do i have) )?(?:any|show|list|view|check)?\s*(?:(?:my|team|new|pending|waiting)\s+)*requests?(?: (?:for me|waiting|pending|to approve))?$/i.test(m)) return found('requests.pending');
  if (/\bcancel\b.*\bleave\b|\bleave\b.*\bcancel\b/i.test(m)) return found('leave.cancel', { ...(m.match(/[a-f0-9-]{36}/i) ? { requestId: m.match(/[a-f0-9-]{36}/i)![0] } : {}) });
  if (/\b(approve|reject)\b.*\bleave\b|\bleave\b.*\b(approve|reject)\b/i.test(m)) return found('leave.decide', { decision: /reject/i.test(m) ? 'REJECTED' : 'APPROVED', ...(m.match(/[a-f0-9-]{36}/i) ? { requestId: m.match(/[a-f0-9-]{36}/i)![0] } : {}) });
  if (/\bleave\b/i.test(m) && /\b(my team|team|direct reports)\b/i.test(m) && !/\b(apply|submit|send|want|need)\b/i.test(m)) return found('leave.team');
  if (/\bmy\b.*\b(?:pending|waiting)\b.*\bleave\b|\bmy leave\b.*\b(?:pending|waiting)\b/i.test(m)) return found('leave.requests');
  if (/\bleave\b.*\b(approval|approvals|waiting|pending)\b|waiting for my approval|pending leave approvals/i.test(m)) return found('leave.pending');
  if (/\bleave\b.*\b(balance|have|remaining|available|left)\b|\b(balance|remaining|available)\b.*\bleave\b|how (?:much|many).*leave/i.test(m)) return found('leave.balance');
  if (/\bmy leave (requests|applications|history|status)\b|\b(show|view|check|find|is)\b.*\bmy\b.*\bleave\b/i.test(m)) return found('leave.requests');
  if (/\b(apply|request|take|submit|want|need|make|send)\b.*\bleave\b|\bleave request\b/i.test(m)) { const type = m.match(/\b(annual|casual|sick|medical|maternity|paternity|no pay)\s+leave/i)?.[1]; const reason = input.match(/\b(?:because|reason:|reason is)\s*(.+)$/i)?.[1]; return found('leave.apply', { ...dates(m), ...(type ? { leaveType: `${type} leave` } : {}), ...(reason ? { reason } : {}) }); }
  if (/\b(pending|waiting|show)\b.*\battendance (?:corrections?|exceptions?)\b/i.test(m)) return { tool: 'attendance.pendingCorrections', args: {} };
  if (/\b(approve|reject)\b.*\battendance (?:correction|exception)\b/i.test(m)) return { tool: 'attendance.decideCorrection', args: {} };
  if (/missed (?:punch|attendance)|attendance correction/i.test(m)) return { tool: 'attendance.correction', args: {} };
  if (/\b(?:mark|record|punch)\b.*\battendance\b|\b(?:clock|check|punch)[ -](?:me )?(?:in|out)\b|\b(?:start|end) (?:my )?break\b/i.test(m)) {
    // Never backdate a live punch or interpret a named employee as "me".
    if (/\byesterday\b|\blast\b|\btomorrow\b|\b\d{4}-\d{2}-\d{2}\b/i.test(m)) return found('attendance.correction', { ...(dates(m).startDate ? { date: dates(m).startDate } : {}) });
    const own = !/\b(?:employee|employees|team|for|his|her|their)\b|\bEMP[- ]?\d+\b/i.test(m) && (/\bmy\b/i.test(m) || /^(?:clock|check|punch)[ -](?:me )?(?:in|out)\b|^(?:start|end) (?:my )?break\b/i.test(m));
    if (!own) return found('help.guide', { topic: 'Attendance for another employee: use their attendance correction approval workflow.' });
    return found('attendance.punch', { logType: /\bstart\b.*\bbreak\b/i.test(m) ? 'BreakIn' : /\bend\b.*\bbreak\b/i.test(m) ? 'BreakOut' : /\b(?:clock|check|punch)[ -](?:me )?out\b/i.test(m) ? 'Out' : 'In' });
  }
  if (/attendance/i.test(m) && /show|view|check|list|my|team|employee|company/i.test(m)) return found(/team|employees|company/i.test(m) ? 'attendance.team' : 'attendance.mine', { ...(month(m) ? { month: month(m) } : {}) });
  if (/\b(share|submit)\b.*\b(self|manager).*assessment/i.test(m)) return { tool: 'performance.action', args: { employee: 'me', action: /manager/i.test(m) ? 'manager-share' : 'self-share' } };
  if (/\backnowledge\b.*\breview\b/i.test(m)) return { tool: 'performance.action', args: { employee: 'me', action: 'acknowledge' } };
  if (/\bclose (?:a |my |the )?review\b/i.test(m)) return { tool: 'performance.action', args: { action: 'close' } };
  if (/\bsave\b.*assessment/i.test(m)) return { tool: 'performance.assessment', args: { kind: /manager/i.test(m) ? 'manager' : 'self', employee: 'me' } };
  if (/\b(development plan|development action)\b/i.test(m) && /add|update|save|create/i.test(m)) return { tool: 'performance.development', args: {} };
  if (/\b(record|save|update)\b.*\breview meeting\b/i.test(m)) return { tool: 'performance.meeting', args: {} };
  if (/\b(invite|request)\b.*\b(peer|360|feedback)\b/i.test(m)) return { tool: 'performance.inviteFeedback', args: {} };
  if (/check.?in|update.*goal.*progress/i.test(m)) return { tool: 'performance.checkin', args: { employee: 'me' } };
  if (/\b(submit|respond|give)\b.*feedback/i.test(m)) return { tool: 'performance.feedback', args: {} };
  if (/feedback (requests|invitations)|my feedback/i.test(m)) return { tool: 'performance.invitations', args: {} };
  if ((x = m.match(/^(?:open|show|view) (.+?)(?:'s|’s) (?:performance )?review$/i))) return { tool: 'performance.review', args: { employee: clean(x[1]) } };
  if (/\bmy (?:performance )?(?:review|goals)\b|\b(show|open|view)\b.*\bmy\b.*\b(review|goals)\b/i.test(m)) return found('performance.review', { employee: 'me' });
  if (/\bperformance\b|incomplete (?:performance |self )?(?:reviews|assessments)/i.test(m) && /show|view|which|list|check/i.test(m)) return { tool: 'performance.summary', args: { ...(/\bmy performance\b/i.test(m) ? { employee: 'me' } : {}), pendingOnly: /incomplete|pending/i.test(m) } };
  if (/\b(change|update)\b.*\brole\b/i.test(m)) return { tool: 'users.changeRole', args: {} };
  if (/\b(give|enable|update|change|grant)\b.*\b(permission|permissions|module access)\b/i.test(m)) return { tool: 'users.permissions', args: {} };
  if (/\b(show|list|view)\b.*\b(user accounts|users)\b/i.test(m)) return { tool: 'users.list', args: {} };
  if (/\bmy profile\b|\b(show|view|open)\b.*\bmy (?:employee )?(?:details|information)\b/i.test(m)) return found('self.profile');
  if (/how many.*employees|pending actions|dashboard summary|team.*on leave/i.test(m)) return { tool: 'dashboard.summary', args: {} };
  if ((x = m.match(/^(?:find|search for|look up) (.+)$/i))) return { tool: 'employee.search', args: { query: clean(input.replace(/^(?:(?:please|can you|could you|would you)\s+)?\S+(?:\s+(?:for|up))?\s+/i, '')) } };
  if (/^(show|list|view) (all )?employees$/i.test(m)) return { tool: 'employee.search', args: {} };
  if ((x = m.match(/^(?:open|take me to|go to|navigate to) (.+)$/i))) return { tool: 'navigation.open', args: { page: clean(x[1]) } };
  // A safe domain fallback: resolve obvious read/write families, but still return a form
  // for any write whose required details were not supplied. Nothing is changed here.
  if (/\bleave\b/i.test(m)) {
    if (/\b(status|history|request|requests)\b/i.test(m)) return found('leave.requests');
    return found('help.guide', { topic: m });
  }
  if (/\battendance\b/i.test(m)) return found(/\b(team|employee|company)\b/i.test(m) ? 'attendance.team' : 'attendance.mine', { ...(month(m) ? { month: month(m) } : {}) });
  if (/\bperformance|review|goal|assessment\b/i.test(m)) return found('performance.summary', { pendingOnly: /pending|incomplete/i.test(m) });
  if (/\bonboarding\b/i.test(m)) return found('help.guide', { topic: m });
  return null;
}
