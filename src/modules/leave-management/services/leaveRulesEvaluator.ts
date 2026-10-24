import { db } from '../../../lib/db';
import { RowDataPacket } from 'mysql2';
import { repository, type RepositorySession } from '../../../storage/repository';
import { compileLeaveRule, evaluateLeaveRule } from './restricted-rule';

export interface LeaveRuleInput {
  employeeId: string;
  leaveTypeId: string;
  leaveYear: number;
  assumeConfirmed?: boolean;
}

export interface LeaveRuleOutput {
  entitlement: number;
  carryForwardAmount: number;
  logs: string[];
}

export class LeaveRulesEvaluator {
  static validateCustomScript(script: string) { compileLeaveRule(script); }
  /**
   * Safely evaluate a custom script
   */
  static evaluateCustomScript(script: string, context: Record<string, any>): LeaveRuleOutput {
    return evaluateLeaveRule(script, context);
  }

  /**
   * Evaluates standard Sri Lankan Leave rules or custom scripts
   */
  static async evaluate(input: LeaveRuleInput, scriptContent?: string, session?: RepositorySession): Promise<LeaveRuleOutput> {
    const logs: string[] = [];
    logs.push(`Starting evaluation for Employee: ${input.employeeId}, Year: ${input.leaveYear}`);

    const native = process.env.DATABASE_PROVIDER === 'dynamodb';
    const store = session || (native ? repository() : undefined);
    const employee = store ? await store.get('employee_information_employees', { id: input.employeeId }) : (await db.query<RowDataPacket[]>('SELECT * FROM employee_information_employees WHERE id = ? LIMIT 1', [input.employeeId]))[0][0];
    if (!employee) throw new Error('Employee not found');

    const pdRows = store ? await store.find('employee_information_personal_details', p => p.employeeId === input.employeeId) : (await db.query<RowDataPacket[]>('SELECT gender FROM employee_information_personal_details WHERE employeeId = ? LIMIT 1', [input.employeeId]))[0];
    let gender = pdRows[0]?.gender?.toUpperCase();
    // Onboarding historically stores lookup IDs; older employees store names.
    if (gender && /^[0-9A-F-]{36}$/.test(gender)) {
      const genders = store ? [await store.get('eim_genders', { id: pdRows[0].gender })].filter(Boolean) : (await db.query<RowDataPacket[]>('SELECT name FROM eim_genders WHERE id=? LIMIT 1', [pdRows[0].gender]))[0];
      gender = genders[0]?.name?.toUpperCase();
    }

    const empDetails = employee;

    const joinedDate = empDetails?.dateJoined ? new Date(String(empDetails.dateJoined).slice(0, 10) + 'T00:00:00Z') : null;
    if (!joinedDate || Number.isNaN(joinedDate.valueOf())) {
      logs.push("Error: No dateJoined found for employee in employment details");
      return { entitlement: 0, carryForwardAmount: 0, logs };
    }

    const currentYear = input.leaveYear;
    const joinedYear = joinedDate.getUTCFullYear();
    const joinedMonth = joinedDate.getUTCMonth() + 1; // 1-12
    const serviceMonths = (currentYear - joinedYear) * 12 + (12 - joinedMonth + 1);

    const leaveType = store ? await store.get('leave_types', { id: input.leaveTypeId }) : (await db.query<RowDataPacket[]>('SELECT * FROM leave_types WHERE id = ? LIMIT 1', [input.leaveTypeId]))[0][0];
    if (!leaveType) throw new Error('Leave Type not found');

    const isMale = gender === 'MALE';
    const isFemale = gender === 'FEMALE';

    if (scriptContent && /output\s*\.\s*entitlement\s*=/.test(scriptContent)) {
        logs.push("Executing Custom Script...");
        const context = {
            EmployeeNo: employee.employeeNo,
            IsMale: isMale,
            IsFemale: isFemale,
            JoinedYear: joinedYear,
            JoinedMonth: joinedMonth,
            CurrentYear: currentYear,
            ServiceMonths: serviceMonths,
            LeaveType: leaveType.code
        };
        const scriptResult = this.evaluateCustomScript(scriptContent, context);
        return {
            entitlement: scriptResult.entitlement,
            carryForwardAmount: scriptResult.carryForwardAmount,
            logs: [...logs, ...scriptResult.logs]
        };
    }

    let entitlement = 0;
    const isProbation = input.assumeConfirmed 
      ? false 
      : (empDetails?.probationStatus !== 'Confirmed' && employee.employeeStatus !== 'Confirmed');

    if (isProbation) {
      if (!['CASUAL', 'CL', 'CAS'].includes(leaveType.code.toUpperCase())) {
        logs.push(`Probation Rule: ${leaveType.code} leave is not provided during probation.`);
        return { entitlement: 0, carryForwardAmount: 0, logs };
      }

      // During probation or first 12 months, casual leave is strictly 6
      entitlement = 6;
      logs.push(`Probation Rule (First Year): Flat 6 days assigned per business rule`);
      return { entitlement, carryForwardAmount: 0, logs };
    }
    
    switch (leaveType.code.toUpperCase()) {
      case 'ANNUAL':
      case 'AL':
      case 'AL001':
      case 'ANN':
        if (currentYear === joinedYear) {
          entitlement = 0;
          logs.push("Joined Year: 0 Annual Leave");
        } else if (currentYear === joinedYear + 1) {
          if (joinedMonth <= 3) entitlement = 14;
          else if (joinedMonth <= 6) entitlement = 10;
          else if (joinedMonth <= 9) entitlement = 7;
          else entitlement = 4;
          logs.push(`Second Year: Prorated based on join month ${joinedMonth} -> ${entitlement} days`);
        } else {
          entitlement = 14;
          logs.push("Subsequent Years: 14 days");
        }
        break;

      case 'MEDICAL':
      case 'ML':
      case 'MED':
        if (currentYear === joinedYear) {
          entitlement = 0;
          logs.push("Joined Year: 0 Medical Leave");
        } else if (currentYear === joinedYear + 1) {
          entitlement = Math.max(0, 5.5 - ((joinedMonth - 1) * 0.5));
          logs.push(`Second Year: Prorated from 5.5 based on join month ${joinedMonth} -> ${entitlement} days`);
        } else {
          entitlement = 7;
          logs.push("Subsequent Years: 7 days");
        }
        break;

      case 'CASUAL':
      case 'CL':
      case 'CAS':
        entitlement = 7;
        logs.push("Permanent Casual Leave: Flat 7 days");
        break;

      case 'MATERNITY':
      case 'MAT':
        if (!isFemale) {
          entitlement = 0;
          logs.push("Maternity leave only applicable for females.");
        } else {
          entitlement = 84; 
          logs.push("Maternity leave allocated: 84 days (assuming 1st/2nd delivery)");
        }
        break;

      case 'PATERNITY':
      case 'PAT':
        if (!isMale) {
          entitlement = 0;
          logs.push("Paternity leave only applicable for males.");
        } else {
          entitlement = 1; 
          logs.push("Paternity leave allocated: 1 day");
        }
        break;

      default:
        entitlement = leaveType.yearlyEntitlement || 0;
        logs.push(`Defaulting to DB allocation: ${entitlement}`);
        break;
    }

    return {
      entitlement,
      carryForwardAmount: 0, 
      logs
    };
  }
}
