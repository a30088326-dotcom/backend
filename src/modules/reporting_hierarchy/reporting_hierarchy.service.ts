// @ts-nocheck
import { db } from '../../lib/db';
import { RowDataPacket } from 'mysql2';
import { changeReporting } from '../../shared/services/organization.service';
import { NativeReportingHierarchyService as native } from './reporting_hierarchy.dynamo';

export class ReportingHierarchyService {
  /**
   * Fetch active employees for manager selection dropdown.
   */
  static async getActiveEmployees(search?: string, excludeId?: string) {
    if(process.env.DATABASE_PROVIDER==='dynamodb')return native.getActiveEmployees(search,excludeId);
    let query = `
      SELECT 
        e.id, 
        COALESCE(e.employeeNo, e.employeeNumber, '') as employeeNo,
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(pd.firstName, ''), ' ', COALESCE(pd.lastName, ''))), ''), NULLIF(TRIM(CONCAT(COALESCE(e.firstName, ''), ' ', COALESCE(e.lastName, ''))), ''), e.callingName, 'Employee') as name,
        e.designation, 
        e.department, 
        e.avatar,
        e.reportingManagerId
      FROM employee_information_employees e
      LEFT JOIN employee_information_personal_details pd ON e.id = pd.employeeId
      LEFT JOIN users u ON e.userId = u.id
      WHERE e.status = 'Active' AND (e.isActive = 1 OR e.isActive IS NULL)
    `;
    const params: any[] = [];

    if (excludeId) {
      query += ` AND e.id != ?`;
      params.push(excludeId);
    }

    if (search) {
      query += ` AND (
        e.firstName LIKE ? OR 
        e.lastName LIKE ? OR 
        pd.firstName LIKE ? OR 
        pd.lastName LIKE ? OR 
        e.employeeNo LIKE ? OR
e.designation LIKE ? OR e.department LIKE ? OR e.employeeNumber LIKE ? OR CONCAT_WS(' ', pd.firstName, pd.lastName) LIKE ?
      )`;
      const searchParam = `%${search}%`;
params.push(...Array(9).fill(searchParam));
    }

    query += ` ORDER BY name ASC`;

    const [rows] = await db.query<RowDataPacket[]>(query, params);
    return rows.map(row=>({...row,hasChildren:row.directReportsCount>0}));
  }

  /**
   * Helper query to format employee node
   */
  private static getNodeSelectSql() {
    return `
      SELECT 
        e.id, 
        COALESCE(e.employeeNo, e.employeeNumber, '') as employeeNo,
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(pd.firstName, ''), ' ', COALESCE(pd.lastName, ''))), ''), NULLIF(TRIM(CONCAT(COALESCE(e.firstName, ''), ' ', COALESCE(e.lastName, ''))), ''), e.callingName, 'Employee') as name,
        e.organizationalRank, e.designation,
        e.department, 
        e.avatar,
        e.status,
        e.reportingManagerId,
        e.reportingEffectiveFrom,
        u.email,
        (SELECT COUNT(id) FROM employee_information_employees sub WHERE sub.reportingManagerId = e.id AND sub.status = 'Active' AND (sub.isActive = 1 OR sub.isActive IS NULL)) as directReportsCount
      FROM employee_information_employees e
      LEFT JOIN employee_information_personal_details pd ON e.id = pd.employeeId
      LEFT JOIN users u ON e.userId = u.id
      WHERE e.status = 'Active' AND (e.isActive = 1 OR e.isActive IS NULL)
    `;
  }

  /**
   * Fetch tree nodes. If parentId is omitted, returns root nodes (top-level).
   * Otherwise returns direct subordinates of parentId.
   */
  static async getTreeNodes(parentId?: string) {
    if(process.env.DATABASE_PROVIDER==='dynamodb')return native.getTreeNodes(parentId);
    let query = this.getNodeSelectSql();
    const params: any[] = [];

    if (parentId) {
      query += ` AND e.reportingManagerId = ?`;
      params.push(parentId);
    } else {
      // Find root nodes: either manager is null, or manager doesn't exist/isn't active
      query += ` AND (e.reportingManagerId IS NULL OR e.reportingManagerId NOT IN (SELECT id FROM employee_information_employees WHERE status = 'Active'))`;
    }

    query += ` ORDER BY name ASC`;

    const [rows] = await db.query<RowDataPacket[]>(query, params);
    
    // Format response
    return rows.map(row => ({
      ...row,
      hasChildren: row.directReportsCount > 0
    }));
  }

  /**
   * Fetch the full hierarchy (all active employees) for client-side assembly.
   */
  static async getFullHierarchy() {
    if(process.env.DATABASE_PROVIDER==='dynamodb')return native.getFullHierarchy();
    const query = this.getNodeSelectSql() + ` ORDER BY name ASC`;
    const [rows] = await db.query<RowDataPacket[]>(query);
    return rows;
  }

