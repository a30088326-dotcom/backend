import { Request, Response } from 'express';
import { db } from '../../lib/db';
import { RowDataPacket } from 'mysql2';
import { v4 as uuidv4 } from 'uuid';

export const dayTypesController = {
  async getAll(req: Request, res: Response) {
    try {
      const [dayTypes] = await db.query<RowDataPacket[]>('SELECT * FROM daytype ORDER BY createdAt DESC');
      res.json({ success: true, data: dayTypes });
    } catch (error) {
      console.error('Failed to fetch Day Types:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch Day Types' });
    }
  },

  async create(req: Request, res: Response) {
    try {
      const { name, description, type, halfDaySegment, leaveAmount, displayColor, excludeInHolidayAsLeave, workflowStatus } = req.body;
      
      const newId = uuidv4();
      await db.query(`
        INSERT INTO daytype (id, name, description, type, halfDaySegment, leaveAmount, displayColor, excludeInHolidayAsLeave, workflowStatus, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `, [
        newId, name, description, type, halfDaySegment || null, parseFloat(leaveAmount) || 0,
        displayColor, excludeInHolidayAsLeave ? 1 : 0, workflowStatus || 'PENDING'
      ]);
      
      const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM daytype WHERE id = ?', [newId]);
      res.status(201).json({ success: true, data: rows[0] });
    } catch (error: any) {
      console.error('Failed to create Day Type:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  },

  async update(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { name, description, type, halfDaySegment, leaveAmount, displayColor, excludeInHolidayAsLeave, workflowStatus } = req.body;
      
      await db.query(`
        UPDATE daytype SET name = ?, description = ?, type = ?, halfDaySegment = ?, leaveAmount = ?, displayColor = ?, excludeInHolidayAsLeave = ?, workflowStatus = ?, updatedAt = NOW()
        WHERE id = ?
      `, [
        name, description, type, halfDaySegment || null, parseFloat(leaveAmount) || 0,
        displayColor, excludeInHolidayAsLeave ? 1 : 0, workflowStatus || 'PENDING', id
      ]);
      
      const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM daytype WHERE id = ?', [id]);
      res.json({ success: true, data: rows[0] });
    } catch (error: any) {
      console.error('Failed to update Day Type:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  },

  async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await db.query('DELETE FROM daytype WHERE id = ?', [id]);
      res.json({ success: true, message: 'Day Type deleted successfully' });
    } catch (error: any) {
      console.error('Failed to delete Day Type:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  }
};
