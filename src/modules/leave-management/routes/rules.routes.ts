import { Router } from 'express';
import { db } from '../../../lib/db';
import { RowDataPacket } from 'mysql2';
import { LeaveRulesEvaluator } from '../services/leaveRulesEvaluator';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, requireAdmin } from '../../../middleware/auth';

const router = Router();
router.use(requireAuth, requireAdmin);

// GET all scripts
router.get('/scripts', async (req, res) => {
  try {
    const [scripts] = await db.query<RowDataPacket[]>('SELECT * FROM leave_rule_scripts ORDER BY createdAt DESC');
    res.json(scripts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET single script
router.get('/scripts/:id', async (req, res) => {
  try {
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM leave_rule_scripts WHERE id = ? LIMIT 1', [req.params.id]);
    const script = rows[0];
    if (!script) {
      return res.status(404).json({ error: 'Script not found' });
    }
    res.json(script);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE script
router.post('/scripts', async (req, res) => {
  try {
    const { name, description, content, isDefault } = req.body;
    LeaveRulesEvaluator.validateCustomScript(content);
    const newId = uuidv4();
    await db.query(
      'INSERT INTO leave_rule_scripts (id, name, description, content, isDefault, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
      [newId, name, description, content, isDefault ? 1 : 0]
    );
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM leave_rule_scripts WHERE id = ?', [newId]);
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE script
router.put('/scripts/:id', async (req, res) => {
  try {
    const { name, description, content, isDefault } = req.body;
    LeaveRulesEvaluator.validateCustomScript(content);
    await db.query(
      'UPDATE leave_rule_scripts SET name = ?, description = ?, content = ?, isDefault = ?, updatedAt = NOW() WHERE id = ?',
      [name, description, content, isDefault ? 1 : 0, req.params.id]
    );
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM leave_rule_scripts WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE script
router.delete('/scripts/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM leave_rule_scripts WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// TEST script
router.post('/scripts/test', async (req, res) => {
  try {
    const { employeeId, leaveTypeId, leaveYear, scriptContent } = req.body;
    
    if (!employeeId || !leaveTypeId || !leaveYear) {
      return res.status(400).json({ error: 'Missing required test parameters' });
    }

    const result = await LeaveRulesEvaluator.evaluate(
      { employeeId, leaveTypeId, leaveYear: parseInt(leaveYear) },
      scriptContent
    );
    
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
