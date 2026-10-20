import 'dotenv/config';
import { db } from './lib/db';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  console.log('Seeding EIM Realistic Demo Data...');

  try {
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    const tables = [
      'eim_job_profiles', 'designations', 'eim_structures', 'eim_locations', 'eim_companies',
      'eim_salary_grades', 'employment_types'
    ];
    for (const table of tables) {
      await db.query(`DELETE FROM ${table}`);
    }
    await db.query('SET FOREIGN_KEY_CHECKS = 1');

    console.log('Cleared old EIM data. Inserting real mock data...');
    const now = new Date().toISOString().split('T')[0];

    // 1. Company
    const cId = uuidv4();
    await db.query(`INSERT INTO eim_companies (id, code, name, registrationNumber, taxNumber, description, address, country, contactNumber, email, logo, parentCompanyId, effectiveStartDate, effectiveEndDate, isActive) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      [cId, 'COMP01', 'PeoplesHR Tech Ltd', 'REG-123456', 'TAX-7890', 'HQ Company', 'Colombo 03', 'Sri Lanka', '+94112345678', 'info@peopleshr.com', null, null, now, null, 1]
    );

    // 2. Location
    const lId = uuidv4();
    await db.query(`INSERT INTO eim_locations (id, code, name, address, city, country, companyId, locationType, province, district, timeZone, contactNumber, isActive) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      [lId, 'LOC-COL', 'Colombo HQ', '123 Main St', 'Colombo', 'Sri Lanka', cId, 'Headquarters', 'Western', 'Colombo', 'Asia/Colombo', '+94112345678', 1]
    );

    // 3. Departments (Structures)
    const dep1 = uuidv4();
    const dep2 = uuidv4();
    const dep3 = uuidv4();
    await db.query(`INSERT INTO eim_structures (id, code, name, structureType, parentId, companyId, locationId, costCentreId, headPositionId, effectiveStartDate, effectiveEndDate, isActive) VALUES 
      (?, 'DEP-ENG', 'Engineering', 'Department', NULL, ?, ?, NULL, NULL, ?, NULL, 1),
      (?, 'DEP-HR', 'Human Resources', 'Department', NULL, ?, ?, NULL, NULL, ?, NULL, 1),
      (?, 'DEP-FIN', 'Finance', 'Department', NULL, ?, ?, NULL, NULL, ?, NULL, 1)`, 
      [dep1, cId, lId, now, dep2, cId, lId, now, dep3, cId, lId, now]
    );

    // 4. Salary Grades
    const s1 = uuidv4();
    const s2 = uuidv4();
    await db.query(`INSERT INTO eim_salary_grades (id, code, name, gradeLevel, minSalary, maxSalary, currency, description, effectiveStartDate, effectiveEndDate, isActive) VALUES 
      (?, 'SG-3', 'Grade 3 - Professional', 3, 150000, 300000, 'LKR', 'Mid Level', ?, NULL, 1),
      (?, 'SG-5', 'Grade 5 - Managerial', 5, 300000, 600000, 'LKR', 'Manager Level', ?, NULL, 1)`, 
      [s1, now, s2, now]
    );

    // 5. Designations
    const d1 = uuidv4();
    const d2 = uuidv4();
    const d3 = uuidv4();
    await db.query(`INSERT INTO designations (id, code, name, corporateTitleId, salaryGradeId, departmentId, description, effectiveStartDate, effectiveEndDate, isActive) VALUES 
      (?, 'DES-SE', 'Software Engineer', NULL, ?, ?, 'Develops and maintains software applications', ?, NULL, 1),
      (?, 'DES-HRM', 'HR Manager', NULL, ?, ?, 'Manages HR operations', ?, NULL, 1),
      (?, 'DES-QA', 'QA Engineer', NULL, ?, ?, 'Ensures software quality', ?, NULL, 1)`, 
      [d1, s1, dep1, now, d2, s2, dep2, now, d3, s1, dep1, now]
    );

    // 6. Employment Types
    const et1 = uuidv4();
    const et2 = uuidv4();
    await db.query(`INSERT INTO employment_types (id, code, name, description, effectiveStartDate, effectiveEndDate, isActive, createdBy) VALUES 
      (?, 'EMP-FT', 'Full Time', 'Permanent Full Time Employee', ?, NULL, 1, 'system'),
      (?, 'EMP-CON', 'Contract', 'Fixed Term Contract', ?, NULL, 1, 'system')`, 
      [et1, now, et2, now]
    );

    // 7. Job Profiles
    await db.query(`INSERT INTO eim_job_profiles (id, code, title, designationId, departmentId, purpose, description, keyResponsibilities, keyResultAreas, requiredQualifications, requiredExperience, requiredSkills, reportingPositionId, salaryGradeId, employmentTypeId, effectiveStartDate, effectiveEndDate, version, isActive, createdBy) VALUES 
      (?, 'JP-SE', 'Senior Software Engineer', ?, ?, 'Lead development of core products', 'Full stack development', 'Coding, Testing, Deployment', 'Code Quality, Delivery Time', 'BSc in Computer Science', '3+ Years', 'React, Node.js, MySQL', NULL, ?, ?, ?, NULL, 1, 1, 'system'),
      (?, 'JP-HRM', 'HR Manager', ?, ?, 'Manage overall HR functions', 'Oversee recruitment and employee relations', 'Hiring, Onboarding, Payroll', 'Retention, Time-to-hire', 'MBA or HR Degree', '5+ Years', 'Communication, Leadership', NULL, ?, ?, ?, NULL, 1, 1, 'system')`, 
      [uuidv4(), d1, dep1, s1, et1, now, uuidv4(), d2, dep2, s2, et1, now]
    );

    console.log('Successfully inserted realistic EIM data!');
  } catch (error) {
    console.error('Error seeding EIM data:', error);
  } finally {
    process.exit(0);
  }
}
main();