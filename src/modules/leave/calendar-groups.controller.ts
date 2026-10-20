import { Request, Response } from 'express';
import { db } from '../../lib/db';
import { RowDataPacket } from 'mysql2';
import { v4 as uuidv4 } from 'uuid';

export const calendarGroupsController = {
  async getAll(req: Request, res: Response) {
    try {
      const [groups] = await db.query<RowDataPacket[]>('SELECT * FROM calendargroup ORDER BY createdAt DESC');
      res.json({ success: true, data: groups });
    } catch (error) {
      console.error('Failed to fetch Calendar Groups:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch Calendar Groups' });
    }
  },

  async create(req: Request, res: Response) {
    try {
      const { displayName, description, isCompanyCalendar, weekendConfiguration } = req.body;
      
      if (isCompanyCalendar) {
        await db.query('UPDATE calendargroup SET isCompanyCalendar = 0 WHERE isCompanyCalendar = 1');
      }

      const newId = uuidv4();
      await db.query(`
        INSERT INTO calendargroup (id, displayName, description, isCompanyCalendar, weekendConfiguration, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, NOW(), NOW())
      `, [newId, displayName, description || null, isCompanyCalendar ? 1 : 0, weekendConfiguration ? JSON.stringify(weekendConfiguration) : null]);
      
      const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM calendargroup WHERE id = ?', [newId]);
      res.status(201).json({ success: true, data: rows[0] });
    } catch (error: any) {
      console.error('Failed to create Calendar Group:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  },

  async update(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { displayName, description, isCompanyCalendar, weekendConfiguration } = req.body;
      
      if (isCompanyCalendar) {
        await db.query('UPDATE calendargroup SET isCompanyCalendar = 0 WHERE isCompanyCalendar = 1 AND id != ?', [id]);
      }
      
      await db.query(`
        UPDATE calendargroup SET displayName = ?, description = ?, isCompanyCalendar = ?, weekendConfiguration = ?, updatedAt = NOW()
        WHERE id = ?
      `, [displayName, description || null, isCompanyCalendar ? 1 : 0, weekendConfiguration ? JSON.stringify(weekendConfiguration) : null, id]);
      
      const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM calendargroup WHERE id = ?', [id]);
      res.json({ success: true, data: rows[0] });
    } catch (error: any) {
      console.error('Failed to update Calendar Group:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  },

  async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await db.query('DELETE FROM calendargroup WHERE id = ?', [id]);
      res.json({ success: true, message: 'Calendar Group deleted successfully' });
    } catch (error: any) {
      console.error('Failed to delete Calendar Group:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  }
};
