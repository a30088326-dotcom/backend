import { Request, Response } from 'express';
import { db } from '../../lib/db';
import { RowDataPacket } from 'mysql2';
import { v4 as uuidv4 } from 'uuid';

export const holidayCalendarController = {
  async getCalendar(req: Request, res: Response) {
    try {
      const { year, groupId } = req.params;
      const [calRows] = await db.query<RowDataPacket[]>('SELECT * FROM holidaycalendar WHERE year = ? AND calendarGroupId = ? LIMIT 1', [parseInt(year as string), groupId as string]);
      const calendar = calRows[0];

      if (!calendar) {
        return res.json({ success: true, data: null });
      }

      const [days] = await db.query<RowDataPacket[]>(`
        SELECT cd.*, dt.id as dt_id, dt.name as dt_name, dt.description as dt_desc, dt.type as dt_type, dt.displayColor as dt_color 
        FROM calendarday cd
        JOIN daytype dt ON cd.dayTypeId = dt.id
        WHERE cd.holidayCalendarId = ?
      `, [calendar.id]);

      calendar.days = days.map(d => ({
        ...d,
        dayType: { id: d.dt_id, name: d.dt_name, description: d.dt_desc, type: d.dt_type, displayColor: d.dt_color }
      }));

      res.json({ success: true, data: calendar });
    } catch (error) {
      console.error('Failed to fetch Holiday Calendar:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch Holiday Calendar' });
    }
  },

  async saveCalendar(req: Request, res: Response) {
    try {
      const { year, calendarGroupId, days } = req.body;
      
      const connection = await db.getConnection();
      let calendarId = '';
      try {
        await connection.beginTransaction();

        const [calRows] = await connection.query<RowDataPacket[]>('SELECT id FROM holidaycalendar WHERE year = ? AND calendarGroupId = ? LIMIT 1', [parseInt(year), calendarGroupId]);
        if (calRows.length > 0) {
          calendarId = calRows[0].id;
        } else {
          calendarId = uuidv4();
          await connection.query('INSERT INTO holidaycalendar (id, year, calendarGroupId, createdAt, updatedAt) VALUES (?, ?, ?, NOW(), NOW())', [calendarId, parseInt(year), calendarGroupId]);
        }

        await connection.query('DELETE FROM calendarday WHERE holidayCalendarId = ?', [calendarId]);

        if (days && days.length > 0) {
          for (const d of days) {
            await connection.query('INSERT INTO calendarday (id, date, holidayCalendarId, dayTypeId, createdAt, updatedAt) VALUES (?, ?, ?, ?, NOW(), NOW())', [uuidv4(), new Date(d.date), calendarId, d.dayTypeId]);
          }
        }

        await connection.commit();
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }

      const [updatedCalRows] = await db.query<RowDataPacket[]>('SELECT * FROM holidaycalendar WHERE id = ? LIMIT 1', [calendarId]);
      const updatedCalendar = updatedCalRows[0];
      const [newDays] = await db.query<RowDataPacket[]>(`
        SELECT cd.*, dt.id as dt_id, dt.name as dt_name, dt.description as dt_desc, dt.type as dt_type, dt.displayColor as dt_color 
        FROM calendarday cd
        JOIN daytype dt ON cd.dayTypeId = dt.id
        WHERE cd.holidayCalendarId = ?
      `, [calendarId]);
      
      updatedCalendar.days = newDays.map(d => ({
        ...d,
        dayType: { id: d.dt_id, name: d.dt_name, description: d.dt_desc, type: d.dt_type, displayColor: d.dt_color }
      }));

      res.status(200).json({ success: true, data: updatedCalendar });
    } catch (error: any) {
      console.error('Failed to save Holiday Calendar:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  }
};
