// @ts-nocheck
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db } from './lib/db';
import { RowDataPacket } from 'mysql2';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  console.log('🌱 Seeding Enterprise HR Database...');

  const hashedPassword = await bcrypt.hash('Admin@123', 12);
  const empPassword = await bcrypt.hash('Emp@123', 12);

  const upsertLeaveType = async (code: string, data: any) => {
    const [rows] = await db.query<RowDataPacket[]>('SELECT id FROM leave_types WHERE code = ?', [code]);
    if (rows.length > 0) {
      await db.query(`UPDATE leave_types SET name=?, color=?, isActive=?, allowHalfDays=?, requireCoveringEmp=?, yearlyEntitlement=?, needMedicalCertificate=?, requireAttachment=?, isNoPayLeave=?, isMaternityLeave=?, carryForwardEnabled=?, carryForwardMaxDays=?, showBalance=?, allowNegativeBalance=?, showReason=?, commentMandatory=?, autoCalculateEndDate=?, updatedAt=NOW() WHERE code=?`,
        [data.name, data.color, data.isActive, data.allowHalfDays, data.requireCoveringEmp, data.yearlyEntitlement, data.needMedicalCertificate, data.requireAttachment, data.isNoPayLeave, data.isMaternityLeave, data.carryForwardEnabled, data.carryForwardMaxDays || 0, data.showBalance, data.allowNegativeBalance, data.showReason, data.commentMandatory, data.autoCalculateEndDate, code]
      );
      return rows[0];
    } else {
      const id = uuidv4();
      await db.query(`INSERT INTO leave_types (id, code, name, color, isActive, allowHalfDays, requireCoveringEmp, yearlyEntitlement, needMedicalCertificate, requireAttachment, isNoPayLeave, isMaternityLeave, carryForwardEnabled, carryForwardMaxDays, showBalance, allowNegativeBalance, showReason, commentMandatory, autoCalculateEndDate, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [id, code, data.name, data.color, data.isActive, data.allowHalfDays, data.requireCoveringEmp, data.yearlyEntitlement, data.needMedicalCertificate, data.requireAttachment, data.isNoPayLeave, data.isMaternityLeave, data.carryForwardEnabled, data.carryForwardMaxDays || 0, data.showBalance, data.allowNegativeBalance, data.showReason, data.commentMandatory, data.autoCalculateEndDate]
      );
      return { id };
    }
  };

  console.log('📦 Seeding Leave Types...');
  const annual = await upsertLeaveType('ANN', { name: 'Annual Leave', color: '#10b981', isActive: 1, allowHalfDays: 1, requireCoveringEmp: 1, yearlyEntitlement: 14, needMedicalCertificate: 0, requireAttachment: 0, isNoPayLeave: 0, isMaternityLeave: 0, carryForwardEnabled: 1, carryForwardMaxDays: 7, showBalance: 1, allowNegativeBalance: 0, showReason: 0, commentMandatory: 0, autoCalculateEndDate: 1 });
  const casual = await upsertLeaveType('CAS', { name: 'Casual Leave', color: '#3b82f6', isActive: 1, allowHalfDays: 1, requireCoveringEmp: 0, yearlyEntitlement: 7, needMedicalCertificate: 0, requireAttachment: 0, isNoPayLeave: 0, isMaternityLeave: 0, carryForwardEnabled: 0, showBalance: 1, allowNegativeBalance: 0, showReason: 1, commentMandatory: 0, autoCalculateEndDate: 1 });
  const medical = await upsertLeaveType('MED', { name: 'Medical Leave', color: '#ef4444', isActive: 1, allowHalfDays: 0, requireCoveringEmp: 0, yearlyEntitlement: 14, needMedicalCertificate: 1, maxDaysWithoutMedCert: 2, requireAttachment: 1, isNoPayLeave: 0, isMaternityLeave: 0, carryForwardEnabled: 0, showBalance: 1, allowNegativeBalance: 0, showReason: 1, commentMandatory: 1, autoCalculateEndDate: 1 });

  console.log('📅 Seeding Leave Year & Holidays...');
  const currentYear = new Date().getFullYear();
  let year2026: any;
  const [lyRows] = await db.query<RowDataPacket[]>('SELECT id FROM leave_years WHERE year = ?', [currentYear]);
  if (lyRows.length > 0) {
    year2026 = lyRows[0];
  } else {
    const id = uuidv4();
    await db.query('INSERT INTO leave_years (id, year, displayName, isActive, startDate, endDate, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())', [id, currentYear, `${currentYear} Annual`, 1, new Date(`${currentYear}-01-01`), new Date(`${currentYear}-12-31`)]);
    year2026 = { id };
  }

  console.log('📅 Seeding Holidays...');
  let calendarGroup: any;
  const [cgRows] = await db.query<RowDataPacket[]>('SELECT id FROM calendargroup WHERE displayName = ?', ['Default Enterprise Calendar']);
  if (cgRows.length > 0) {
    calendarGroup = cgRows[0];
  } else {
    const id = uuidv4();
    await db.query('INSERT INTO calendargroup (id, displayName, description, isCompanyCalendar, weekendConfiguration, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, NOW(), NOW())', [id, 'Default Enterprise Calendar', 'Standard company holidays', 1, JSON.stringify(["SATURDAY","SUNDAY"])]);
    calendarGroup = { id };
  }

  let calendar: any;
  const [hcRows] = await db.query<RowDataPacket[]>('SELECT id FROM holidaycalendar WHERE year = ? AND calendarGroupId = ?', [currentYear, calendarGroup.id]);
  if (hcRows.length > 0) {
    calendar = hcRows[0];
  } else {
    const id = uuidv4();
    await db.query('INSERT INTO holidaycalendar (id, year, calendarGroupId, createdAt, updatedAt) VALUES (?, ?, ?, NOW(), NOW())', [id, currentYear, calendarGroup.id]);
    calendar = { id };
  }

  let dayType: any;
  const [dtRows] = await db.query<RowDataPacket[]>('SELECT id FROM daytype WHERE name = ?', ['FULL_HOLIDAY']);
  if (dtRows.length > 0) {
    dayType = dtRows[0];
  } else {
    const id = uuidv4();
    await db.query('INSERT INTO daytype (id, name, description, type, displayColor, leaveAmount, workflowStatus, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())', [id, 'FULL_HOLIDAY', 'Full Day Holiday', 'FULL_DAY_HOLIDAY', '#e11d48', 1.0, 'APPROVED']);
    dayType = { id };
  }

  const holidays = [
    { date: new Date(`${currentYear}-01-01`), name: 'New Year' },
    { date: new Date(`${currentYear}-02-04`), name: 'Independence Day' },
    { date: new Date(`${currentYear}-04-13`), name: 'Sinhala & Tamil New Year' },
  ];
  
  for (const h of holidays) {
    const [cdRows] = await db.query<RowDataPacket[]>('SELECT id FROM calendarday WHERE date = ? AND holidayCalendarId = ?', [h.date, calendar.id]);
    if (cdRows.length === 0) {
      await db.query('INSERT INTO calendarday (id, date, holidayCalendarId, dayTypeId) VALUES (?, ?, ?, ?)', [uuidv4(), h.date, calendar.id, dayType.id]);
    }
  }

  console.log('👥 Seeding Users & Hierarchy...');
  
  const upsertUser = async (email: string, data: any) => {
    const [rows] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE email = ?', [email]);
    if (rows.length > 0) {
      return rows[0];
    } else {
      const id = uuidv4();
      await db.query('INSERT INTO users (id, email, name, password, role, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())', [id, email, data.name, data.password, data.role, data.isActive]);
      return { id };
    }
  };

  const ceo = await upsertUser('ceo@readyhr.com', { name: 'Alexander Wright', password: hashedPassword, role: 'ADMIN', isActive: 1 });
  const managerEng = await upsertUser('eng.mgr@readyhr.com', { name: 'Sarah Connor', password: empPassword, role: 'ADMIN', isActive: 1 });
  const managerHR = await upsertUser('hr.mgr@readyhr.com', { name: 'John Smith', password: hashedPassword, role: 'ADMIN', isActive: 1 });
  const emp1 = await upsertUser('dev1@readyhr.com', { name: 'Kasun Perera', password: empPassword, role: 'CANDIDATE', isActive: 1 });
  const emp2 = await upsertUser('dev2@readyhr.com', { name: 'Nimal Silva', password: empPassword, role: 'CANDIDATE', isActive: 1 });
  const emp3 = await upsertUser('hr.exec@readyhr.com', { name: 'Amali Fernando', password: empPassword, role: 'CANDIDATE', isActive: 1 });
  const admin = await upsertUser('admin@readyhr.com', { name: 'Asel Perera', password: hashedPassword, role: 'ADMIN', isActive: 1 });

  console.log('🛡️ Seeding Leave Entitlements...');
  const usersList = [ceo, managerEng, managerHR, emp1, emp2, emp3, admin];
  const leaveTypes = [{ ...annual, code: 'ANN', yearlyEntitlement: 14 }, { ...casual, code: 'CAS', yearlyEntitlement: 7 }, { ...medical, code: 'MED', yearlyEntitlement: 14 }];

  for (const user of usersList) {
    for (const typeInfo of leaveTypes) {
      const type: any = typeInfo;
      const [entRows] = await db.query<RowDataPacket[]>('SELECT id FROM leave_entitlements WHERE userId = ? AND leaveTypeId = ? AND leaveYearId = ?', [user.id, type.id, year2026.id]);
      if (entRows.length === 0) {
        await db.query(`INSERT INTO leave_entitlements (id, userId, leaveTypeId, leaveYearId, totalDays, usedDays, pendingDays, carryForwardDays, earnedDays, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 0, 0, ?, 0, 'PROCESSED', NOW(), NOW())`,
          [uuidv4(), user.id, type.id, year2026.id, type.yearlyEntitlement, type.code === 'ANN' ? 2 : 0]
        );
      }
    }
  }

  console.log('');
  console.log('──────────────────────────────────────────────');
  console.log('✅ Enterprise Database Seeded Successfully!');
  console.log('  Test Accounts:');
  console.log('  [CEO]        ceo@readyhr.com      | Admin@123');
  console.log('  [HR Mgr]     hr.mgr@readyhr.com   | Admin@123');
  console.log('  [Eng Mgr]    eng.mgr@readyhr.com  | Emp@123');
  console.log('  [Employee]   dev1@readyhr.com     | Emp@123');
  console.log('──────────────────────────────────────────────');
  console.log('');
  process.exit(0);
}

main().catch(e => {
  console.error('❌ Seed failed:', e);
  process.exit(1);
});
