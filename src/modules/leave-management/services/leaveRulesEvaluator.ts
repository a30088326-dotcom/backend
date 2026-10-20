import { db } from '../../../lib/db';
import { RowDataPacket } from 'mysql2';

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
  /**
   * Safely evaluate a custom script
   */
  static evaluateCustomScript(script: string, context: Record<string, any>): LeaveRuleOutput {
    const logs: string[] = [];
    
    // Create a safe context mapping
    const sandboxContext = {
      ...context,
      console: {
        log: (...args: any[]) => logs.push(args.join(' ')),
      },
      Math: Math,
      Date: Date,
      parseFloat,
      parseInt,
      isNaN
    };

    const keys = Object.keys(sandboxContext);
    const values = Object.values(sandboxContext);

    try {
      const fn = new Function(...keys, `
        let output = { entitlement: 0, carryForwardAmount: 0 };
        try {
          ${script}
        } catch(e) {
          console.log("Script Execution Error:", e.message);
        }
        return output;
      `);

      const result = fn(...values);
      return {
        entitlement: result?.entitlement || 0,
        carryForwardAmount: result?.carryForwardAmount || 0,
        logs
      };
    } catch (err: any) {
      logs.push(`Compilation Error: ${err.message}`);
      return { entitlement: 0, carryForwardAmount: 0, logs };
    }
  }

  /**
   * Evaluates standard Sri Lankan Leave rules or custom scripts
   */
  static async evaluate(input: LeaveRuleInput, scriptContent?: string): Promise<LeaveRuleOutput> {
    const logs: string[] = [];
    logs.push(`Starting evaluation for Employee: ${input.employeeId}, Year: ${input.leaveYear}`);

    const [empRows] = await db.query<RowDataPacket[]>('SELECT * FROM employee_information_employees WHERE id = ? LIMIT 1', [input.employeeId]);
    const employee = empRows[0];
    if (!employee) throw new Error('Employee not found');

    const [pdRows] = await db.query<RowDataPacket[]>('SELECT gender FROM employee_information_personal_details WHERE employeeId = ? LIMIT 1', [input.employeeId]);
    const gender = pdRows[0]?.gender?.toUpperCase();

    const [edRows] = await db.query<RowDataPacket[]>('SELECT dateJoined, probationStatus FROM employee_information_employees WHERE id = ? LIMIT 1', [input.employeeId]);
    const empDetails = edRows[0];

    const joinedDate = empDetails?.dateJoined ? new Date(empDetails.dateJoined) : null;
    if (!joinedDate) {
      logs.push("Error: No dateJoined found for employee in employment details");
      return { entitlement: 0, carryForwardAmount: 0, logs };
    }

    const currentYear = input.leaveYear;
    const joinedYear = joinedDate.getFullYear();
    const joinedMonth = joinedDate.getMonth() + 1; // 1-12
    const serviceMonths = (currentYear - joinedYear) * 12 + (12 - joinedMonth + 1);

    const [ltRows] = await db.query<RowDataPacket[]>('SELECT * FROM leave_types WHERE id = ? LIMIT 1', [input.leaveTypeId]);
    const leaveType = ltRows[0];
    if (!leaveType) throw new Error('Leave Type not found');

    const isMale = gender === 'MALE';
    const isFemale = gender === 'FEMALE';

    if (scriptContent && scriptContent.includes('output.entitlement =')) {
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
