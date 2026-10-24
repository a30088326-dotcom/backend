// @ts-nocheck
import { Request, Response } from 'express';
import { db } from '../../lib/db';
import { RowDataPacket } from 'mysql2';
import { v4 as uuidv4 } from 'uuid';
import { ProbationConfirmationService } from './confirmationService';
import { processEntitlementsForEmployee } from '../leave/leave.controller';
import { organizationAccess } from '../../shared/services/organization.service';
import { syncEmployeeMappings, updateEmployeeReporting } from '../../shared/services/employee-mapping.service';
import { getProfileExtras, identifiedContacts } from './profile-requests';
import { organizationModuleScope } from '../../middleware/module-action';
import { onboardingContact, populateDetailLabels } from './onboarding-mapping';
// GET all employees for the advanced EIMS search grid
export const getEmployees = async (req: Request, res: Response) => {
  try {
    const query = `
      SELECT 
        e.*,
        pd.firstName as pd_firstName, pd.lastName as pd_lastName, pd.gender as pd_gender, pd.maritalStatus as pd_maritalStatus, pd.dob as pd_dob, pd.nic as pd_nic, pd.nationality as pd_nationality, pd.bloodGroup as pd_bloodGroup, pd.religion as pd_religion,

        et.id as et_id, et.name as et_name,
        wd.id as wd_id, wd.companyId as wd_companyId, wd.locationId as wd_locationId, wd.departmentId as wd_departmentId, wd.designationId as wd_designationId, wd.sectionId as wd_sectionId, wd.divisionId as wd_divisionId,
        des.id as des_id, des.name as des_name,
        u.id as u_id, u.name as u_name, u.email as u_email, u.role as u_role
      FROM employee_information_employees e
      LEFT JOIN employee_information_personal_details pd ON e.id = pd.employeeId

      LEFT JOIN employment_types et ON e.employmentTypeId = et.id
      LEFT JOIN employee_information_workstation_details wd ON e.id = wd.employeeId
      LEFT JOIN designations des ON wd.designationId = des.id
      LEFT JOIN users u ON e.userId = u.id
      ORDER BY e.createdAt DESC
    `;
    const [rows] = await db.query<RowDataPacket[]>(query);
    
    const access = await organizationAccess(req.user!.userId);
    const employees = rows.filter(row=>access.visibleIds.includes(row.id)).map((row) => ({
      id: row.id, userId: row.userId, departmentId:row.wd_departmentId || row.departmentId || null, department:row.department, designation:row.designation, organizationalRank:row.organizationalRank, employeeNo: row.employeeNo, isActive: Boolean(row.isActive), barcodeNo: row.barcodeNo, payrollNo: row.payrollNo, timeAndAttendanceActive: Boolean(row.timeAndAttendanceActive), payrollActive: Boolean(row.payrollActive), employeeStatus: row.employeeStatus, employeeGroup: row.employeeGroup, createdAt: row.createdAt, updatedAt: row.updatedAt,
      personalDetails: row.pd_firstName || row.pd_lastName ? { firstName: row.pd_firstName, lastName: row.pd_lastName, gender: row.pd_gender, maritalStatus: row.pd_maritalStatus, dob: row.pd_dob, nic: row.pd_nic, nationality: row.pd_nationality, bloodGroup: row.pd_bloodGroup, religion: row.pd_religion } : null,
      employmentDetails: row.dateJoined ? { dateJoined: row.dateJoined, probationStatus: row.probationStatus, permanentEffectiveDate: row.permanentEffectiveDate } : null,
      employmentType: row.et_id ? { id: row.et_id, name: row.et_name } : null,
      workstationDetails: row.wd_id ? { id: row.wd_id, companyId: row.wd_companyId, locationId: row.wd_locationId, departmentId: row.wd_departmentId, designationId: row.wd_designationId, sectionId: row.wd_sectionId, divisionId: row.wd_divisionId, Designation: row.des_id ? { id: row.des_id, name: row.des_name } : null } : null,
      user: row.u_id ? { name: row.u_name, email: row.u_email, role: row.u_role } : null
    }));

    return res.json({ success: true, data: access.admin || access.isExecutive ? employees : employees.map(e=>({id:e.id,userId:e.userId,employeeNo:e.employeeNo,isActive:e.isActive,departmentId:e.departmentId,department:e.department,designation:e.designation,organizationalRank:e.organizationalRank,personalDetails:e.personalDetails?{firstName:e.personalDetails.firstName,lastName:e.personalDetails.lastName}:null})) });
  } catch (error: any) {
    console.error('Error fetching EIMS employees:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getEmployeeById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const access = await organizationAccess(req.user!.userId);
    const [[permission]]=await db.query<RowDataPacket[]>('SELECT moduleAccess,canView FROM user_module_permissions WHERE userId=? AND moduleId=\'employee_information\'',[req.user!.userId]);
    const delegatedView=permission?.moduleAccess && permission.canView && await organizationModuleScope(req.user!,'employee_information');
    if (!access.admin && !delegatedView && !access.visibleIds.includes(id)) return res.status(403).json({success:false,message:'Private employee details are available only to the employee and authorized reporting managers.'});
    const [empRows] = await db.query<RowDataPacket[]>('SELECT * FROM employee_information_employees WHERE id = ? LIMIT 1', [id]);
    const employee = empRows[0];

    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    const fetchOne = async (table: string, field: string = 'employeeId') => {
      const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM ${table} WHERE ${field} = ? LIMIT 1`, [id]);
      return rows[0] || null;
    };
    
    const fetchMany = async (table: string, field: string = 'employeeId') => {
      const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM ${table} WHERE ${field} = ?`, [id]);
      return rows;
    };

    let personalDetails = await fetchOne('employee_information_personal_details');
    const employmentDetails = { dateJoined: employee.dateJoined, probationStatus: employee.probationStatus, permanentEffectiveDate: employee.permanentEffectiveDate };
    const workstationDetails = await fetchOne('employee_information_workstation_details');
    let contactDetails = await fetchOne('employee_information_contact_details');
    const resignationDetails = await fetchOne('employee_information_resignation_details');
    const salaryHistories = await fetchMany('employee_salary_histories');
    let bankDetails = await fetchMany('employee_information_bank_details');

    const [attendanceRows] = await db.query<RowDataPacket[]>("SELECT *, COALESCE(groupId,rosterGroupId) AS assignedRosterId FROM attendance_roster_assignments WHERE employeeId=? AND status='Active' ORDER BY effectiveStartDate DESC, createdAt DESC LIMIT 1", [id]);
    const attendanceAssignment = attendanceRows[0];
    const attendance = attendanceAssignment ? { rosterGroupId: attendanceAssignment.assignedRosterId, effectiveStartDate: attendanceAssignment.effectiveStartDate } : null;

    const reportingManagerId = employee.reportingManagerId || null;
    if (workstationDetails) workstationDetails.supervisorId = reportingManagerId;
    
    let employmentType = null;
    if (employee.employmentTypeId) {
      const [etRows] = await db.query<RowDataPacket[]>('SELECT * FROM employment_types WHERE id = ? LIMIT 1', [employee.employmentTypeId]);
      employmentType = etRows[0] || null;
    }
    
    if (contactDetails) {
      // Parse JSON fields stored in the DB if necessary
      try { if (typeof contactDetails.permanent === 'string') contactDetails.permanent = JSON.parse(contactDetails.permanent); } catch {}
      try { if (typeof contactDetails.working === 'string') contactDetails.working = JSON.parse(contactDetails.working); } catch {}
      try { if (typeof contactDetails.official === 'string') contactDetails.official = JSON.parse(contactDetails.official); } catch {}
      try { if (typeof contactDetails.residential === 'string') contactDetails.residential = JSON.parse(contactDetails.residential); } catch {}
    }

    // Dynamic Fallback: Use Onboarding Profile data as Central Source of Truth
    const [onbRows] = await db.query<RowDataPacket[]>('SELECT * FROM onboarding_profiles WHERE candidateId = ? LIMIT 1', [employee.userId]);
    const onboardingProfile = onbRows[0] || null;
    if (onboardingProfile) {
      if (!personalDetails) {
        personalDetails = {
          firstName: onboardingProfile.firstName, lastName: onboardingProfile.lastName, fullName: `${onboardingProfile.firstName} ${onboardingProfile.lastName}`,
          dob: onboardingProfile.dateOfBirth, gender: onboardingProfile.gender, nationality: onboardingProfile.nationality
        };
      } else {
        personalDetails.firstName = personalDetails.firstName || onboardingProfile.firstName;
        personalDetails.lastName = personalDetails.lastName || onboardingProfile.lastName;
        personalDetails.fullName = personalDetails.fullName || `${onboardingProfile.firstName} ${onboardingProfile.lastName}`;
        personalDetails.dob = personalDetails.dob || onboardingProfile.dateOfBirth;
        personalDetails.gender = personalDetails.gender || onboardingProfile.gender;
        personalDetails.nationality = personalDetails.nationality || onboardingProfile.nationality;
      }
      
      if (!contactDetails) contactDetails = { permanent: null, working: null, official: null, residential: null };
      if (!contactDetails.permanent) {
        contactDetails.permanent = { address: [onboardingProfile.addressLine1, onboardingProfile.addressLine2].filter(Boolean).join(' '), city: onboardingProfile.city || '', postalCode: onboardingProfile.postalCode || '' };
      }
      if (!contactDetails.residential) contactDetails.residential = {};
      if (!contactDetails.residential.emergencyContacts || contactDetails.residential.emergencyContacts.length === 0) {
        if (onboardingProfile.emergencyContactName) {
          contactDetails.residential.emergencyContacts = [{ name: onboardingProfile.emergencyContactName, relationship: onboardingProfile.emergencyContactRelation, primaryPhone: onboardingProfile.emergencyContactPhone }];
        }
      }
      
      if (!bankDetails || bankDetails.length === 0) {
        if (onboardingProfile.bankName) {
          bankDetails = [{
            bankName: onboardingProfile.bankName, accountHolderName: onboardingProfile.accountHolderName,
            accountNo: onboardingProfile.accountNumber, accountType: onboardingProfile.accountType, currency: onboardingProfile.currency
          }];
        }
      }
      contactDetails = onboardingContact(contactDetails, onboardingProfile, contactDetails.official?.email || '');
    }

    if (workstationDetails && workstationDetails.functionalRole !== undefined) {
      workstationDetails.functionalRoleId = workstationDetails.functionalRole;
    }

    if(contactDetails?.residential?.emergencyContacts)contactDetails.residential.emergencyContacts=identifiedContacts(contactDetails.residential.emergencyContacts);
    const extras = await getProfileExtras(id);
    await populateDetailLabels(personalDetails, workstationDetails);
    const fullEmployee = {
      ...employee,
      otherDetails: extras,
      payrollDetails: { dependents: extras.dependents || [] },
      isActive: Boolean(employee.isActive),
      timeAndAttendanceActive: Boolean(employee.timeAndAttendanceActive),
      payrollActive: Boolean(employee.payrollActive),
      employmentType,
      personalDetails,
      employmentDetails,
      workstationDetails,
      contactDetails,
      resignationDetails,
      salaryHistories,
      bankDetails,
      attendance,
    };

    return res.json({ success: true, data: fullEmployee });
  } catch (error: any) {
    console.error('getEmployeeById error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// GET /me — fetch the currently logged-in user's employee profile
export const getMyEmployee = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Not authenticated' });

    // Find employee linked to this user
    const [empRows] = await db.query<RowDataPacket[]>('SELECT * FROM employee_information_employees WHERE userId = ? LIMIT 1', [userId]);
    const employee = empRows[0] || null;

    const id = employee ? employee.id : null;

    const fetchOne = async (table: string, field: string = 'employeeId') => {
      if (!id) return null;
      const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM ${table} WHERE ${field} = ? LIMIT 1`, [id]);
      return rows[0] || null;
    };
    
    const fetchMany = async (table: string, field: string = 'employeeId') => {
      if (!id) return [];
      const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM ${table} WHERE ${field} = ?`, [id]);
      return rows;
    };

    let personalDetails = await fetchOne('employee_information_personal_details');
    const employmentDetails = employee ? { dateJoined: employee.dateJoined, probationStatus: employee.probationStatus, permanentEffectiveDate: employee.permanentEffectiveDate } : null;
    const workstationDetails = await fetchOne('employee_information_workstation_details');
    let contactDetails = await fetchOne('employee_information_contact_details');
    const resignationDetails = await fetchOne('employee_information_resignation_details');
    const salaryHistories = await fetchMany('employee_salary_histories');
    let bankDetails = await fetchMany('employee_information_bank_details');

    const [attendanceRows] = await db.query<RowDataPacket[]>("SELECT *, COALESCE(groupId,rosterGroupId) AS assignedRosterId FROM attendance_roster_assignments WHERE employeeId=? AND status='Active' ORDER BY effectiveStartDate DESC, createdAt DESC LIMIT 1", [id]);
    const attendanceAssignment = attendanceRows[0];
    const attendance = attendanceAssignment ? { rosterGroupId: attendanceAssignment.assignedRosterId, effectiveStartDate: attendanceAssignment.effectiveStartDate } : null;

    let reportingManagerId = null;
    if (id) {
      reportingManagerId = employee.reportingManagerId || null;
    }
    if (workstationDetails) workstationDetails.supervisorId = reportingManagerId;
    
    let employmentType = null;
    if (employee && employee.employmentTypeId) {
      const [etRows] = await db.query<RowDataPacket[]>('SELECT * FROM employment_types WHERE id = ? LIMIT 1', [employee.employmentTypeId]);
      employmentType = etRows[0] || null;
    }
    
    if (contactDetails) {
      try { if (typeof contactDetails.permanent === 'string') contactDetails.permanent = JSON.parse(contactDetails.permanent); } catch {}
      try { if (typeof contactDetails.working === 'string') contactDetails.working = JSON.parse(contactDetails.working); } catch {}
      try { if (typeof contactDetails.official === 'string') contactDetails.official = JSON.parse(contactDetails.official); } catch {}
      try { if (typeof contactDetails.residential === 'string') contactDetails.residential = JSON.parse(contactDetails.residential); } catch {}
    }

    // Dynamic Fallback: Use Onboarding Profile data as Central Source of Truth
    const [onbRows] = await db.query<RowDataPacket[]>('SELECT * FROM onboarding_profiles WHERE candidateId = ? LIMIT 1', [userId]);
    const onboardingProfile = onbRows[0] || null;

    // Fetch user info & invite
    const [userRows] = await db.query<RowDataPacket[]>('SELECT id, name, email, role FROM users WHERE id = ? LIMIT 1', [userId]);
    const userInfo = userRows[0] || null;
    
    let inviteInfo = null;
    if (userInfo?.email) {
      const [invRows] = await db.query<RowDataPacket[]>('SELECT * FROM invites WHERE email = ? LIMIT 1', [userInfo.email]);
      inviteInfo = invRows[0] || null;
    }

    if (onboardingProfile || inviteInfo) {
      if (!personalDetails) {
        personalDetails = {
          firstName: onboardingProfile?.firstName || userInfo?.name?.split(' ')[0] || '', 
          lastName: onboardingProfile?.lastName || userInfo?.name?.split(' ').slice(1).join(' ') || '', 
          fullName: onboardingProfile ? `${onboardingProfile.firstName} ${onboardingProfile.lastName}` : userInfo?.name || '',
          dob: onboardingProfile?.dateOfBirth, gender: onboardingProfile?.gender, nationality: onboardingProfile?.nationality
        };
      } else {
        personalDetails.firstName = personalDetails.firstName || onboardingProfile?.firstName;
        personalDetails.lastName = personalDetails.lastName || onboardingProfile?.lastName;
        personalDetails.fullName = personalDetails.fullName || (onboardingProfile ? `${onboardingProfile.firstName} ${onboardingProfile.lastName}` : userInfo?.name);
        personalDetails.dob = personalDetails.dob || onboardingProfile?.dateOfBirth;
        personalDetails.gender = personalDetails.gender || onboardingProfile?.gender;
        personalDetails.nationality = personalDetails.nationality || onboardingProfile?.nationality;
      }
      
      if (!contactDetails) contactDetails = { permanent: null, working: null, official: null, residential: null };
      if (!contactDetails.permanent && onboardingProfile) {
        contactDetails.permanent = { address: [onboardingProfile.addressLine1, onboardingProfile.addressLine2].filter(Boolean).join(' '), city: onboardingProfile.city || '', postalCode: onboardingProfile.postalCode || '' };
      }
      if (!contactDetails.residential) contactDetails.residential = {};
      if ((!contactDetails.residential.emergencyContacts || contactDetails.residential.emergencyContacts.length === 0) && onboardingProfile?.emergencyContactName) {
        contactDetails.residential.emergencyContacts = [{ name: onboardingProfile.emergencyContactName, relationship: onboardingProfile.emergencyContactRelation, primaryPhone: onboardingProfile.emergencyContactPhone }];
      }
      
      if ((!bankDetails || bankDetails.length === 0) && onboardingProfile?.bankName) {
        bankDetails = [{
          bankName: onboardingProfile.bankName, accountHolderName: onboardingProfile.accountHolderName,
          accountNo: onboardingProfile.accountNumber, accountType: onboardingProfile.accountType, currency: onboardingProfile.currency
        }];
      }
      if (onboardingProfile) contactDetails = onboardingContact(contactDetails, onboardingProfile, userInfo?.email || '');
    }

    // Fetch designation name
    let designationName = null;
    if (workstationDetails?.designationId) {
      const [desRows] = await db.query<RowDataPacket[]>('SELECT name FROM designations WHERE id = ? LIMIT 1', [workstationDetails.designationId]);
      designationName = desRows[0]?.name || null;
    }

    const [[managerRow]] = await db.query('SELECT CONCAT_WS(\' \',firstName,lastName) AS name FROM employee_information_employees WHERE id=?',[employee?.reportingManagerId || null]);
    let finalEmploymentDetails: any = {...(employmentDetails || {}), designation:employee?.designation, department:employee?.department, employmentType:employmentType?.name || employee?.employmentType, organizationalRank:employee?.organizationalRank, reportingManager:managerRow?.name || (employee?.organizationalRank==='OWNER'?'Owner / no manager':'Not assigned')};
    if (inviteInfo) {
      finalEmploymentDetails.designation = finalEmploymentDetails.designation || inviteInfo.designation;
      finalEmploymentDetails.department = finalEmploymentDetails.department || inviteInfo.team;
      finalEmploymentDetails.employmentType = finalEmploymentDetails.employmentType || inviteInfo.employmentType;
      if (!finalEmploymentDetails.dateJoined && inviteInfo.joinedDate) {
        finalEmploymentDetails.dateJoined = inviteInfo.joinedDate;
      }
    }

    if (workstationDetails && workstationDetails.functionalRole !== undefined) {
      workstationDetails.functionalRoleId = workstationDetails.functionalRole;
    }

    if(contactDetails?.residential?.emergencyContacts)contactDetails.residential.emergencyContacts=identifiedContacts(contactDetails.residential.emergencyContacts);
    const extras = employee ? await getProfileExtras(employee.id) : {};
    await populateDetailLabels(personalDetails, workstationDetails);
    const fullEmployee = {
      ...(employee || {}),
      otherDetails: extras,
      payrollDetails: { dependents: extras.dependents || [] },
      isActive: Boolean(employee?.isActive),
      timeAndAttendanceActive: Boolean(employee?.timeAndAttendanceActive),
      payrollActive: Boolean(employee?.payrollActive),
      employmentType,
      personalDetails,
      employmentDetails: Object.keys(finalEmploymentDetails).length > 0 ? finalEmploymentDetails : null,
      workstationDetails: workstationDetails ? { ...workstationDetails, designationName } : null,
      contactDetails,
      resignationDetails,
      salaryHistories,
      bankDetails,
      attendance,
      user: userInfo
    };

    return res.json({ success: true, data: fullEmployee });
  } catch (error: any) {
    console.error('getMyEmployee error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const createEmployee = async (req: Request, res: Response) => {
  try {
    const originalBody = structuredClone(req.body);
    if (req.body.employmentDetails?.companyId !== undefined) req.body.workstationDetails = { ...req.body.workstationDetails, companyId: req.body.employmentDetails.companyId };
    let {
      userId,
      personalDetails,
      employmentDetails,
      workstationDetails,
      contactDetails,
      costCentres, // array
      salaryPayrollDetails,
      payrollDetails,
      resignationDetails
    } = req.body;

    // Helper to clean empty dates
    const cleanDate = (d: any) => (d === '' ? null : d ? new Date(d).toISOString().split('T')[0] : null);

    // Helper to completely prevent empty string foreign key and type errors
    const cleanEmptyStringsToNull = (obj: any) => {
      if (!obj) return obj;
      for (const key in obj) {
        if (obj[key] === '') {
          obj[key] = null;
        }
      }
      return obj;
    };

    if (personalDetails) {
      personalDetails = cleanEmptyStringsToNull(personalDetails);
      if (!personalDetails.fullName && (personalDetails.firstName || personalDetails.lastName)) personalDetails.fullName = [personalDetails.firstName,personalDetails.lastName].filter(Boolean).join(' ');
      const pDates = ['dob', 'marriedDate', 'divorcedDate', 'nicIssuedDate'];
      pDates.forEach(d => { if (personalDetails[d] !== undefined) personalDetails[d] = cleanDate(personalDetails[d]); });

      // Resolve UUID-based lookup fields → name strings (DB stores VARCHAR names, not FK UUIDs)
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (personalDetails.bloodGroup && uuidPattern.test(personalDetails.bloodGroup)) {
        const [bgRows] = await db.query<RowDataPacket[]>('SELECT name FROM eim_blood_groups WHERE id = ? LIMIT 1', [personalDetails.bloodGroup]);
        personalDetails.bloodGroup = bgRows[0]?.name || personalDetails.bloodGroup;
      }
      if (personalDetails.religion && uuidPattern.test(personalDetails.religion)) {
        const [relRows] = await db.query<RowDataPacket[]>('SELECT name FROM eim_religions WHERE id = ? LIMIT 1', [personalDetails.religion]);
        personalDetails.religion = relRows[0]?.name || personalDetails.religion;
      }
      if (personalDetails.civilStatus && uuidPattern.test(personalDetails.civilStatus)) {
        const [csRows] = await db.query<RowDataPacket[]>('SELECT name FROM eim_marital_statuses WHERE id = ? LIMIT 1', [personalDetails.civilStatus]);
        personalDetails.civilStatus = csRows[0]?.name || personalDetails.civilStatus;
      }
      if (personalDetails.gender && uuidPattern.test(personalDetails.gender)) {
        const [gRows] = await db.query<RowDataPacket[]>('SELECT name FROM eim_genders WHERE id = ? LIMIT 1', [personalDetails.gender]);
        personalDetails.gender = gRows[0]?.name || personalDetails.gender;
      }
      if (personalDetails.nationality && uuidPattern.test(personalDetails.nationality)) {
        const [nRows] = await db.query<RowDataPacket[]>('SELECT name FROM eim_nationalities WHERE id = ? LIMIT 1', [personalDetails.nationality]);
        personalDetails.nationality = nRows[0]?.name || personalDetails.nationality;
      }
      if (personalDetails.title && uuidPattern.test(personalDetails.title)) {
        // title stored as string — try resolving from any titles table if it exists
        try {
          const [tRows] = await db.query<RowDataPacket[]>('SELECT name FROM eim_titles WHERE id = ? LIMIT 1', [personalDetails.title]);
          if (tRows[0]) personalDetails.title = tRows[0].name;
        } catch { /* table may not exist yet */ }
      }
    }


    if (resignationDetails) {
      resignationDetails = cleanEmptyStringsToNull(resignationDetails);
      if (resignationDetails.dateResigned !== undefined) resignationDetails.dateResigned = cleanDate(resignationDetails.dateResigned);
      if (resignationDetails.dateOfRetirement !== undefined) resignationDetails.dateOfRetirement = cleanDate(resignationDetails.dateOfRetirement);
    }

    let employmentTypeId: string | null = null;
    if (employmentDetails) {
      employmentDetails = cleanEmptyStringsToNull(employmentDetails);
      if (employmentDetails.employmentTypeId) {
        employmentTypeId = employmentDetails.employmentTypeId;
      } else if (employmentDetails.employmentType) {
        const [typeRows] = await db.query<RowDataPacket[]>('SELECT id FROM employment_types WHERE name = ? LIMIT 1', [employmentDetails.employmentType]);
        const typeRecord = typeRows[0];
        if (typeRecord) {
          employmentTypeId = typeRecord.id;
          employmentDetails.employmentTypeId = typeRecord.id;
        }
      }
      
      const eDates = [
        'dateJoined', 'dateJoinedGroup', 'nextIncrementDate', 
        'employmentTypeEffectiveDate', 'permanentEffectiveDate',
        'probationStartDate', 'expectedConfirmationDate', 
        'contractStartDate', 'contractEndDate', 'contractToPermanentDate',
        'retirementDate', 'dateResigned', 'lastWorkingDate'
      ];
      eDates.forEach(d => { if (employmentDetails[d] !== undefined) employmentDetails[d] = cleanDate(employmentDetails[d]); });

      if (employmentDetails.basicSalary !== undefined) {
        employmentDetails.basicSalary = employmentDetails.basicSalary === null ? null : parseFloat(employmentDetails.basicSalary);
      }
      if (employmentDetails.workingHours !== undefined) {
        employmentDetails.workingHours = employmentDetails.workingHours === null ? null : parseFloat(employmentDetails.workingHours);
      }
      // Clean FK fields — empty strings break foreign key constraints
      if (!employmentDetails.designationId) employmentDetails.designationId = null;
      // Remove presentation fields and fields stored on the employee record.
      delete employmentDetails.employmentType;
      delete employmentDetails.employmentTypeId;
      delete employmentDetails.employeeNumber;
      delete employmentDetails.employmentStatus;
      delete employmentDetails.statusEffectiveDate;
      delete employmentDetails.payrollNo;
      delete employmentDetails.payrollActive;
      delete employmentDetails.timeAndAttendanceActive;
      delete employmentDetails.retirementDate;
      delete employmentDetails.dateResigned;
      delete employmentDetails.lastWorkingDate;
      delete employmentDetails.reasonForLeaving;
    }

    if (employmentDetails) {
      delete employmentDetails.rosterGroupId;
    }

    // Clean workstationDetails FK fields
    if (workstationDetails) {
      workstationDetails = cleanEmptyStringsToNull(workstationDetails);
      delete workstationDetails.supervisorId;
      delete workstationDetails.reportingManagerId;
      delete workstationDetails.jobGrade;       // string label — not a DB column
      delete workstationDetails.costCentre;     // string name — costCentreId is the FK
      
      // Clean up string names sent from frontend, only keep IDs
      delete workstationDetails.department;
      delete workstationDetails.designation;
      delete workstationDetails.company;
      delete workstationDetails.location;
      delete workstationDetails.division;
      
      if (workstationDetails.functionalRoleId !== undefined) {
        workstationDetails.functionalRole = workstationDetails.functionalRoleId;
        delete workstationDetails.functionalRoleId;
      }
    }
    if (contactDetails) {
      contactDetails = cleanEmptyStringsToNull(contactDetails);
      contactDetails = {
        permanent: contactDetails.permanent || null,
        working: contactDetails.working || null,
        official: contactDetails.official || null,
        residential: {
          personal: contactDetails.personal || null,
          emergencyContacts: contactDetails.emergencyContacts || []
        },
        primaryContactOption: contactDetails.primaryContactPreference || contactDetails.primaryContactOption || null,
        linkedIn: contactDetails.linkedIn || null
      };
    }

    // 1. Validation: Cost Centres must equal 100%
    if (costCentres && costCentres.length > 0) {
      costCentres = costCentres.map((cc: any) => ({ ...cc, percentage: parseFloat(cc.percentage) }));
      const totalPercentage = costCentres.reduce((acc: number, cc: any) => acc + (cc.percentage || 0), 0);
      if (totalPercentage !== 100) {
        return res.status(400).json({ success: false, message: 'Total Cost Centre percentage must equal exactly 100%.' });
      }
    }

    // 2. Generate Employee Number
    const [countRows] = await db.query<RowDataPacket[]>('SELECT COUNT(*) as cnt FROM employee_information_employees');
    const count = countRows[0].cnt;
    const employeeNo = `EMP-${(count + 1).toString().padStart(6, '0')}`;

    let user;
    let newUserData = null;
    let autoMappedOnboarding = null;
    if (userId) {
      const [userRows] = await db.query<RowDataPacket[]>('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
      user = userRows[0];
      if (!user) return res.status(404).json({ success: false, message: 'User account to link not found.' });

      const [existingEmpRows] = await db.query<RowDataPacket[]>('SELECT id FROM employee_information_employees WHERE userId = ? LIMIT 1', [user.id]);
      if (existingEmpRows.length > 0) return res.status(400).json({ success: false, message: 'This user account is already linked to an employee.' });

      if (user.role === 'CANDIDATE') {
        
        // Auto-pull Onboarding Data for physical sync during creation
        const [onbRows] = await db.query<RowDataPacket[]>('SELECT * FROM onboarding_profiles WHERE candidateId = ? LIMIT 1', [userId]);
        autoMappedOnboarding = onbRows[0] || null;
      }
    } else {
      const emailToUse = contactDetails?.official?.email;
      if (emailToUse) {
        const [existingUserRows] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE email = ? LIMIT 1', [emailToUse]);
        if (existingUserRows.length > 0) return res.status(400).json({ success: false, message: 'The provided official email is already associated with an existing system account (e.g., Admin).' });
      }
      const fallbackEmail = `emp_${Date.now()}@company.com`;
      const newUserId = uuidv4();
      const bcrypt = require('bcryptjs');
      const defaultHash = await bcrypt.hash('Emp@123', 10);
      newUserData = [newUserId, emailToUse || fallbackEmail, defaultHash, personalDetails?.fullName || 'New Employee', 'EMPLOYEE'];
      user = { id: newUserId };
    }
    
    // Auto-Sync Onboarding Data physically if missing from HR form
    if (autoMappedOnboarding) {
      if (!personalDetails || Object.keys(personalDetails).length === 0) {
        personalDetails = {
          firstName: autoMappedOnboarding.firstName,
          lastName: autoMappedOnboarding.lastName,
          fullName: `${autoMappedOnboarding.firstName} ${autoMappedOnboarding.lastName}`,
          dob: autoMappedOnboarding.dateOfBirth,
          gender: autoMappedOnboarding.gender,
          nationality: autoMappedOnboarding.nationality
        };
      }
      
      if (!contactDetails || Object.keys(contactDetails).length === 0) {
        contactDetails = {
          permanent: { address: [autoMappedOnboarding.addressLine1, autoMappedOnboarding.addressLine2].filter(Boolean).join(' '), city: autoMappedOnboarding.city || '', postalCode: autoMappedOnboarding.postalCode || '' },
          residential: { emergencyContacts: [{ name: autoMappedOnboarding.emergencyContactName, relationship: autoMappedOnboarding.emergencyContactRelation, primaryPhone: autoMappedOnboarding.emergencyContactPhone }] }
        };
      }
      contactDetails = onboardingContact(contactDetails, autoMappedOnboarding, user.email || '');
      
      if (!payrollDetails?.bankDetails?.bank && autoMappedOnboarding.bankName) {
        if (!payrollDetails) payrollDetails = {};
        if (!payrollDetails.bankDetails) payrollDetails.bankDetails = {};
        payrollDetails.bankDetails.bank = autoMappedOnboarding.bankName;
        payrollDetails.bankDetails.accountHolderName = autoMappedOnboarding.accountHolderName;
        payrollDetails.bankDetails.accountNumber = autoMappedOnboarding.accountNumber;
        payrollDetails.bankDetails.accountType = autoMappedOnboarding.accountType;
        payrollDetails.bankDetails.currency = autoMappedOnboarding.currency;
      }
    }

    const employeeId = uuidv4();
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      // Account creation/conversion and profile creation must succeed together.
      if (newUserData) await connection.query('INSERT INTO users (id,email,password,name,role,isActive,createdAt,updatedAt) VALUES (?,?,?,?,?,1,NOW(),NOW())', newUserData);
      else if (user.role === 'CANDIDATE') await connection.query('UPDATE users SET role="EMPLOYEE",updatedAt=NOW() WHERE id=?', [user.id]);

      const employeeData = {
        id: employeeId, userId: user.id, employeeNo, isActive: 1, 
        payrollNo: req.body.employmentDetails?.payrollNo || salaryPayrollDetails?.payrollNo || null,
        timeAndAttendanceActive: req.body.employmentDetails?.timeAndAttendanceActive !== false ? 1 : 0,
        payrollActive: req.body.employmentDetails?.payrollActive !== false ? 1 : 0,
        employeeStatus: req.body.employmentDetails?.employmentStatus || 'Active',
        employeeGroup: req.body.employmentDetails?.employeeGroup || null,
        employmentTypeId: employmentTypeId || null,
        dateJoined: req.body.employmentDetails?.dateJoined || null,
        probationStatus: req.body.employmentDetails?.probationStatus || 'Probation',
        permanentEffectiveDate: req.body.employmentDetails?.permanentEffectiveDate || null,
        reportingManagerId: null,
        createdAt: new Date(), updatedAt: new Date()
      };
      await connection.query('INSERT INTO employee_information_employees SET ?', employeeData);

      if (personalDetails) {
        personalDetails.id = uuidv4();
        personalDetails.employeeId = employeeId;
        await connection.query('INSERT INTO employee_information_personal_details SET ?', personalDetails);
      }
      // Employment details are mapped directly to employees table now
      if (workstationDetails && Object.keys(workstationDetails).some(k => workstationDetails[k])) {
        workstationDetails.id = uuidv4();
        workstationDetails.employeeId = employeeId;
        await connection.query('INSERT INTO employee_information_workstation_details SET ?', workstationDetails);
      }
      if (contactDetails) {
        const contactData = {
          id: uuidv4(),
          employeeId,
          permanent: contactDetails.permanent ? JSON.stringify(contactDetails.permanent) : null,
          working: contactDetails.working ? JSON.stringify(contactDetails.working) : null,
          official: contactDetails.official ? JSON.stringify(contactDetails.official) : null,
          residential: contactDetails.residential ? JSON.stringify(contactDetails.residential) : null,
          primaryContactOption: contactDetails.primaryContactOption,
          linkedIn: contactDetails.linkedIn || null
        };
        await connection.query('INSERT INTO employee_information_contact_details SET ?', contactData);
      }
      if (resignationDetails?.dateResigned) {
        resignationDetails.id = uuidv4();
        resignationDetails.employeeId = employeeId;
        await connection.query('INSERT INTO employee_information_resignation_details SET ?', resignationDetails);
      }
      if (payrollDetails?.bankDetails && payrollDetails.bankDetails.bank) {
        const bankData = {
          id: uuidv4(),
          employeeId,
          bankName: payrollDetails.bankDetails.bank,
          accountHolderName: payrollDetails.bankDetails.accountName || payrollDetails.bankDetails.accountHolderName || null,
          branch: payrollDetails.bankDetails.branch || '',
          accountType: payrollDetails.bankDetails.accountType || 'Savings',
          accountNo: payrollDetails.bankDetails.accountNumber || '',
          currency: payrollDetails.bankDetails.currency || 'LKR',
          transferMode: 'Percentage',
          amountOrPercentage: payrollDetails.bankDetails.paymentAllocation ? parseFloat(payrollDetails.bankDetails.paymentAllocation) : 100,
          priority: payrollDetails.bankDetails.priority ? parseInt(payrollDetails.bankDetails.priority) : 1,
          isActive: payrollDetails.bankDetails.isActive !== false ? 1 : 0
        };
        await connection.query('INSERT INTO employee_information_bank_details SET ?', bankData);
      }
      
      await syncEmployeeMappings(connection, employeeId);
      await updateEmployeeReporting(connection, employeeId, originalBody, (req as any).user.userId);
      
      const auditLogId = uuidv4();
      await connection.query(
        'INSERT INTO employee_information_audit_logs (id, employeeId, userId, action, ipAddress, createdAt) VALUES (?, ?, ?, ?, ?, NOW())', 
        [auditLogId, employeeId, (req as any).user?.userId || 'SYSTEM', 'CREATED', req.ip]
      );

      await connection.commit();
      
      // Auto-generate entitlements after employee is successfully created
      const creationStatus = req.body.employmentDetails?.employmentStatus || 'Active';
      if (employmentDetails && employmentDetails.dateJoined && creationStatus === 'Active') {
        try {
          await processEntitlementsForEmployee(employeeId);
        } catch (err: any) {
          console.error('Failed to automatically generate leaves on creation:', err.message);
        }
      }

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    const [createdRows] = await db.query<RowDataPacket[]>('SELECT * FROM employee_information_employees WHERE id = ? LIMIT 1', [employeeId]);
    return res.status(201).json({ success: true, message: `Employee successfully created. Employee No: ${employeeNo}`, data: createdRows[0] });
  } catch (error: any) {
    console.error('Error creating employee:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server Error' });
  }
};

export const uploadAttachment = async (req: Request, res: Response) => {
  try {
    const employeeId = req.params.employeeId as string;
    const files = req.files as Express.Multer.File[];
    const user = (req as any).user;
    const access = await organizationAccess(user.userId);
    if (!access.admin && access.employeeId !== employeeId) return res.status(403).json({ success:false,message:'You can upload attachments only to your own employee profile.' });

    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }

    const attachments = [];
    for (const file of files) {
      const attachId = uuidv4();
      const attachData = {
        id: attachId,
        employeeId,
        fileName: file.originalname,
        fileType: file.mimetype,
        fileSize: file.size,
        fileUrl: `/api/files/${encodeURIComponent(file.filename)}`,
        uploadedAt: new Date()
      };
      await db.query('INSERT INTO employee_information_employee_attachments SET ?', attachData);
      const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM employee_information_employee_attachments WHERE id = ? LIMIT 1', [attachId]);
      attachments.push(rows[0]);
    }

    return res.json({ success: true, data: attachments });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getAttachments = async (req: Request, res: Response) => {
  try {
    const employeeId = req.params.employeeId as string;
    const access = await organizationAccess(req.user!.userId);
    if (!access.admin && !access.visibleIds.includes(employeeId)) return res.status(403).json({ success:false,message:'You do not have access to these employee documents.' });
    const [attachments] = await db.query<RowDataPacket[]>('SELECT * FROM employee_information_employee_attachments WHERE employeeId = ? ORDER BY uploadedAt DESC', [employeeId]);
    // Keep onboarding files linked to their original verification records. They are
    // visible in Employee Information without copying files or losing HR decisions.
    const [onboardingDocuments] = await db.query<RowDataPacket[]>(`
      SELECT d.id, d.type, d.label, d.fileUrl, d.fileName, d.fileSize, d.fileType,
             d.status, d.createdAt
      FROM documents d
      JOIN employee_information_employees e ON e.userId = d.candidateId
      WHERE e.id = ?
      ORDER BY d.createdAt DESC
    `, [employeeId]);
    const linkedDocuments = onboardingDocuments.map(doc => ({
      id: doc.id,
      employeeId,
      originalName: doc.fileName,
      fileName: doc.fileName,
      fileUrl: doc.fileUrl,
      fileType: doc.fileType,
      fileSize: doc.fileSize,
      uploadedAt: doc.createdAt,
      uploadedBy: 'Onboarding',
      category: doc.type === 'PREVIOUS_SERVICE' ? 'Previous Service' : doc.label,
      status: doc.status === 'APPROVED' ? 'Verified' : doc.status === 'REJECTED' ? 'Rejected' : 'Pending',
      source: 'onboarding',
    }));
    return res.json({ success: true, data: [...linkedDocuments, ...attachments] });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const deleteAttachment = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const [[attachment]] = await db.query<RowDataPacket[]>('SELECT employeeId FROM employee_information_employee_attachments WHERE id=?',[id]);
    if (!attachment) return res.status(404).json({success:false,message:'Attachment not found.'});
    const access = await organizationAccess(req.user!.userId);
    if (!access.admin && access.employeeId !== attachment.employeeId) return res.status(403).json({success:false,message:'You can delete only your own attachments.'});
    await db.query('DELETE FROM employee_information_employee_attachments WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Attachment deleted successfully' });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const uploadProfilePicture = async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const filePath = `/uploads/${file.filename}`;
    return res.json({ success: true, filePath });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const checkEmployeeNo = async (req: Request, res: Response) => {
  try {
    const empNo = req.params.empNo as string;
    const [rows] = await db.query<RowDataPacket[]>('SELECT id FROM employee_information_employees WHERE employeeNo = ? LIMIT 1', [empNo]);
    const existing = rows[0];
    return res.json({ success: true, available: !existing });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const updateEmployee = async (req: Request, res: Response) => {
  try {
    const originalBody = structuredClone(req.body);
    if(req.body.employmentDetails?.companyId !== undefined) req.body.workstationDetails={...req.body.workstationDetails,companyId:req.body.employmentDetails.companyId};
    const id = req.params.id as string;
    const user = (req as any).user;
    let {
      personalDetails,
      employmentDetails,
      workstationDetails,
      contactDetails,
      costCentres, // array
      salaryPayrollDetails,
      payrollDetails,
      resignationDetails
    } = req.body;

    // Preserve existing employment values when only part of the profile changes.
    const [empRows] = await db.query<RowDataPacket[]>('SELECT * FROM employee_information_employees WHERE id = ? LIMIT 1', [id]);
    const existingEmployee = empRows[0];
    const finalStatus = req.body.employmentDetails?.employmentStatus || existingEmployee?.employeeStatus;

    // 1. Validation: Cost Centres must equal 100%
    if (costCentres && costCentres.length > 0) {
      const totalPercentage = costCentres.reduce((acc: number, curr: any) => acc + (curr.percentage || 0), 0);
      if (totalPercentage !== 100) {
        return res.status(400).json({ success: false, message: 'Cost Centre percentage must equal 100%' });
      }
    }

    // Helper to clean empty dates
    const cleanDate = (d: any) => (d === '' ? null : d ? new Date(d).toISOString().split('T')[0] : null);

    // 2. Data Cleaning & Type Casting
    // Helper to completely prevent empty string foreign key and type errors
    const cleanEmptyStringsToNull = (obj: any) => {
      if (!obj) return obj;
      for (const key in obj) {
        if (obj[key] === '') {
          obj[key] = null;
        }
      }
      return obj;
    };

    if (personalDetails) {
      personalDetails = cleanEmptyStringsToNull(personalDetails);
      const pDates = ['dob', 'marriedDate', 'divorcedDate', 'nicIssuedDate'];
      pDates.forEach(d => { if (personalDetails[d] !== undefined) personalDetails[d] = cleanDate(personalDetails[d]); });

      // Resolve UUID-based lookup fields → name strings
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (personalDetails.bloodGroup && uuidPattern.test(personalDetails.bloodGroup)) {
        const [bgRows] = await db.query<RowDataPacket[]>('SELECT name FROM eim_blood_groups WHERE id = ? LIMIT 1', [personalDetails.bloodGroup]);
        personalDetails.bloodGroup = bgRows[0]?.name || personalDetails.bloodGroup;
      }
      if (personalDetails.religion && uuidPattern.test(personalDetails.religion)) {
        const [relRows] = await db.query<RowDataPacket[]>('SELECT name FROM eim_religions WHERE id = ? LIMIT 1', [personalDetails.religion]);
        personalDetails.religion = relRows[0]?.name || personalDetails.religion;
      }
      if (personalDetails.civilStatus && uuidPattern.test(personalDetails.civilStatus)) {
        const [csRows] = await db.query<RowDataPacket[]>('SELECT name FROM eim_marital_statuses WHERE id = ? LIMIT 1', [personalDetails.civilStatus]);
        personalDetails.civilStatus = csRows[0]?.name || personalDetails.civilStatus;
      }
      if (personalDetails.gender && uuidPattern.test(personalDetails.gender)) {
        const [gRows] = await db.query<RowDataPacket[]>('SELECT name FROM eim_genders WHERE id = ? LIMIT 1', [personalDetails.gender]);
        personalDetails.gender = gRows[0]?.name || personalDetails.gender;
      }
      if (personalDetails.nationality && uuidPattern.test(personalDetails.nationality)) {
        const [nRows] = await db.query<RowDataPacket[]>('SELECT name FROM eim_nationalities WHERE id = ? LIMIT 1', [personalDetails.nationality]);
        personalDetails.nationality = nRows[0]?.name || personalDetails.nationality;
      }
      if (personalDetails.title && uuidPattern.test(personalDetails.title)) {
        try {
          const [tRows] = await db.query<RowDataPacket[]>('SELECT name FROM eim_titles WHERE id = ? LIMIT 1', [personalDetails.title]);
          if (tRows[0]) personalDetails.title = tRows[0].name;
        } catch { /* table may not exist */ }
      }
    }


    if (resignationDetails) {
      resignationDetails = cleanEmptyStringsToNull(resignationDetails);
      if (resignationDetails.dateResigned !== undefined) resignationDetails.dateResigned = cleanDate(resignationDetails.dateResigned);
      if (resignationDetails.dateOfRetirement !== undefined) resignationDetails.dateOfRetirement = cleanDate(resignationDetails.dateOfRetirement);
    }

    let employmentTypeId: string | null = null;
    if (employmentDetails) {
      employmentDetails = cleanEmptyStringsToNull(employmentDetails);
      if (employmentDetails.employmentTypeId) {
        employmentTypeId = employmentDetails.employmentTypeId;
      } else if (employmentDetails.employmentType) {
        const [typeRows] = await db.query<RowDataPacket[]>('SELECT id FROM employment_types WHERE name = ? LIMIT 1', [employmentDetails.employmentType]);
        const typeRecord = typeRows[0];
        if (typeRecord) {
          employmentTypeId = typeRecord.id;
          employmentDetails.employmentTypeId = typeRecord.id;
        }
      }
      
      const eDates = [
        'dateJoined', 'dateJoinedGroup', 'nextIncrementDate', 
        'employmentTypeEffectiveDate', 'permanentEffectiveDate',
        'probationStartDate', 'expectedConfirmationDate', 
        'contractStartDate', 'contractEndDate', 'contractToPermanentDate',
        'retirementDate', 'dateResigned', 'lastWorkingDate'
      ];
      
      // Inject salary details from payroll tab into employment details
      if (payrollDetails?.salaryDetails) {
        employmentDetails.basicSalary = payrollDetails.salaryDetails.basicSalary;
        employmentDetails.currency = payrollDetails.salaryDetails.currency;
        if (payrollDetails.salaryDetails.effectiveDate) {
          employmentDetails.nextIncrementDate = payrollDetails.salaryDetails.effectiveDate;
        }
      }

      eDates.forEach(d => { if (employmentDetails[d] !== undefined) employmentDetails[d] = cleanDate(employmentDetails[d]); });
      
      if (employmentDetails.basicSalary !== undefined) {
        employmentDetails.basicSalary = employmentDetails.basicSalary === '' ? null : parseFloat(employmentDetails.basicSalary);
      }
      if (employmentDetails.workingHours !== undefined) {
        employmentDetails.workingHours = employmentDetails.workingHours === '' ? null : parseFloat(employmentDetails.workingHours);
      }
      if (!employmentDetails.designationId) employmentDetails.designationId = null;
      
      delete employmentDetails.locationId;
      delete employmentDetails.supervisorId;
      delete employmentDetails.employeeGroup;
      delete employmentDetails.employmentType;
      delete employmentDetails.employmentTypeId;
      delete employmentDetails.employeeNumber;
      delete employmentDetails.employmentStatus;
      delete employmentDetails.statusEffectiveDate;
      delete employmentDetails.payrollNo;
      delete employmentDetails.payrollActive;
      delete employmentDetails.timeAndAttendanceActive;
      delete employmentDetails.retirementDate;
      delete employmentDetails.dateResigned;
      delete employmentDetails.lastWorkingDate;
      delete employmentDetails.reasonForLeaving;
    }

    if (employmentDetails) {
      delete employmentDetails.rosterGroupId;
    }

    if (workstationDetails) {
      workstationDetails = cleanEmptyStringsToNull(workstationDetails);
      if (!workstationDetails.locationId) workstationDetails.locationId = null;
      delete workstationDetails.supervisorId;
      delete workstationDetails.reportingManagerId;
      delete workstationDetails.jobGrade;       // string label — not a DB column
      delete workstationDetails.costCentre;     // string name — costCentreId is the FK
      
      // Clean up string names sent from frontend, only keep IDs
      delete workstationDetails.department;
      delete workstationDetails.designation;
      delete workstationDetails.company;
      delete workstationDetails.location;
      delete workstationDetails.division;

      if (workstationDetails.functionalRoleId !== undefined) {
        workstationDetails.functionalRole = workstationDetails.functionalRoleId;
        delete workstationDetails.functionalRoleId;
      }
    }

    if (costCentres && costCentres.length > 0) {
      costCentres = costCentres.map((cc: any) => ({ ...cc, percentage: parseFloat(cc.percentage) || 0 }));
    }

    if (contactDetails) {
      contactDetails = {
        permanent: contactDetails.permanent || null,
        working: contactDetails.working || null,
        official: contactDetails.official || null,
        residential: {
          personal: contactDetails.personal || null,
          emergencyContacts: contactDetails.emergencyContacts || []
        },
        primaryContactOption: contactDetails.primaryContactPreference || contactDetails.primaryContactOption || null,
        linkedIn: contactDetails.linkedIn || null
      };
    }

    // 3. Perform updates
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      
      const empUpdateKeys = [];
      const empUpdateVals = [];
      if (originalBody.employmentDetails?.payrollNo !== undefined || salaryPayrollDetails?.payrollNo !== undefined) { empUpdateKeys.push('payrollNo = ?'); empUpdateVals.push(originalBody.employmentDetails?.payrollNo || salaryPayrollDetails?.payrollNo || null); }
      if (originalBody.employmentDetails?.timeAndAttendanceActive !== undefined) { empUpdateKeys.push('timeAndAttendanceActive = ?'); empUpdateVals.push(originalBody.employmentDetails.timeAndAttendanceActive !== false ? 1 : 0); }
      if (originalBody.employmentDetails?.payrollActive !== undefined) { empUpdateKeys.push('payrollActive = ?'); empUpdateVals.push(originalBody.employmentDetails.payrollActive !== false ? 1 : 0); }
      if (originalBody.employmentDetails?.employmentStatus !== undefined) { empUpdateKeys.push('employeeStatus = ?'); empUpdateVals.push(originalBody.employmentDetails.employmentStatus || 'Active'); }
      if (originalBody.employmentDetails?.employeeGroup !== undefined) { empUpdateKeys.push('employeeGroup = ?'); empUpdateVals.push(originalBody.employmentDetails.employeeGroup || null); }
      if (employmentTypeId !== null) { empUpdateKeys.push('employmentTypeId = ?'); empUpdateVals.push(employmentTypeId); }
      await updateEmployeeReporting(connection, id, originalBody, user.userId);
      empUpdateKeys.push('updatedAt = NOW()');
      if (empUpdateKeys.length > 0) {
        await connection.query(`UPDATE employee_information_employees SET ${empUpdateKeys.join(', ')} WHERE id = ?`, [...empUpdateVals, id]);
      }

      const upsert = async (table: string, data: any, pk: string = 'employeeId') => {
        const [existing] = await connection.query<RowDataPacket[]>(`SELECT id FROM ${table} WHERE ${pk} = ? LIMIT 1`, [id]);
        if (existing.length > 0) {
          const [columns] = await connection.query(`SHOW COLUMNS FROM ${table}`);
          const allowed = new Set(columns.map(c=>c.Field));
          const keys = Object.keys(data).filter(k=>allowed.has(k) && !['id','employeeId','createdAt','updatedAt'].includes(k));
          if (keys.length === 0) return;
          const setClause = keys.map(k => `\`${k}\` = ?`).join(', ');
          const values = keys.map(k => data[k]);
          await connection.query(`UPDATE ${table} SET ${setClause} WHERE ${pk} = ?`, [...values, id]);
        } else {
          data.id = uuidv4();
          data[pk] = id;
          const [columns] = await connection.query(`SHOW COLUMNS FROM ${table}`);
          const allowed = new Set(columns.map(c=>c.Field));
          const keys = Object.keys(data).filter(k=>allowed.has(k));
          const placeholders = keys.map(() => '?').join(', ');
          const values = keys.map(k => data[k]);
          const backtickedKeys = keys.map(k => `\`${k}\``).join(', ');
          await connection.query(`INSERT INTO ${table} (${backtickedKeys}) VALUES (${placeholders})`, values);
        }
      };

      if (personalDetails) {
        if (personalDetails.fullName === undefined && (personalDetails.firstName !== undefined || personalDetails.lastName !== undefined)) {
          const [[previousPersonal]] = await connection.query<RowDataPacket[]>('SELECT firstName,lastName FROM employee_information_personal_details WHERE employeeId=?',[id]);
          personalDetails.fullName = [personalDetails.firstName ?? previousPersonal?.firstName,personalDetails.lastName ?? previousPersonal?.lastName].filter(Boolean).join(' ');
        }
        await upsert('employee_information_personal_details', personalDetails);
      }
      if (employmentDetails) {
        await connection.query('UPDATE employee_information_employees SET dateJoined = ?, probationStatus = ?, permanentEffectiveDate = ? WHERE id = ?', [
          employmentDetails.dateJoined === undefined ? existingEmployee.dateJoined : employmentDetails.dateJoined || null,
          employmentDetails.probationStatus === undefined ? existingEmployee.probationStatus : employmentDetails.probationStatus,
          employmentDetails.permanentEffectiveDate === undefined ? existingEmployee.permanentEffectiveDate : employmentDetails.permanentEffectiveDate || null,
          id
        ]);
      }
      if (workstationDetails) await upsert('employee_information_workstation_details', workstationDetails);
      await syncEmployeeMappings(connection, id);
      if (contactDetails) {
        const contactData = {
          permanent: contactDetails.permanent ? JSON.stringify(contactDetails.permanent) : null,
          working: contactDetails.working ? JSON.stringify(contactDetails.working) : null,
          official: contactDetails.official ? JSON.stringify(contactDetails.official) : null,
          residential: contactDetails.residential ? JSON.stringify(contactDetails.residential) : null,
          primaryContactOption: contactDetails.primaryContactOption,
          linkedIn: contactDetails.linkedIn || null
        };
        await upsert('employee_information_contact_details', contactData);
      }
      
      if (payrollDetails?.bankDetails?.bank) {
        await connection.query('DELETE FROM employee_information_bank_details WHERE employeeId = ?', [id]);
        const bankData = {
          id: uuidv4(),
          employeeId: id,
          bankName: payrollDetails.bankDetails.bank,
          accountHolderName: payrollDetails.bankDetails.accountName || payrollDetails.bankDetails.accountHolderName || null,
          branch: payrollDetails.bankDetails.branch || '',
          accountType: payrollDetails.bankDetails.accountType || 'Savings',
          accountNo: payrollDetails.bankDetails.accountNumber || '',
          currency: payrollDetails.bankDetails.currency || 'LKR',
          transferMode: 'Percentage',
          amountOrPercentage: payrollDetails.bankDetails.paymentAllocation ? parseFloat(payrollDetails.bankDetails.paymentAllocation) : 100,
          priority: payrollDetails.bankDetails.priority ? parseInt(payrollDetails.bankDetails.priority) : 1,
          isActive: payrollDetails.bankDetails.isActive !== false ? 1 : 0
        };
        await connection.query('INSERT INTO employee_information_bank_details SET ?', bankData);
      }

      if (resignationDetails?.dateResigned) {
        await upsert('employee_information_resignation_details', resignationDetails);
      }


      await connection.query(
        'INSERT INTO employee_information_audit_logs (id, employeeId, userId, action, fieldChanged, previousValue, newValue, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
        [uuidv4(), id, user?.userId || user?.id || 'SYSTEM', 'UPDATE_EMPLOYEE', 'multiple', 'N/A', 'N/A']
      );

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    // Check if we need to recalculate leaves
    if (finalStatus === 'Active' && originalBody.employmentDetails && ['dateJoined','employmentType','employmentTypeId','employmentStatus','probationStatus','permanentEffectiveDate'].some(key=>originalBody.employmentDetails[key]!==undefined)) {
      let autoConfirmed = false;
      const dateJoinedStr = req.body.employmentDetails?.dateJoined || existingEmployee?.employmentDetails?.dateJoined;
      
      if (dateJoinedStr) {
        const newDateJoined = new Date(dateJoinedStr).getTime();
        
        // Auto-confirmation logic: If they are on probation and the date joined is > 1 year ago, confirm them automatically.
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        
        const isProbation = existingEmployee?.employmentDetails?.probationStatus === 'Probation' || req.body.employmentDetails?.employmentType === 'Probation' || req.body.employmentType === 'Probation';
        
        if (isProbation && newDateJoined <= oneYearAgo.getTime()) {
           try {
             const effectiveDate = new Date(newDateJoined);
             effectiveDate.setFullYear(effectiveDate.getFullYear() + 1);
             await ProbationConfirmationService.confirmPermanent(id, effectiveDate, user?.userId || 'SYSTEM');
             autoConfirmed = true;
           } catch(e: any) {
             console.error("Auto confirm failed during update:", e.message);
           }
        }
      }
      
      if (!autoConfirmed) {
        try {
          await processEntitlementsForEmployee(id);
        } catch (err: any) {
          console.error('Failed to automatically recalculate leaves:', err.message);
        }
      } else {
        return res.json({ success: true, message: 'Employee updated and automatically confirmed as Permanent based on the backdated joining date.' });
      }
    }

    return res.json({ success: true, message: 'Employee updated successfully' });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server Error: ' + error.message });
  }
};


export const convertCandidate = async (req: Request, res: Response) => {
  try {
    const candidateId = req.params.candidateId as string;
    
    const [candidateRows] = await db.query<RowDataPacket[]>('SELECT * FROM users WHERE id = ? LIMIT 1', [candidateId]);
    const candidate = candidateRows[0];
    const [obpRows] = await db.query<RowDataPacket[]>('SELECT * FROM onboarding_profiles WHERE candidateId = ? LIMIT 1', [candidateId]);
    const obp = obpRows[0];

    if (!candidate || candidate.role !== 'CANDIDATE') {
      return res.status(404).json({ success: false, message: 'Candidate not found or invalid role' });
    }

    const [countRows] = await db.query<RowDataPacket[]>('SELECT COUNT(*) as cnt FROM employee_information_employees');
    const count = countRows[0].cnt;
    const employeeNo = `EMP-${(count + 1).toString().padStart(6, '0')}`;
    const employeeId = uuidv4();

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query(
        'INSERT INTO employee_information_employees (id, userId, employeeNo, isActive, employeeStatus, createdAt, updatedAt) VALUES (?, ?, ?, 1, "Active", NOW(), NOW())',
        [employeeId, candidate.id, employeeNo]
      );

      const personalDetails = {
        id: uuidv4(),
        employeeId,
        firstName: obp?.firstName || '',
        lastName: obp?.lastName || '',
        fullName: obp ? `${obp.firstName} ${obp.lastName || ''}`.trim() : candidate.name,
        gender: obp?.gender || 'Male',
        nationality: obp?.nationality || null,
        civilStatus: obp?.civilStatus || 'Single',
        dob: obp?.dateOfBirth ? new Date(obp.dateOfBirth) : null,
        nicNo: obp?.nicNo || null,
      };
      await connection.query('INSERT INTO employee_information_personal_details SET ?', personalDetails);

      const workstationDetails = { id: uuidv4(), employeeId };
      await connection.query('INSERT INTO employee_information_workstation_details SET ?', workstationDetails);

      const mappedContact = obp ? onboardingContact(null, obp, candidate.email) : null;
      const contactDetails = {
        id: uuidv4(),
        employeeId,
        official: JSON.stringify({ email: candidate.email }),
        permanent: mappedContact ? JSON.stringify(mappedContact.permanent) : null,
        residential: mappedContact ? JSON.stringify(mappedContact.residential) : null,
        linkedIn: mappedContact?.linkedIn || null
      };
      await connection.query('INSERT INTO employee_information_contact_details SET ?', contactDetails);

      if (obp?.bankName) {
        const bankDetails = {
          id: uuidv4(),
          employeeId,
          bankName: obp.bankName || '',
          branch: '',
          accountType: obp.accountType || 'Savings',
          accountNo: obp.accountNumber || '',
          currency: obp.currency || 'LKR',
          accountHolderName: obp.accountHolderName || null,
          transferMode: 'Percentage',
          amountOrPercentage: 100,
          priority: 1,
          isActive: 1
        };
        await connection.query('INSERT INTO employee_information_bank_details SET ?', bankDetails);
      }

      await connection.query('UPDATE users SET role = "EMPLOYEE", updatedAt = NOW() WHERE id = ?', [candidate.id]);
      await syncEmployeeMappings(connection,employeeId);
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    const [empOutputRows] = await db.query<RowDataPacket[]>('SELECT * FROM employee_information_employees WHERE id = ? LIMIT 1', [employeeId]);
    const employee = empOutputRows[0];

    return res.status(200).json({ success: true, message: 'Candidate successfully converted to Employee.', data: employee });

  } catch (error: any) {
    console.error('Error converting candidate:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server Error' });
  }
};
