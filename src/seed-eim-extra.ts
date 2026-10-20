import 'dotenv/config';
import { db } from './lib/db';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  console.log('Seeding Additional EIM Realistic Demo Data...');

  try {
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    
    // 1. eim_corporate_titles
    await db.query(`DELETE FROM eim_corporate_titles`);
    await db.query(`INSERT INTO eim_corporate_titles (id, code, name, level, description, isActive) VALUES 
      (?, 'CT-CEO', 'Chief Executive Officer', 1, 'Highest ranking executive', 1),
      (?, 'CT-CTO', 'Chief Technology Officer', 2, 'Head of Technology', 1),
      (?, 'CT-DIR', 'Director', 3, 'Department Director', 1)`, 
      [uuidv4(), uuidv4(), uuidv4()]
    );

    // 2. eim_cost_centres
    await db.query(`DELETE FROM eim_cost_centres`);
    await db.query(`INSERT INTO eim_cost_centres (id, code, name, description, isActive) VALUES 
      (?, 'CC-IT', 'IT Cost Centre', 'IT budget allocation', 1),
      (?, 'CC-HR', 'HR Cost Centre', 'HR budget allocation', 1),
      (?, 'CC-FIN', 'Finance Cost Centre', 'Finance budget allocation', 1)`, 
      [uuidv4(), uuidv4(), uuidv4()]
    );

    // 3. eim_employee_categories
    await db.query(`DELETE FROM eim_employee_categories`);
    await db.query(`INSERT INTO eim_employee_categories (id, code, name, description, isActive, createdBy) VALUES 
      (?, 'EC-PERM', 'Permanent', 'Permanent Staff', 1, 'system'),
      (?, 'EC-CONT', 'Contract', 'Contract Staff', 1, 'system'),
      (?, 'EC-INT', 'Intern', 'Internship', 1, 'system')`, 
      [uuidv4(), uuidv4(), uuidv4()]
    );

    // 4. eim_employee_titles
    await db.query(`DELETE FROM eim_employee_titles`);
    await db.query(`INSERT INTO eim_employee_titles (id, code, name, description, isActive, createdBy) VALUES 
      (?, 'T-MR', 'Mr.', 'Mister', 1, 'system'),
      (?, 'T-MRS', 'Mrs.', 'Missus', 1, 'system'),
      (?, 'T-MS', 'Ms.', 'Miss', 1, 'system'),
      (?, 'T-DR', 'Dr.', 'Doctor', 1, 'system')`, 
      [uuidv4(), uuidv4(), uuidv4(), uuidv4()]
    );

    // 5. eim_functions & eim_functional_roles
    await db.query(`DELETE FROM eim_functions`);
    await db.query(`DELETE FROM eim_functional_roles`);
    await db.query(`INSERT INTO eim_functions (id, code, name, description, isActive, createdBy) VALUES 
      (?, 'FN-SD', 'Software Development', 'Core development', 1, 'system'),
      (?, 'FN-QA', 'Quality Assurance', 'Testing and QA', 1, 'system')`, 
      [uuidv4(), uuidv4()]
    );
    await db.query(`INSERT INTO eim_functional_roles (id, code, name, description, isActive, createdBy) VALUES 
      (?, 'FR-DEV', 'Developer', 'Writes code', 1, 'system'),
      (?, 'FR-TEST', 'Tester', 'Tests code', 1, 'system')`, 
      [uuidv4(), uuidv4()]
    );

    // 6. Qualifications
    await db.query(`DELETE FROM eim_qual_types`);
    await db.query(`DELETE FROM eim_quals`);
    await db.query(`DELETE FROM eim_qual_classifications`);
    await db.query(`DELETE FROM eim_subjects`);
    
    await db.query(`INSERT INTO eim_qual_types (id, code, name, description, isActive) VALUES 
      (?, 'QT-DEG', 'Degree', 'Bachelor Degree', 1),
      (?, 'QT-MST', 'Master', 'Master Degree', 1)`, 
      [uuidv4(), uuidv4()]
    );
    await db.query(`INSERT INTO eim_quals (id, code, name, description, isActive) VALUES 
      (?, 'Q-BSC', 'BSc Computer Science', 'Bachelors in CS', 1),
      (?, 'Q-MBA', 'MBA', 'Masters in Business Admin', 1)`, 
      [uuidv4(), uuidv4()]
    );
    await db.query(`INSERT INTO eim_qual_classifications (id, code, name, description, isActive) VALUES 
      (?, 'QC-1ST', 'First Class', 'First Class Honours', 1),
      (?, 'QC-2ND', 'Second Class', 'Second Class Honours', 1),
      (?, 'QC-PASS', 'Pass', 'General Pass', 1)`, 
      [uuidv4(), uuidv4(), uuidv4()]
    );
    await db.query(`INSERT INTO eim_subjects (id, code, name, description, isActive) VALUES 
      (?, 'SUB-MATH', 'Mathematics', 'Maths', 1),
      (?, 'SUB-PROG', 'Programming', 'Coding', 1)`, 
      [uuidv4(), uuidv4()]
    );

    // 7. Demographics & Others
    const simpleTables = [
      { t: 'eim_rating_methods', v: [['RM-5S', '5-Star Rating'], ['RM-PCT', 'Percentage']] },
      { t: 'eim_languages', v: [['LANG-EN', 'English'], ['LANG-SI', 'Sinhala'], ['LANG-TA', 'Tamil']] },
      { t: 'eim_proficiency_levels', v: [['PL-BEG', 'Beginner'], ['PL-INT', 'Intermediate'], ['PL-ADV', 'Advanced']] },
      { t: 'eim_genders', v: [['G-M', 'Male'], ['G-F', 'Female']] },
      { t: 'eim_marital_statuses', v: [['MS-S', 'Single'], ['MS-M', 'Married']] },
      { t: 'eim_nationalities', v: [['NAT-SL', 'Sri Lankan'], ['NAT-IND', 'Indian'], ['NAT-UK', 'British']] },
      { t: 'eim_religions', v: [['REL-BUD', 'Buddhism'], ['REL-CHR', 'Christianity'], ['REL-ISL', 'Islam'], ['REL-HIN', 'Hinduism']] },
      { t: 'eim_blood_groups', v: [['BG-AP', 'A+'], ['BG-AN', 'A-'], ['BG-BP', 'B+'], ['BG-OP', 'O+'], ['BG-ON', 'O-']] },
      { t: 'eim_relationship_types', v: [['RT-FAT', 'Father'], ['RT-MOT', 'Mother'], ['RT-SPO', 'Spouse'], ['RT-CHI', 'Child']] },
      { t: 'eim_attachment_types', v: [['AT-NIC', 'National ID'], ['AT-PASS', 'Passport'], ['AT-BC', 'Birth Certificate']] },
      { t: 'eim_currencies', v: [['CUR-LKR', 'Sri Lankan Rupee'], ['CUR-USD', 'US Dollar'], ['CUR-EUR', 'Euro']] },
      { t: 'eim_membership_types', v: [['MT-PROF', 'Professional'], ['MT-ACAD', 'Academic']] },
      { t: 'eim_extracurricular_categories', v: [['EC-SPO', 'Sports'], ['EC-ART', 'Arts']] },
      { t: 'eim_extracurricular_types', v: [['ET-CRI', 'Cricket'], ['ET-SWI', 'Swimming']] },
    ];

    for (const item of simpleTables) {
      await db.query(`DELETE FROM ${item.t}`);
      for (const val of item.v) {
        await db.query(`INSERT INTO ${item.t} (id, code, name, description, isActive) VALUES (?, ?, ?, ?, ?)`, 
          [uuidv4(), val[0], val[1], val[1], 1]
        );
      }
    }

    // 8. Geography
    await db.query(`DELETE FROM eim_geography`);
    const lkId = uuidv4();
    await db.query(`INSERT INTO eim_geography (id, code, name, geoType, parentId, isActive) VALUES (?, 'GEO-LK', 'Sri Lanka', 'Country', NULL, 1)`, [lkId]);
    await db.query(`INSERT INTO eim_geography (id, code, name, geoType, parentId, isActive) VALUES (?, 'GEO-WP', 'Western Province', 'Province', ?, 1)`, [uuidv4(), lkId]);

    // 9. Benefits
    await db.query(`DELETE FROM eim_benefits`);
    await db.query(`INSERT INTO eim_benefits (id, code, name, category, isCash, defaultAmount, currency, isActive) VALUES 
      (?, 'BEN-HI', 'Health Insurance', 'Insurance', 0, 500000, 'LKR', 1),
      (?, 'BEN-TA', 'Transport Allowance', 'Allowance', 1, 20000, 'LKR', 1)`, 
      [uuidv4(), uuidv4()]
    );

    // 10. Dynamic Fields
    await db.query(`DELETE FROM eim_dynamic_fields`);
    await db.query(`INSERT INTO eim_dynamic_fields (id, fieldName, fieldLabel, fieldType, applicableModule, options, isMandatory, displayOrder, isActive, createdBy) VALUES 
      (?, 'tshirt_size', 'T-Shirt Size', 'Dropdown', 'Employee Profile', '["S", "M", "L", "XL"]', 0, 1, 1, 'system')`, 
      [uuidv4()]
    );
    
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('Successfully inserted all additional realistic EIM data!');
  } catch (error) {
    console.error('Error seeding EIM data:', error);
  } finally {
    process.exit(0);
  }
}
main();
