const db = require('../config/db');

// ── 1. GET ALL CLIENTS ──
exports.getClients = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        c.*, 
        l.location_name 
      FROM clients c
      LEFT JOIN locations l ON c.location_id = l.id
      ORDER BY c.name ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── 2. CREATE A CLIENT ──
exports.createClient = async (req, res) => {
  const { name, contact_person, email, phone, location_id } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Client name is required.' });
  }

  try {
    const [result] = await db.query(
      'INSERT INTO clients (name, contact_person, email, phone, location_id) VALUES (?, ?, ?, ?, ?)',
      [name, contact_person || null, email || null, phone || null, location_id || null]
    );
    
    res.status(201).json({ success: true, message: 'Client created.', id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── 3. DELETE A CLIENT ──
exports.deleteClient = async (req, res) => {
  try {
    await db.query('DELETE FROM clients WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Client deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};