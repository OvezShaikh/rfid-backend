const db = require('../config/db');

exports.getAssetHistory = async (req, res) => {
  const { assetId } = req.params;
  try {
    // Join with locations if you want to show the physical location name
    const [rows] = await db.query(
      `SELECT id, action_type, entity_id, details, created_at 
       FROM audit_logs 
       WHERE entity_id = ? 
       ORDER BY created_at DESC`,
      [assetId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Helper function to write to history from other controllers
exports.logHistory = async (actionType, entityId, details, connection = db) => {
  try {
    await connection.query(
      'INSERT INTO audit_logs (action_type, entity_id, details) VALUES (?, ?, ?)',
      [actionType, entityId, JSON.stringify(details)]
    );
  } catch (err) {
    console.error('Failed to write history log:', err);
  }
};

// ── GET HISTORY FOR A SPECIFIC SET ──
exports.getSetHistory = async (req, res) => {
  const { setId } = req.params;
  try {
    // This query gets all logs where the entity_id matches the Set ID, 
    // OR the entity_id belongs to a component currently inside that Set.
    const [rows] = await db.query(
      `SELECT id, action_type, entity_id, details, created_at 
       FROM audit_logs 
       WHERE entity_id = ? 
          OR details LIKE ?
          OR entity_id IN (SELECT asset_id FROM components WHERE set_id = ?)
       ORDER BY created_at DESC`,
      [setId, `%"set_id":"${setId}"%`, setId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Add this to your existing historyController.js
exports.getScanTrend = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        DATE_FORMAT(created_at, '%Y-%m-%d') as date,
        COUNT(*) as scans
      FROM audit_logs
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
      ORDER BY date ASC
    `);

    const daysMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const result = [];
    
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayName = daysMap[d.getDay()];
      
      const found = rows.find(r => r.date === dateStr);
      result.push({
        day: dayName,
        scans: found ? found.scans : 0
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};