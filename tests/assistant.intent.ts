import assert from 'node:assert/strict';
import { understand, normalizeIntentText } from '../src/modules/assistant/intent';
import { closest } from '../src/modules/assistant/matching';
import { monthSchema, parseMonth } from '../src/modules/assistant/month';

const cases: Array<[string, string]> = [
  ['how many leaves i have', 'leave.balance'],
  ['how mny leavs i hav', 'leave.balance'],
  ['shw my leav balan', 'leave.balance'],
  ['i want to leave request for my reporing manger', 'leave.apply'],
  ['aply for anual leve next mondey', 'leave.apply'],
  ['vie my attendence last mnth', 'attendance.mine'],
  ['shw my perfomance revew', 'performance.review'],
  ['who is my reporing managr', 'reporting.myManager'],
  ['find Kasun Bandara', 'employee.search'],
  ['onbord a new employe', 'onboarding.invite'],
  ['shw pending onbording documnts', 'onboarding.documents'],
  ['what can yo do', 'help.capabilities'],
  ['i want 1 day leave', 'leave.apply'],
  ['i want to leave 26 , 27 send mn reporting managr to leave request', 'leave.apply'],
  ['mark my attendence today', 'attendance.punch'],
  ['clock me out', 'attendance.punch'],
  ['start my break', 'attendance.punch'],
  ['end my break', 'attendance.punch'],
  ['mark my attendance yesterday', 'attendance.correction'],
  ['mark attendance for EMP-027', 'help.guide'],
  ['show my leave requests', 'leave.requests'],
  ['show my pending leave requests', 'leave.requests'],
  ['show pending leave approvals', 'leave.pending'],
  ['any team leave request', 'leave.team'],
  ['show my team leave requests', 'leave.team'],
  ['show my feedback invitations', 'performance.invitations'],
  ['how many attendence my team', 'attendance.team'],
  ['hello','help.chat'],
  ['tell me a joke','help.chat'],
  ['onboard Jane Doe jane.doe@example.test','onboarding.invite'],
  ['give Supun Wijesinghe full access to onboarding','users.grantModule'],
  ['create a performance goal','performance.createGoal'],
  ['assign this goal to an employee','performance.assignGoal'],
  ['create a shift','attendance.createShift'],
  ['assign a roster group to an employee','attendance.assignRoster'],
  ['send an agreement','onboarding.agreement'],
  ['delete employee EMP-027','employee.delete'],
  ['complete onboarding for a candidate','onboarding.complete'],
  ['resend an onboarding invitation','onboarding.resend'],
  ['update employee details','employee.updateDetails'],
  ['create an eim table','eim.createCollection'],
  ['any request','requests.pending'],
  ['any requst','requests.pending'],
  ['show pending requests','requests.pending'],
  ['do i have any requests','requests.pending'],
  ['any team requests','requests.pending'],
];

for (const [message, expected] of cases) {
  assert.equal(understand(message)?.tool, expected, `Expected "${message}" to map to ${expected}`);
}

const preserved = understand('find Kasun Bandara');
assert.equal(preserved?.args.query, 'Kasun Bandara', 'Employee names must not be lowercased or typo-corrected.');
assert.equal(normalizeIntentText('shw my leav balan').corrected, true);
assert.equal(normalizeIntentText('how many leaves i have').corrected, false);
assert.match(String(understand('aply for anual leve next mondey')?.args.startDate), /^20\d{2}-\d{2}-\d{2}$/);
assert.match(String(understand('vie my attendence last mnth')?.args.month), /^20\d{2}-\d{2}$/);
assert.deepEqual(closest([{ name: 'Kasun Bandara' }, { name: 'Amal Perera' }], 'Ksun Bandara', row => [row.name]), [{ name: 'Kasun Bandara' }]);
assert.deepEqual(closest([{ name: 'Technology' }, { name: 'Finance' }], 'Technlogy', row => [row.name]), [{ name: 'Technology' }]);

assert.equal(understand('clock me out')?.args.logType, 'Out');
assert.equal(understand('start my break')?.args.logType, 'BreakIn');
assert.equal(understand('end my break')?.args.logType, 'BreakOut');
assert.equal(understand('i want leave 26, 27')?.args.startDate, undefined, 'Missing month/year must not be guessed.');
assert.equal(understand('apply leave tomorrow because visiting Manager Stanley')?.args.reason, 'visiting Manager Stanley');
assert.equal(understand('find Stanley March')?.args.query, 'Stanley March');
assert.equal(parseMonth('august', '2026-09-25'), '2026-08');
assert.equal(parseMonth('Aug 2025', '2026-09-25'), '2025-08');
assert.equal(parseMonth('last month', '2026-01-25'), '2025-12');
assert.equal(monthSchema.parse('August 2025'), '2025-08');
assert.equal(monthSchema.safeParse('2026-13').success, false);
assert.equal(monthSchema.safeParse('nonsense').success, false);
assert.deepEqual(understand('onboard Jane Doe jane.doe@example.test')?.args,{name:'Jane Doe',email:'jane.doe@example.test'});
assert.deepEqual(understand('give Supun Wijesinghe full access to onboarding')?.args,{employee:'Supun Wijesinghe',module:'onboarding'});
console.log(`${cases.length + 21} typo-aware assistant intent and month checks passed.`);
