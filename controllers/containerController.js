const db = require('../config/db');
const historyController = require('./historyController');

// ── 1. ASSEMBLE A NEW SET ──
exports.assembleSet = async (req, res) => {
  const { set_id, vehicle_type, asset_ids } = req.body;
  
  if (!set_id || !asset_ids || !Array.isArray(asset_ids)) {
    return res.status(400).json({ error: 'set_id and asset_ids array are required.' });
  }
  
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [existingSet] = await conn.query('SELECT id FROM containers WHERE set_id = ?', [set_id]);
    if (existingSet.length > 0) throw new Error(`Set ID ${set_id} already exists.`);

    const [assets] = await conn.query(
      'SELECT asset_id, type, status FROM components WHERE asset_id IN (?)',
      [asset_ids]
    );

    const unavailable = assets.filter(a => a.status !== 'available');
    if (unavailable.length > 0) throw new Error(`Assets not available: ${unavailable.map(a => a.asset_id).join(', ')}`);

    // Hardcoding location to 1 (Plant A) for now, or you can pass it in req.body
    const assemblyLocationId = req.body.location_id || 1; 

    // Create Container
    await conn.query(
      'INSERT INTO containers (set_id, vehicle_type, status, current_location_id) VALUES (?, ?, "assembled", ?)',
      [set_id, vehicle_type, assemblyLocationId]
    );

    // Link Components
    await conn.query(
      'UPDATE components SET set_id = ?, status = "in_use", current_location_id = ? WHERE asset_id IN (?)',
      [set_id, assemblyLocationId, asset_ids]
    );

    // ── LOG ASSEMBLY WITH LOCATION ──
    for (const asset of assets) {
      await historyController.logHistory('ASSEMBLED', asset.asset_id, { 
        set_id, 
        vehicle_type,
        location_id: assemblyLocationId // <-- ADDED LOCATION
      }, conn); 
    }

    await conn.commit();
    res.status(201).json({ success: true, message: `Set ${set_id} assembled successfully.` });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
};


// ── 2. GET ALL SETS (Only active ones) ──
exports.getContainers = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        c.*, 
        COUNT(comp.id) as component_count
      FROM containers c
      LEFT JOIN components comp ON c.set_id = comp.set_id
      WHERE c.status != 'disassembled'  -- ✅ Hide archived sets
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── 3. GET SINGLE SET WITH COMPONENTS ──
exports.getContainerById = async (req, res) => {
  try {
    const [set] = await db.query('SELECT * FROM containers WHERE set_id = ?', [req.params.setId]);
    if (set.length === 0) return res.status(404).json({ error: 'Set not found' });

    // THE FIX: Added rfid_tag_id to the SELECT statement
    const [components] = await db.query(
      'SELECT id, asset_id, type, status, rfid_tag_id FROM components WHERE set_id = ?', 
      [req.params.setId]
    );
    
    res.json({ ...set[0], components });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── 4. DISASSEMBLE SET (Archive) ──
exports.disassembleSet = async (req, res) => {
  const { setId } = req.params;
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [set] = await conn.query('SELECT current_location_id FROM containers WHERE set_id = ?', [setId]);
    if (set.length === 0) throw new Error('Set not found');
    const currentLocationId = set[0].current_location_id;

    // Get components before unlinking them
    const [components] = await conn.query('SELECT asset_id FROM components WHERE set_id = ?', [setId]);

    // Unlink components (keep this exactly as it was)
    await conn.query('UPDATE components SET set_id = NULL, status = "available" WHERE set_id = ?', [setId]);

    // ✅ THE FIX: Instead of deleting, just mark it as disassembled
    await conn.query('UPDATE containers SET status = "disassembled" WHERE set_id = ?', [setId]);

    // ── LOG DISASSEMBLY WITH LOCATION ──
    for (const comp of components) {
      await historyController.logHistory('DISASSEMBLED', comp.asset_id, { 
        set_id: setId,
        location_id: currentLocationId 
      }, conn);
    }

    await conn.commit();
    res.json({ message: `Set ${setId} disassembled successfully.` });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
};
