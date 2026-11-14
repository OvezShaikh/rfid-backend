const db = require('../config/db');

// ── 1. GET ALL DEVICES (For the Admin UI) ──
exports.getDevices = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        d.id, 
        d.device_name, 
        d.device_type, 
        d.status, 
        d.location_id,
        l.location_name 
      FROM devices d
      JOIN locations l ON d.location_id = l.id
      ORDER BY d.id DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── 2. GET SINGLE DEVICE (For the RFID Scanner) ──
exports.getDeviceById = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        d.id, 
        d.device_name, 
        d.device_type, 
        d.status, 
        d.location_id,
        l.location_name 
      FROM devices d
      JOIN locations l ON d.location_id = l.id
      WHERE d.id = ?
    `, [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── 3. REGISTER NEW DEVICE (For the Admin UI) ──
exports.createDevice = async (req, res) => {
  const { device_name, device_type, location_id } = req.body;
  
  if (!device_name || !device_type || !location_id) {
    return res.status(400).json({ error: 'Device name, type, and location are required.' });
  }

  try {
    const [result] = await db.query(
      'INSERT INTO devices (device_name, device_type, location_id) VALUES (?, ?, ?)',
      [device_name, device_type, location_id]
    );
    
    res.status(201).json({ 
      success: true, 
      message: 'Device registered successfully.', 
      deviceId: result.insertId 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};