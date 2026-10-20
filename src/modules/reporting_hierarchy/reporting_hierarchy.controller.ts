import { Request, Response } from 'express';
import { ReportingHierarchyService } from './reporting_hierarchy.service';

import { organizationAccess } from '../../shared/services/organization.service';

export const getActiveEmployees = async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string;
    const excludeId = req.query.excludeId as string;
    const employees = await ReportingHierarchyService.getActiveEmployees(search, excludeId);
    return res.json({ success: true, data: employees });
  } catch (error: any) {
    console.error('Error fetching active employees:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getTreeNodes = async (req: Request, res: Response) => {
  try {
    let parentId = req.query.parentId as string;
    const access = await organizationAccess(req.user!.userId);
    const mode = req.query.mode as string;
    
    if (mode === 'all') {
      const allNodes = await ReportingHierarchyService.getFullHierarchy();
      return res.json({ success: true, data: access.admin ? allNodes : allNodes.map(({ email, ...node }) => node) });
    }
    
    const nodes = await ReportingHierarchyService.getTreeNodes(parentId);
    return res.json({ success: true, data: access.admin ? nodes : nodes.map(node => {
      const { email, ...safeNode } = node as any;
      return safeNode;
    }) });
  } catch (error: any) {
    console.error('Error fetching hierarchy tree:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const assignManager = async (req: Request, res: Response) => {
  try {
    const { employeeId, reportingManagerId, effectiveDate, reason } = req.body;
    
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'Employee ID is required.' });
    }
    if (!effectiveDate) {
      return res.status(400).json({ success: false, message: 'Effective Date is required.' });
    }

    // Record the authenticated administrator as the actor.
    const changedBy = req.user!.userId;

    const result = await ReportingHierarchyService.assignManager(
      employeeId, 
      reportingManagerId || null, 
      effectiveDate, 
      reason, 
      changedBy
    );
    
    return res.json(result);
  } catch (error: any) {
    console.error('Error assigning manager:', error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getAuditHistory = async (req: Request, res: Response) => {
  try {
    const access = await organizationAccess(req.user!.userId);
    const auditLogs = (await ReportingHierarchyService.getAuditHistory()).filter(e=>access.admin||access.isExecutive||access.visibleIds.includes(e.employeeId || e.employee_id));
    return res.json({ success: true, data: auditLogs });
  } catch (error: any) {
    console.error('Error fetching audit history:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
export const getUpwardPath = async (req: Request, res: Response) => {
  try {
    const employeeId = req.params.employeeId as string;
    const path = await ReportingHierarchyService.getUpwardPath(employeeId);
    return res.json({ success: true, data: path });
  } catch (error: any) {
    console.error('Error fetching upward path:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getMyNode = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const employeeId = await ReportingHierarchyService.getMyEmployeeId(userId);
    return res.json({ success: true, data: employeeId });
  } catch (error: any) {
    console.error('Error fetching my node:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getUnassignedEmployees = async (req: Request, res: Response) => {
  try {
    const employees = await ReportingHierarchyService.getUnassignedEmployees();
    return res.json({ success: true, data: employees });
  } catch (error: any) {
    console.error('Error fetching unassigned employees:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const bulkUpdateManagers = async (req: Request, res: Response) => {
  try {
    const { changes, effectiveDate } = req.body;

    if (!changes || !Array.isArray(changes) || changes.length === 0) {
      return res.status(400).json({ success: false, message: 'No changes provided.' });
    }
    if (!effectiveDate) {
      return res.status(400).json({ success: false, message: 'Effective date is required.' });
    }

    const changedBy = req.user!.userId;

    const result = await ReportingHierarchyService.bulkUpdateManagers(changes, changedBy, effectiveDate);
    return res.json(result);
  } catch (error: any) {
    console.error('Error in bulk update:', error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getMyManager = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const managerData = await ReportingHierarchyService.getMyManager(userId);
    return res.json({ success: true, data: managerData });
  } catch (error: any) {
    console.error('Error fetching my manager:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getLevels = async (req: Request, res: Response) => {
  try {
    const levels = await ReportingHierarchyService.getLevels();
    return res.json({ success: true, data: levels });
  } catch (error: any) {
    console.error('Error fetching levels:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const updateLevel = async (req: Request, res: Response) => {
  try {
    const depth = parseInt(req.params.depth as string, 10);
    const { name } = req.body;
    
    if (isNaN(depth) || !name) {
      return res.status(400).json({ success: false, message: 'Invalid depth or name' });
    }

    await ReportingHierarchyService.updateLevel(depth, name);
    return res.json({ success: true, message: 'Level name updated successfully' });
  } catch (error: any) {
    console.error('Error updating level:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