  /**
   * Assign or change a reporting manager for an employee.
   */
  static async assignManager(employeeId: string, reportingManagerId: string | null, effectiveDate: string, reason: string, changedBy: string) {
    if(process.env.DATABASE_PROVIDER==='dynamodb')return native.assignManager(employeeId,reportingManagerId,effectiveDate,reason,changedBy);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await changeReporting(connection, [{ employeeId, managerId: reportingManagerId }], changedBy, effectiveDate, reason || 'Reporting manager updated');
      await connection.commit();
      return { success: true, message: 'Reporting manager updated.' };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  /**
   * Fetch audit history of reporting hierarchy changes
   */
  static async getAuditHistory() {
    if(process.env.DATABASE_PROVIDER==='dynamodb')return native.getAuditHistory();
    const query = `
      SELECT 
        a.id, a.employee_id, a.action, a.previous_manager_id, a.new_manager_id, a.effective_date, a.reason, a.changed_by, a.created_at,
        
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(pd_e.firstName, ''), ' ', COALESCE(pd_e.lastName, ''))), ''), NULLIF(TRIM(CONCAT(COALESCE(e.firstName, ''), ' ', COALESCE(e.lastName, ''))), ''), e.callingName, 'Employee') as employeeName,
        COALESCE(e.employeeNo, e.employeeNumber, '') as employeeNo,
        
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(pd_pm.firstName, ''), ' ', COALESCE(pd_pm.lastName, ''))), ''), NULLIF(TRIM(CONCAT(COALESCE(pm.firstName, ''), ' ', COALESCE(pm.lastName, ''))), ''), pm.callingName) as previousManagerName,
        
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(pd_nm.firstName, ''), ' ', COALESCE(pd_nm.lastName, ''))), ''), NULLIF(TRIM(CONCAT(COALESCE(nm.firstName, ''), ' ', COALESCE(nm.lastName, ''))), ''), nm.callingName) as newManagerName
        
      FROM reporting_hierarchy_audit a
      LEFT JOIN employee_information_employees e ON a.employee_id = e.id
      LEFT JOIN employee_information_personal_details pd_e ON e.id = pd_e.employeeId
      
      LEFT JOIN employee_information_employees pm ON a.previous_manager_id = pm.id
      LEFT JOIN employee_information_personal_details pd_pm ON pm.id = pd_pm.employeeId
      
      LEFT JOIN employee_information_employees nm ON a.new_manager_id = nm.id
      LEFT JOIN employee_information_personal_details pd_nm ON nm.id = pd_nm.employeeId
      
      ORDER BY a.created_at DESC
      LIMIT 100
    `;
    const [rows] = await db.query<RowDataPacket[]>(query);
    return rows;
  }
  /**
   * Get the upward path of an employee to the root.
   */
  static async getUpwardPath(employeeId: string): Promise<string[]> {
    if(process.env.DATABASE_PROVIDER==='dynamodb')return native.getUpwardPath(employeeId);
    const path: string[] = [];
    let currentId: string | null = employeeId;
    
    // We do a programmatic traversal to be safe across DB versions.
    const [allEmps] = await db.query('SELECT id, reportingManagerId FROM employee_information_employees WHERE status = "Active"');
    
    // To optimize, convert to a map
    const map = new Map<string, string | null>();
    for (const e of allEmps) {
      map.set(e.id, e.reportingManagerId);
    }

    const visited = new Set<string>();
    while (currentId) {
      if (visited.has(currentId)) break; // circular dependency safety
      visited.add(currentId);
      path.push(currentId);
      currentId = map.get(currentId) || null;
    }

    // path currently is [target, manager, grandManager, root]
    // reverse it so it goes [root, ..., target]
    return path.reverse();
  }

  /**
   * Get employeeId for a given userId
   */
  static async getMyEmployeeId(userId: string): Promise<string | null> {
    if(process.env.DATABASE_PROVIDER==='dynamodb')return native.getMyEmployeeId(userId);
    const [rows] = await db.query('SELECT id FROM employee_information_employees WHERE userId = ? LIMIT 1', [userId]);
    return rows[0]?.id || null;
  }

  /**
   * Fetch employees who have no reporting manager assigned.
   * Excludes the Owner, who does not require a reporting manager.
   */
  static async getUnassignedEmployees() {
    if(process.env.DATABASE_PROVIDER==='dynamodb')return native.getUnassignedEmployees();
    const query = `
      SELECT 
        e.id, 
        COALESCE(e.employeeNo, e.employeeNumber, '') as employeeNo,
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(e.firstName, ''), ' ', COALESCE(e.lastName, ''))), ''), NULLIF(TRIM(CONCAT(COALESCE(pd.firstName, ''), ' ', COALESCE(pd.lastName, ''))), ''), e.callingName, 'Employee') as name,
        e.organizationalRank, e.designation,
        e.department, 
        e.avatar,
        e.status,
        (SELECT COUNT(id) FROM employee_information_employees sub WHERE sub.reportingManagerId = e.id AND sub.status = 'Active' AND (sub.isActive = 1 OR sub.isActive IS NULL)) as directReportsCount
      FROM employee_information_employees e
      LEFT JOIN employee_information_personal_details pd ON e.id = pd.employeeId
      LEFT JOIN users u ON e.userId = u.id
      WHERE e.status = 'Active' AND (e.isActive = 1 OR e.isActive IS NULL)
        AND e.reportingManagerId IS NULL
AND e.organizationalRank != 'OWNER'
      ORDER BY name ASC
    `;
    const [rows] = await db.query<RowDataPacket[]>(query);
    return rows;
  }
  /**
   * Bulk update reporting managers from drag-and-drop edits.
   * Validates every change before committing any of them.
   */
  static async bulkUpdateManagers(changes: Array<{employeeId:string;newReportingManagerId:string|null}>, changedBy:string, effectiveDate:string) {
    if(process.env.DATABASE_PROVIDER==='dynamodb')return native.bulkUpdateManagers(changes,changedBy,effectiveDate);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await changeReporting(connection, changes.map(c => ({ employeeId:c.employeeId, managerId:c.newReportingManagerId })), changedBy, effectiveDate, 'Bulk reporting update');
      await connection.commit();
      return { success:true, message: changes.length + ' reporting lines updated.' };
    } catch(error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  /**
   * Get the reporting manager details for the currently logged in user
   */
  static async getMyManager(userId: string): Promise<any> {
    if(process.env.DATABASE_PROVIDER==='dynamodb')return native.getMyManager(userId);
    // Step 1: Get the employee for this user
    const [empRows] = await db.query(
      'SELECT id, reportingManagerId FROM employee_information_employees WHERE userId = ? LIMIT 1',
      [userId]
    );
    if (!empRows[0]) return null;
    
    const reportingManagerId = empRows[0].reportingManagerId;
    if (!reportingManagerId) return null;

    // Step 2: Get manager details
    const [mgRows] = await db.query(`
      SELECT 
        e.id,
        COALESCE(e.employeeNo, e.employeeNumber, '') as employeeNo,
        COALESCE(
          NULLIF(TRIM(CONCAT(COALESCE(pd.firstName, ''), ' ', COALESCE(pd.lastName, ''))), ''),
          e.callingName,
          NULLIF(TRIM(CONCAT(COALESCE(e.firstName, ''), ' ', COALESCE(e.lastName, ''))), ''),
          'Manager'
        ) as fullName,
        COALESCE(e.designation, wd.designationId, 'Staff') as designation,
        COALESCE(e.department, wd.departmentId, '') as department,
        e.avatar,
        e.status,
        u.email as personalEmail,
        '' as mobilePhone
      FROM employee_information_employees e
      LEFT JOIN employee_information_personal_details pd ON e.id = pd.employeeId
      LEFT JOIN users u ON e.userId = u.id
      LEFT JOIN employee_information_workstation_details wd ON e.id = wd.employeeId
      WHERE e.id = ?
      LIMIT 1
    `, [reportingManagerId]);

    return mgRows[0] || null;
  }

  /**
   * Ensure reporting_hierarchy_levels table exists
   */
  private static async ensureLevelsTable() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS reporting_hierarchy_levels (
        depth INT PRIMARY KEY,
        name VARCHAR(255) NOT NULL
      )
    `);
  }

  /**
   * Get all custom level names
   */
  static async getLevels(): Promise<Record<number, string>> {
    if(process.env.DATABASE_PROVIDER==='dynamodb')return native.getLevels();
    await this.ensureLevelsTable();
    const [rows] = await db.query('SELECT depth, name FROM reporting_hierarchy_levels');
    const levelMap: Record<number, string> = {};
    for (const row of rows) {
      levelMap[row.depth] = row.name;
    }
    return levelMap;
  }

  /**
   * Update or insert a custom level name
   */
  static async updateLevel(depth: number, name: string): Promise<void> {
    if(process.env.DATABASE_PROVIDER==='dynamodb')return native.updateLevel(depth,name);
    await this.ensureLevelsTable();
    await db.query(
      `INSERT INTO reporting_hierarchy_levels (depth, name) 
       VALUES (?, ?) 
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [depth, name]
    );
  }
}
