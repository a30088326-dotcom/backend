// @ts-nocheck
import { Request, Response } from 'express';
import { db } from '../../lib/db';
import { RowDataPacket } from 'mysql2';
import { v4 as uuidv4 } from 'uuid';

export const getUsers = async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query<RowDataPacket[]>(`
      SELECT
        u.id, u.name, u.email, u.role, u.isActive, u.createdAt,
        e.employeeNo,
        COALESCE(pd.fullName, pd.firstName, u.name) AS displayName,
        des.name  AS designation,
        st.name   AS department
      FROM users u
      LEFT JOIN employee_information_employees e  ON e.userId = u.id
      LEFT JOIN employee_information_personal_details pd ON pd.employeeId = e.id
      LEFT JOIN employee_information_workstation_details wd ON wd.employeeId = e.id
      LEFT JOIN designations des ON des.id = wd.designationId
      LEFT JOIN eim_structures st  ON st.id = wd.departmentId
      ORDER BY u.name ASC
    `);

    const users = rows.map((r: any) => ({
      id:          r.id,
      name:        r.displayName || r.name,
      email:       r.email,
      role:        r.role,
      isActive:    Boolean(r.isActive),
      employeeNo:  r.employeeNo  || null,
      designation: r.designation || null,
      department:  r.department  || null,
      avatar:      null,
    }));

    res.json({ success: true, data: users });
  } catch (error: any) {
    console.error('Error fetching access control users:', error);
    res.status(500).json({ success: false, message: 'Server Error: ' + error.message });
  }
};

export const updateUserRole = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { role } = req.body;
  try {
    const actor = req.user;
    const allowedRoles = new Set(['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE', 'CANDIDATE']);
    if (!actor || actor.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Only the Owner/Super Admin can change user roles.' });
    }
    if (!allowedRoles.has(role) || id === actor.userId) {
      return res.status(400).json({ success: false, message: 'Invalid role change.' });
    }
    const [targetRows] = await db.query<RowDataPacket[]>('SELECT role FROM users WHERE id = ? LIMIT 1', [id]);
    if (!targetRows.length) return res.status(404).json({ success: false, message: 'User not found' });
    if (targetRows[0].role === 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'The Owner account cannot be reassigned.' });
    }
    await db.query(`UPDATE users SET role = ?, updatedAt = NOW() WHERE id = ?`, [role, id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getUserPermissions = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT * FROM user_module_permissions WHERE userId = ?`, [id]
    );
    const perms = rows.map((r: any) => ({
      ...r,
      moduleAccess: Boolean(r.moduleAccess),
      canView:      Boolean(r.canView),
      canCreate:    Boolean(r.canCreate),
      canEdit:      Boolean(r.canEdit),
      canDelete:    Boolean(r.canDelete),
      canApprove:   Boolean(r.canApprove),
      canExport:    Boolean(r.canExport),
    }));
    res.json({ success: true, data: perms });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const updateUserPermissions = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { permissions } = req.body;
  try {
    if (!Array.isArray(permissions)) return res.status(400).json({ success: false, message: 'permissions must be an array' });
    const allowedScopes = new Set(['OWN', 'DIRECT_REPORTS', 'DEPARTMENT', 'ALL', 'TEAM', 'ORGANIZATION']);
    for (const p of permissions) {
      if (!p || typeof p.moduleId !== 'string' || !p.moduleId.trim() || !allowedScopes.has(p.dataScope || 'OWN')) {
        return res.status(400).json({ success: false, message: 'Invalid permission payload.' });
      }
      if (p.dataScope === 'ORGANIZATION') p.dataScope = 'ALL';
    }
    // Legacy clients may request descendant-team scope, absent in the original enum.
    // Widen only when necessary; preserve all existing values unchanged.
    if (permissions.some(p=>p.dataScope==='TEAM')) {
      const [[column]]=await db.query('SHOW COLUMNS FROM user_module_permissions LIKE \'dataScope\'');
      if (String(column?.Type).startsWith('enum(') && !String(column.Type).includes("'TEAM'")) await db.query('ALTER TABLE user_module_permissions MODIFY dataScope VARCHAR(30) NULL DEFAULT \'OWN\'');
    }
    const [targetRows] = await db.query<RowDataPacket[]>('SELECT role FROM users WHERE id = ? LIMIT 1', [id]);
    if (!targetRows.length) return res.status(404).json({ success: false, message: 'User not found' });
    if (targetRows[0].role === 'SUPER_ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'The Owner permissions cannot be changed.' });
    }
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
      for (const p of permissions) {
        const [existing] = await connection.query(
          `SELECT id FROM user_module_permissions WHERE userId = ? AND moduleId = ?`, [id, p.moduleId]
        );

        if ((existing as any[]).length > 0) {
          await connection.query(
            `UPDATE user_module_permissions SET
              moduleAccess=?, canView=?, canCreate=?, canEdit=?,
              canDelete=?, canApprove=?, canExport=?, dataScope=?, updatedAt=NOW()
             WHERE userId=? AND moduleId=?`,
            [
              p.moduleAccess ? 1 : 0, p.canView ? 1 : 0, p.canCreate ? 1 : 0,
              p.canEdit ? 1 : 0, p.canDelete ? 1 : 0, p.canApprove ? 1 : 0,
              p.canExport ? 1 : 0, p.dataScope || 'OWN', id, p.moduleId
            ]
          );
        } else {
          await connection.query(
            `INSERT INTO user_module_permissions
              (id, userId, moduleId, moduleAccess, canView, canCreate, canEdit, canDelete, canApprove, canExport, dataScope)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              uuidv4(), id, p.moduleId,
              p.moduleAccess ? 1 : 0, p.canView ? 1 : 0, p.canCreate ? 1 : 0,
              p.canEdit ? 1 : 0, p.canDelete ? 1 : 0, p.canApprove ? 1 : 0,
              p.canExport ? 1 : 0, p.dataScope || 'OWN'
            ]
          );
        }
      }
      await connection.commit();
      res.json({ success: true, message: 'Permissions updated successfully' });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Server Error: ' + error.message });
  }
};

export const updateUserStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { isActive } = req.body;
  try {
    // Prevent disabling SUPER_ADMIN
    const [rows] = await db.query<RowDataPacket[]>('SELECT role FROM users WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if ((rows as any[])[0]?.role === 'SUPER_ADMIN' || (id === req.user?.userId)) {
      res.status(403).json({ success: false, message: 'Cannot disable a Super Admin account' });
      return;
    }
    await db.query(`UPDATE users SET isActive = ?, updatedAt = NOW() WHERE id = ?`, [isActive ? 1 : 0, id]);
    res.json({ success: true, message: `User ${isActive ? 'enabled' : 'disabled'} successfully` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Server Error: ' + error.message });
  }
};
