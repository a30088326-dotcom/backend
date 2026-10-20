import { Request, Response } from 'express';
import db from '../../lib/db';
import { v4 as uuidv4 } from 'uuid';

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const connection = await db.getConnection();
    try {
      const [[{ count: companies }]] = await connection.query<any>('SELECT COUNT(*) as count FROM eim_companies WHERE isActive = 1');
      const [[{ count: locations }]] = await connection.query<any>('SELECT COUNT(*) as count FROM eim_locations WHERE isActive = 1');
      const [[{ count: departments }]] = await connection.query<any>('SELECT COUNT(*) as count FROM eim_structures WHERE isActive = 1');
      const [[{ count: designations }]] = await connection.query<any>('SELECT COUNT(*) as count FROM designations WHERE isActive = 1');
      const [[{ count: salaryGrades }]] = await connection.query<any>('SELECT COUNT(*) as count FROM eim_salary_grades WHERE isActive = 1');

      const [[{ count: employmentTypes }]] = await connection.query<any>('SELECT COUNT(*) as count FROM employment_types WHERE isActive = 1');


      return res.json({
        success: true,
        data: { companies, locations, departments, designations, salaryGrades, employmentTypes }
      });
    } finally {
      connection.release();
    }
  } catch (error: any) {
    console.error('Error fetching EIM stats:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// --- COMPANIES ---
export const getCompanies = async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query('SELECT * FROM eim_companies ORDER BY name ASC');
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const createCompany = async (req: Request, res: Response) => {
  try {
    const { code, name, registrationNumber, taxNumber, description, address, country, contactNumber, email, logo, parentCompanyId, effectiveStartDate, effectiveEndDate, isActive } = req.body;
    await db.query(
      `INSERT INTO eim_companies 
       (id, code, name, registrationNumber, taxNumber, description, address, country, contactNumber, email, logo, parentCompanyId, effectiveStartDate, effectiveEndDate, isActive) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), code, name, registrationNumber, taxNumber, description, address, country, contactNumber, email, logo, parentCompanyId, effectiveStartDate || null, effectiveEndDate || null, isActive !== false]
    );
    return res.status(201).json({ success: true, message: 'Company created' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error creating company' });
  }
};

// --- LOCATIONS ---
export const getLocations = async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query('SELECT * FROM eim_locations ORDER BY name ASC');
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const createLocation = async (req: Request, res: Response) => {
  try {
    const { code, name, address, city, country, companyId, locationType, province, district, timeZone, contactNumber, isActive } = req.body;
    await db.query(
      `INSERT INTO eim_locations 
       (id, code, name, address, city, country, companyId, locationType, province, district, timeZone, contactNumber, isActive) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), code, name, address, city, country, companyId, locationType, province, district, timeZone, contactNumber, isActive !== false]
    );
    return res.status(201).json({ success: true, message: 'Location created' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error creating location' });
  }
};

// --- STRUCTURES (Hierarchy) ---
export const getStructures = async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query('SELECT * FROM eim_structures ORDER BY name ASC');
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const createStructure = async (req: Request, res: Response) => {
  try {
    const { code, name, structureType, parentId, companyId, locationId, costCentreId, headPositionId, effectiveStartDate, effectiveEndDate, isActive, description } = req.body;
    await db.query(
      `INSERT INTO eim_structures 
       (id, code, name, structureType, parentId, companyId, locationId, costCentreId, headPositionId, effectiveStartDate, effectiveEndDate, isActive, description) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), code, name, structureType, parentId || null, companyId || null, locationId || null, costCentreId || null, headPositionId || null, effectiveStartDate || null, effectiveEndDate || null, isActive !== false, description || null]
    );
    return res.status(201).json({ success: true, message: 'Structure created' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error creating structure' });
  }
};

export const updateStructure = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { code, name, structureType, parentId, companyId, locationId, costCentreId, headPositionId, effectiveStartDate, effectiveEndDate, isActive, description } = req.body;
    await db.query(
      `UPDATE eim_structures SET 
       code = ?, name = ?, structureType = ?, parentId = ?, companyId = ?, locationId = ?, costCentreId = ?, headPositionId = ?, effectiveStartDate = ?, effectiveEndDate = ?, isActive = ?, description = ?
       WHERE id = ?`,
      [code, name, structureType, parentId || null, companyId || null, locationId || null, costCentreId || null, headPositionId || null, effectiveStartDate || null, effectiveEndDate || null, isActive !== false, description || null, id]
    );
    return res.json({ success: true, message: 'Structure updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating structure' });
  }
};

export const updateStructureParent = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { parentId } = req.body;
    await db.query('UPDATE eim_structures SET parentId = ? WHERE id = ?', [parentId || null, id]);
    return res.json({ success: true, message: 'Structure parent updated' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getHierarchyConfig = async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query('SELECT * FROM eim_hierarchy_config ORDER BY level_order ASC');
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const updateHierarchyConfig = async (req: Request, res: Response) => {
  try {
    const { configs } = req.body; // Array of {id, is_enabled}
    if (!Array.isArray(configs)) return res.status(400).json({ success: false, message: 'Invalid data format' });
    
    for (const conf of configs) {
      await db.query('UPDATE eim_hierarchy_config SET is_enabled = ? WHERE id = ?', [conf.is_enabled, conf.id]);
    }
    return res.json({ success: true, message: 'Hierarchy config updated' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// --- COST CENTRES ---
export const getCostCentres = async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query('SELECT * FROM eim_cost_centres ORDER BY name ASC');
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const createCostCentre = async (req: Request, res: Response) => {
  try {
    const { code, name, companyId, departmentId, description, effectiveStartDate, effectiveEndDate, isActive } = req.body;
    await db.query(
      `INSERT INTO eim_cost_centres 
       (id, code, name, companyId, departmentId, description, effectiveStartDate, effectiveEndDate, isActive) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), code, name, companyId || null, departmentId || null, description, effectiveStartDate || null, effectiveEndDate || null, isActive !== false]
    );
    return res.status(201).json({ success: true, message: 'Cost Centre created' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error creating cost centre' });
  }
};


export const getDesignations = async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query('SELECT * FROM designations ORDER BY name ASC');
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const createDesignation = async (req: Request, res: Response) => {
  try {
    const { code, name, corporateTitleId, salaryGradeId, departmentId, description, effectiveStartDate, effectiveEndDate, isActive } = req.body;
    await db.query(
      `INSERT INTO designations (id, code, name, corporateTitleId, salaryGradeId, departmentId, description, effectiveStartDate, effectiveEndDate, isActive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), code, name, corporateTitleId || null, salaryGradeId || null, departmentId || null, description, effectiveStartDate || null, effectiveEndDate || null, isActive !== false]
    );
    return res.status(201).json({ success: true, message: 'Designation created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};


export const getSalaryGrades = async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query('SELECT * FROM eim_salary_grades ORDER BY name ASC');
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const createSalaryGrade = async (req: Request, res: Response) => {
  try {
    const { code, name, gradeLevel, minSalary, maxSalary, currency, description, effectiveStartDate, effectiveEndDate, isActive } = req.body;
    if (minSalary > maxSalary) {
      return res.status(400).json({ success: false, message: 'Max salary cannot be lower than min salary' });
    }
    await db.query(
      `INSERT INTO eim_salary_grades (id, code, name, gradeLevel, minSalary, maxSalary, currency, description, effectiveStartDate, effectiveEndDate, isActive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), code, name, gradeLevel, minSalary, maxSalary, currency, description, effectiveStartDate || null, effectiveEndDate || null, isActive !== false]
    );
    return res.status(201).json({ success: true, message: 'Salary Grade created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};




// --- CORPORATE TITLES ---
export const getCorporateTitles = async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query('SELECT * FROM eim_corporate_titles ORDER BY level ASC, name ASC');
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const createCorporateTitle = async (req: Request, res: Response) => {
  try {
    const { code, name, level, description, isActive } = req.body;
    await db.query(
      `INSERT INTO eim_corporate_titles (id, code, name, level, description, isActive) VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), code, name, level || 0, description, isActive !== false]
    );
    return res.status(201).json({ success: true, message: 'Corporate Title created' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error creating corporate title' });
  }
};



// --- CLASSIFICATIONS ---

export const getEmploymentTypes = async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query('SELECT * FROM employment_types ORDER BY name ASC');
    return res.json({ success: true, data: rows });
  } catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};

export const createEmploymentType = async (req: Request, res: Response) => {
  try {
    const { code, name, description, effectiveStartDate, effectiveEndDate, isActive } = req.body;
    await db.query(
      `INSERT INTO employment_types (id, code, name, description, effectiveStartDate, effectiveEndDate, isActive, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), code, name, description, effectiveStartDate || null, effectiveEndDate || null, isActive !== false, 'system']
    );
    return res.status(201).json({ success: true, message: 'EmploymentType created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};



export const getEmployeeTitles = async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query('SELECT * FROM eim_employee_titles ORDER BY name ASC');
    return res.json({ success: true, data: rows });
  } catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};

export const createEmployeeTitle = async (req: Request, res: Response) => {
  try {
    const { code, name, description, effectiveStartDate, effectiveEndDate, isActive } = req.body;
    await db.query(
      `INSERT INTO eim_employee_titles (id, code, name, description, effectiveStartDate, effectiveEndDate, isActive, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), code, name, description, effectiveStartDate || null, effectiveEndDate || null, isActive !== false, 'system']
    );
    return res.status(201).json({ success: true, message: 'EmployeeTitle created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};

export const getFunctions = async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query('SELECT * FROM eim_functions ORDER BY name ASC');
    return res.json({ success: true, data: rows });
  } catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};

export const createFunction = async (req: Request, res: Response) => {
  try {
    const { code, name, description, effectiveStartDate, effectiveEndDate, isActive } = req.body;
    await db.query(
      `INSERT INTO eim_functions (id, code, name, description, effectiveStartDate, effectiveEndDate, isActive, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), code, name, description, effectiveStartDate || null, effectiveEndDate || null, isActive !== false, 'system']
    );
    return res.status(201).json({ success: true, message: 'Function created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};

export const getFunctionalRoles = async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query('SELECT * FROM eim_functional_roles ORDER BY name ASC');
    return res.json({ success: true, data: rows });
  } catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};

export const createFunctionalRole = async (req: Request, res: Response) => {
  try {
    const { code, name, description, effectiveStartDate, effectiveEndDate, isActive } = req.body;
    await db.query(
      `INSERT INTO eim_functional_roles (id, code, name, description, effectiveStartDate, effectiveEndDate, isActive, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), code, name, description, effectiveStartDate || null, effectiveEndDate || null, isActive !== false, 'system']
    );
    return res.status(201).json({ success: true, message: 'FunctionalRole created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};

export const getStatutoryClassifications = async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query('SELECT * FROM eim_statutory_classifications ORDER BY name ASC');
    return res.json({ success: true, data: rows });
  } catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};

export const createStatutoryClassification = async (req: Request, res: Response) => {
  try {
    const { code, name, description, effectiveStartDate, effectiveEndDate, isActive } = req.body;
    await db.query(
      `INSERT INTO eim_statutory_classifications (id, code, name, description, effectiveStartDate, effectiveEndDate, isActive, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), code, name, description, effectiveStartDate || null, effectiveEndDate || null, isActive !== false, 'system']
    );
    return res.status(201).json({ success: true, message: 'StatutoryClassification created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};

// --- MASTER DATA ---

export const getQualTypes = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_qual_types ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};
export const createQualType = async (req: Request, res: Response) => {
  try {
    const { code, name, description, isActive } = req.body;
    await db.query(`INSERT INTO eim_qual_types (id, code, name, description, isActive) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), code, name, description, isActive !== false]);
    return res.status(201).json({ success: true, message: 'Created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};
export const getQuals = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_quals ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};
export const createQual = async (req: Request, res: Response) => {
  try {
    const { code, name, description, isActive } = req.body;
    await db.query(`INSERT INTO eim_quals (id, code, name, description, isActive) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), code, name, description, isActive !== false]);
    return res.status(201).json({ success: true, message: 'Created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};
export const getQualClassifications = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_qual_classifications ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};
export const createQualClassification = async (req: Request, res: Response) => {
  try {
    const { code, name, description, isActive } = req.body;
    await db.query(`INSERT INTO eim_qual_classifications (id, code, name, description, isActive) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), code, name, description, isActive !== false]);
    return res.status(201).json({ success: true, message: 'Created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};
export const getSubjects = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_subjects ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};
export const createSubject = async (req: Request, res: Response) => {
  try {
    const { code, name, description, isActive } = req.body;
    await db.query(`INSERT INTO eim_subjects (id, code, name, description, isActive) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), code, name, description, isActive !== false]);
    return res.status(201).json({ success: true, message: 'Created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};
export const getRatingMethods = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_rating_methods ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};
export const createRatingMethod = async (req: Request, res: Response) => {
  try {
    const { code, name, description, isActive } = req.body;
    await db.query(`INSERT INTO eim_rating_methods (id, code, name, description, isActive) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), code, name, description, isActive !== false]);
    return res.status(201).json({ success: true, message: 'Created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};
export const getLanguages = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_languages ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};
export const createLanguage = async (req: Request, res: Response) => {
  try {
    const { code, name, description, isActive } = req.body;
    await db.query(`INSERT INTO eim_languages (id, code, name, description, isActive) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), code, name, description, isActive !== false]);
    return res.status(201).json({ success: true, message: 'Created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};
export const getProficiencyLevels = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_proficiency_levels ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};
export const createProficiencyLevel = async (req: Request, res: Response) => {
  try {
    const { code, name, description, isActive } = req.body;
    await db.query(`INSERT INTO eim_proficiency_levels (id, code, name, description, isActive) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), code, name, description, isActive !== false]);
    return res.status(201).json({ success: true, message: 'Created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};
export const getGenders = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_genders ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};
export const createGender = async (req: Request, res: Response) => {
  try {
    const { code, name, description, isActive } = req.body;
    await db.query(`INSERT INTO eim_genders (id, code, name, description, isActive) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), code, name, description, isActive !== false]);
    return res.status(201).json({ success: true, message: 'Created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};
export const getMaritalStatuses = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_marital_statuses ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};
export const createMaritalStatuse = async (req: Request, res: Response) => {
  try {
    const { code, name, description, isActive } = req.body;
    await db.query(`INSERT INTO eim_marital_statuses (id, code, name, description, isActive) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), code, name, description, isActive !== false]);
    return res.status(201).json({ success: true, message: 'Created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};
export const getNationalities = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_nationalities ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};
export const createNationality = async (req: Request, res: Response) => {
  try {
    const { code, name, description, isActive } = req.body;
    await db.query(`INSERT INTO eim_nationalities (id, code, name, description, isActive) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), code, name, description, isActive !== false]);
    return res.status(201).json({ success: true, message: 'Created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};
export const getReligions = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_religions ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};
export const createReligion = async (req: Request, res: Response) => {
  try {
    const { code, name, description, isActive } = req.body;
    await db.query(`INSERT INTO eim_religions (id, code, name, description, isActive) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), code, name, description, isActive !== false]);
    return res.status(201).json({ success: true, message: 'Created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};
export const getBloodGroups = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_blood_groups ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};
export const createBloodGroup = async (req: Request, res: Response) => {
  try {
    const { code, name, description, isActive } = req.body;
    await db.query(`INSERT INTO eim_blood_groups (id, code, name, description, isActive) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), code, name, description, isActive !== false]);
    return res.status(201).json({ success: true, message: 'Created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};
export const getRelationshipTypes = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_relationship_types ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};
export const createRelationshipType = async (req: Request, res: Response) => {
  try {
    const { code, name, description, isActive } = req.body;
    await db.query(`INSERT INTO eim_relationship_types (id, code, name, description, isActive) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), code, name, description, isActive !== false]);
    return res.status(201).json({ success: true, message: 'Created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};
export const getAttachmentTypes = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_attachment_types ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};
export const createAttachmentType = async (req: Request, res: Response) => {
  try {
    const { code, name, description, isActive } = req.body;
    await db.query(`INSERT INTO eim_attachment_types (id, code, name, description, isActive) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), code, name, description, isActive !== false]);
    return res.status(201).json({ success: true, message: 'Created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};
export const getCurrencies = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_currencies ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};
export const createCurrency = async (req: Request, res: Response) => {
  try {
    const { code, name, description, isActive } = req.body;
    await db.query(`INSERT INTO eim_currencies (id, code, name, description, isActive) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), code, name, description, isActive !== false]);
    return res.status(201).json({ success: true, message: 'Created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};
export const getMembershipTypes = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_membership_types ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};
export const createMembershipType = async (req: Request, res: Response) => {
  try {
    const { code, name, description, isActive } = req.body;
    await db.query(`INSERT INTO eim_membership_types (id, code, name, description, isActive) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), code, name, description, isActive !== false]);
    return res.status(201).json({ success: true, message: 'Created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};
export const getExtracurricularCategories = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_extracurricular_categories ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};
export const createExtracurricularCategory = async (req: Request, res: Response) => {
  try {
    const { code, name, description, isActive } = req.body;
    await db.query(`INSERT INTO eim_extracurricular_categories (id, code, name, description, isActive) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), code, name, description, isActive !== false]);
    return res.status(201).json({ success: true, message: 'Created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};
export const getExtracurricularTypes = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_extracurricular_types ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};
export const createExtracurricularType = async (req: Request, res: Response) => {
  try {
    const { code, name, description, isActive } = req.body;
    await db.query(`INSERT INTO eim_extracurricular_types (id, code, name, description, isActive) VALUES (?, ?, ?, ?, ?)`, [uuidv4(), code, name, description, isActive !== false]);
    return res.status(201).json({ success: true, message: 'Created' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Error' }); }
};
// --- GEOGRAPHY ---
export const getGeography = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_geography ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false }); }
};
export const createGeography = async (req: Request, res: Response) => {
  try {
    const { code, name, geoType, parentId, isActive } = req.body;
    await db.query(`INSERT INTO eim_geography (id, code, name, geoType, parentId, isActive) VALUES (?, ?, ?, ?, ?, ?)`, [uuidv4(), code, name, geoType, parentId || null, isActive !== false]);
    return res.status(201).json({ success: true });
  } catch (err) { return res.status(500).json({ success: false }); }
};
export const updateGeographyParent = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { parentId } = req.body;
    await db.query('UPDATE eim_geography SET parentId = ? WHERE id = ?', [parentId || null, id]);
    return res.json({ success: true, message: 'Updated' });
  } catch (err) { return res.status(500).json({ success: false, message: 'Server Error' }); }
};

// --- BENEFITS ---
export const getBenefits = async (req: Request, res: Response) => {
  try { const [rows] = await db.query('SELECT * FROM eim_benefits ORDER BY name ASC'); return res.json({ success: true, data: rows }); }
  catch (err) { return res.status(500).json({ success: false }); }
};
export const createBenefit = async (req: Request, res: Response) => {
  try {
    const { code, name, category, isCash, defaultAmount, currency, effectiveStartDate, effectiveEndDate, isActive, eligibleSalaryGrades } = req.body;
    const bid = uuidv4();
    await db.query(`INSERT INTO eim_benefits (id, code, name, category, isCash, defaultAmount, currency, effectiveStartDate, effectiveEndDate, isActive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      [bid, code, name, category, isCash, defaultAmount || null, currency, effectiveStartDate || null, effectiveEndDate || null, isActive !== false]);
    
    if (eligibleSalaryGrades && eligibleSalaryGrades.length > 0) {
      for (const sgId of eligibleSalaryGrades) {
        await db.query('INSERT INTO eim_benefit_salary_grades (benefitId, salaryGradeId) VALUES (?, ?)', [bid, sgId]);
      }
    }
    return res.status(201).json({ success: true });
  } catch (err) { return res.status(500).json({ success: false }); }
};

// --- PHASE 3 ---

export const getDynamicFields = async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query('SELECT * FROM eim_dynamic_fields ORDER BY applicableModule ASC, displayOrder ASC');
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const createDynamicField = async (req: Request, res: Response) => {
  try {
    const { fieldName, fieldLabel, fieldType, applicableModule, options, isMandatory, displayOrder, validationRules, isActive } = req.body;
    await db.query(
      `INSERT INTO eim_dynamic_fields (id, fieldName, fieldLabel, fieldType, applicableModule, options, isMandatory, displayOrder, validationRules, isActive, createdBy) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), fieldName, fieldLabel, fieldType, applicableModule, options ? JSON.stringify(options) : null, isMandatory ? 1 : 0, displayOrder || 0, validationRules ? JSON.stringify(validationRules) : null, isActive !== false, 'system']
    );
    return res.status(201).json({ success: true, message: 'Dynamic field created' });
  } catch (err) { 
    return res.status(500).json({ success: false, message: 'Error' }); 
  }
};

export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    // For large logs, this should support pagination and filtering. 
    // We'll return top 100 for now.
    const [rows] = await db.query('SELECT * FROM eim_audit_logs ORDER BY changedAt DESC LIMIT 100');
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// --- DELETE ENDPOINTS ---
export const deleteCompany = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_companies WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Company deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteLocation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_locations WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Location deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteStructure = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_structures WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Structure deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteCostCentre = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_cost_centres WHERE id = ?', [id]);
    return res.json({ success: true, message: 'CostCentre deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteDesignation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM designations WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Designation deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteSalaryGrade = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_salary_grades WHERE id = ?', [id]);
    return res.json({ success: true, message: 'SalaryGrade deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteCorporateTitle = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_corporate_titles WHERE id = ?', [id]);
    return res.json({ success: true, message: 'CorporateTitle deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const deleteEmploymentType = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM employment_types WHERE id = ?', [id]);
    return res.json({ success: true, message: 'EmploymentType deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const deleteEmployeeTitle = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_employee_titles WHERE id = ?', [id]);
    return res.json({ success: true, message: 'EmployeeTitle deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteFunction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_functions WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Function deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteFunctionalRole = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_functional_roles WHERE id = ?', [id]);
    return res.json({ success: true, message: 'FunctionalRole deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteStatutoryClassification = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_statutory_classifications WHERE id = ?', [id]);
    return res.json({ success: true, message: 'StatutoryClassification deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteQualType = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_qual_types WHERE id = ?', [id]);
    return res.json({ success: true, message: 'QualType deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteQual = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_quals WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Qual deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteQualClassification = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_qual_classifications WHERE id = ?', [id]);
    return res.json({ success: true, message: 'QualClassification deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteSubject = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_subjects WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Subject deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteRatingMethod = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_rating_methods WHERE id = ?', [id]);
    return res.json({ success: true, message: 'RatingMethod deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteLanguage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_languages WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Language deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteProficiencyLevel = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_proficiency_levels WHERE id = ?', [id]);
    return res.json({ success: true, message: 'ProficiencyLevel deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteGender = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_genders WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Gender deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteMaritalStatuse = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_marital_statuses WHERE id = ?', [id]);
    return res.json({ success: true, message: 'MaritalStatuse deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteNationality = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_nationalities WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Nationality deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteReligion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_religions WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Religion deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteBloodGroup = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_blood_groups WHERE id = ?', [id]);
    return res.json({ success: true, message: 'BloodGroup deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteRelationshipType = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_relationship_types WHERE id = ?', [id]);
    return res.json({ success: true, message: 'RelationshipType deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteAttachmentType = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_attachment_types WHERE id = ?', [id]);
    return res.json({ success: true, message: 'AttachmentType deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteCurrency = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_currencies WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Currency deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteMembershipType = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_membership_types WHERE id = ?', [id]);
    return res.json({ success: true, message: 'MembershipType deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteExtracurricularCategory = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_extracurricular_categories WHERE id = ?', [id]);
    return res.json({ success: true, message: 'ExtracurricularCategory deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteExtracurricularType = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_extracurricular_types WHERE id = ?', [id]);
    return res.json({ success: true, message: 'ExtracurricularType deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteGeography = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_geography WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Geography deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteBenefit = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_benefits WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Benefit deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const deleteDynamicField = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM eim_dynamic_fields WHERE id = ?', [id]);
    return res.json({ success: true, message: 'DynamicField deleted successfully' });
  } catch (err: any) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete: record is in use' });
    }
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const updateCompany = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, registrationNumber, taxNumber, description, address, country, contactNumber, email, logo, parentCompanyId, effectiveStartDate, effectiveEndDate, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_companies SET code = ?, name = ?, registrationNumber = ?, taxNumber = ?, description = ?, address = ?, country = ?, contactNumber = ?, email = ?, logo = ?, parentCompanyId = ?, effectiveStartDate = ?, effectiveEndDate = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, registrationNumber, taxNumber, description, address, country, contactNumber, email, logo, parentCompanyId, (effectiveStartDate || null), (effectiveEndDate || null), (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'Company updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating company' });
  }
};


export const updateLocation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, address, city, country, companyId, locationType, province, district, timeZone, contactNumber, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_locations SET code = ?, name = ?, address = ?, city = ?, country = ?, companyId = ?, locationType = ?, province = ?, district = ?, timeZone = ?, contactNumber = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, address, city, country, companyId, locationType, province, district, timeZone, contactNumber, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'Location updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating location' });
  }
};


export const updateCostCentre = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, companyId, departmentId, description, effectiveStartDate, effectiveEndDate, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_cost_centres SET code = ?, name = ?, companyId = ?, departmentId = ?, description = ?, effectiveStartDate = ?, effectiveEndDate = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, companyId, departmentId, description, (effectiveStartDate || null), (effectiveEndDate || null), (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'CostCentre updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating costcentre' });
  }
};


export const updateDesignation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, corporateTitleId, salaryGradeId, departmentId, description, effectiveStartDate, effectiveEndDate, isActive  } = req.body;
    
    await db.query(
      `UPDATE designations SET code = ?, name = ?, corporateTitleId = ?, salaryGradeId = ?, departmentId = ?, description = ?, effectiveStartDate = ?, effectiveEndDate = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, corporateTitleId, salaryGradeId, departmentId, description, (effectiveStartDate || null), (effectiveEndDate || null), (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'Designation updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating designation' });
  }
};


export const updateSalaryGrade = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, gradeLevel, minSalary, maxSalary, currency, description, effectiveStartDate, effectiveEndDate, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_salary_grades SET code = ?, name = ?, gradeLevel = ?, minSalary = ?, maxSalary = ?, currency = ?, description = ?, effectiveStartDate = ?, effectiveEndDate = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, gradeLevel, minSalary, maxSalary, currency, description, (effectiveStartDate || null), (effectiveEndDate || null), (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'SalaryGrade updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating salarygrade' });
  }
};


export const updateCorporateTitle = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, level, description, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_corporate_titles SET code = ?, name = ?, level = ?, description = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, level, description, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'CorporateTitle updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating corporatetitle' });
  }
};


export const updateEmploymentType = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, effectiveStartDate, effectiveEndDate, isActive  } = req.body;
    
    await db.query(
      `UPDATE employment_types SET code = ?, name = ?, description = ?, effectiveStartDate = ?, effectiveEndDate = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (effectiveStartDate || null), (effectiveEndDate || null), (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'EmploymentType updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating employmenttype' });
  }
};


export const updateEmployeeTitle = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, effectiveStartDate, effectiveEndDate, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_employee_titles SET code = ?, name = ?, description = ?, effectiveStartDate = ?, effectiveEndDate = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (effectiveStartDate || null), (effectiveEndDate || null), (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'EmployeeTitle updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating employeetitle' });
  }
};


export const updateFunction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, effectiveStartDate, effectiveEndDate, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_functions SET code = ?, name = ?, description = ?, effectiveStartDate = ?, effectiveEndDate = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (effectiveStartDate || null), (effectiveEndDate || null), (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'Function updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating function' });
  }
};


export const updateFunctionalRole = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, effectiveStartDate, effectiveEndDate, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_functional_roles SET code = ?, name = ?, description = ?, effectiveStartDate = ?, effectiveEndDate = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (effectiveStartDate || null), (effectiveEndDate || null), (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'FunctionalRole updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating functionalrole' });
  }
};


export const updateStatutoryClassification = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, effectiveStartDate, effectiveEndDate, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_statutory_classifications SET code = ?, name = ?, description = ?, effectiveStartDate = ?, effectiveEndDate = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (effectiveStartDate || null), (effectiveEndDate || null), (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'StatutoryClassification updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating statutoryclassification' });
  }
};


export const updateQualType = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_qual_types SET code = ?, name = ?, description = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'QualType updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating qualtype' });
  }
};


export const updateQual = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_quals SET code = ?, name = ?, description = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'Qual updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating qual' });
  }
};


export const updateQualClassification = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_qual_classifications SET code = ?, name = ?, description = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'QualClassification updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating qualclassification' });
  }
};


export const updateSubject = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_subjects SET code = ?, name = ?, description = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'Subject updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating subject' });
  }
};


export const updateRatingMethod = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_rating_methods SET code = ?, name = ?, description = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'RatingMethod updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating ratingmethod' });
  }
};


export const updateLanguage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_languages SET code = ?, name = ?, description = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'Language updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating language' });
  }
};


export const updateProficiencyLevel = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_proficiency_levels SET code = ?, name = ?, description = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'ProficiencyLevel updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating proficiencylevel' });
  }
};


export const updateGender = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_genders SET code = ?, name = ?, description = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'Gender updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating gender' });
  }
};


export const updateMaritalStatuse = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_marital_statuses SET code = ?, name = ?, description = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'MaritalStatuse updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating maritalstatuse' });
  }
};


export const updateNationality = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_nationalities SET code = ?, name = ?, description = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'Nationality updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating nationality' });
  }
};


export const updateReligion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_religions SET code = ?, name = ?, description = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'Religion updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating religion' });
  }
};


export const updateBloodGroup = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_blood_groups SET code = ?, name = ?, description = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'BloodGroup updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating bloodgroup' });
  }
};


export const updateRelationshipType = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_relationship_types SET code = ?, name = ?, description = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'RelationshipType updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating relationshiptype' });
  }
};


export const updateAttachmentType = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_attachment_types SET code = ?, name = ?, description = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'AttachmentType updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating attachmenttype' });
  }
};


export const updateCurrency = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_currencies SET code = ?, name = ?, description = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'Currency updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating currency' });
  }
};


export const updateMembershipType = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_membership_types SET code = ?, name = ?, description = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'MembershipType updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating membershiptype' });
  }
};


export const updateExtracurricularCategory = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_extracurricular_categories SET code = ?, name = ?, description = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'ExtracurricularCategory updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating extracurricularcategory' });
  }
};


export const updateExtracurricularType = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, description, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_extracurricular_types SET code = ?, name = ?, description = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, description, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'ExtracurricularType updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating extracurriculartype' });
  }
};


export const updateGeography = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, geoType, parentId, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_geography SET code = ?, name = ?, geoType = ?, parentId = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, geoType, parentId, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'Geography updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating geography' });
  }
};


export const updateBenefit = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  code, name, category, isCash, defaultAmount, currency, effectiveStartDate, effectiveEndDate, isActive, eligibleSalaryGrades  } = req.body;
    
    await db.query(
      `UPDATE eim_benefits SET code = ?, name = ?, category = ?, isCash = ?, defaultAmount = ?, currency = ?, effectiveStartDate = ?, effectiveEndDate = ?, isActive = ?, eligibleSalaryGrades = ?, updatedAt = NOW() WHERE id = ?`,
      [code, name, category, isCash, defaultAmount, currency, (effectiveStartDate || null), (effectiveEndDate || null), (isActive !== false), eligibleSalaryGrades, id]
    );
    return res.status(200).json({ success: true, message: 'Benefit updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating benefit' });
  }
};


export const updateDynamicField = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {  fieldName, fieldLabel, fieldType, applicableModule, options, isMandatory, displayOrder, validationRules, isActive  } = req.body;
    
    await db.query(
      `UPDATE eim_dynamic_fields SET fieldName = ?, fieldLabel = ?, fieldType = ?, applicableModule = ?, options = ?, isMandatory = ?, displayOrder = ?, validationRules = ?, isActive = ?, updatedAt = NOW() WHERE id = ?`,
      [fieldName, fieldLabel, fieldType, applicableModule, options, isMandatory, displayOrder, validationRules, (isActive !== false), id]
    );
    return res.status(200).json({ success: true, message: 'DynamicField updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error updating dynamicfield' });
  }
};
