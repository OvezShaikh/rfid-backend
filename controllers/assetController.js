const db = require('../config/db');
const historyController = require('./historyController');

// ── CREATE ──
exports.createAsset = async (req, res) => {
  const {
    asset_id, type, rfid_tag_id, location_id,
    pallet_type, sleeve_fold_type, lid_hinge_type, 
    insert_type, layer_pad_type, // <-- Added new types
    color, notes,
  } = req.body;

  try {
    const [existing] = await db.query('SELECT id FROM components WHERE rfid_tag_id = ?', [rfid_tag_id]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'RFID Tag is already registered.' });
    }

    const [result] = await db.query(
      `INSERT INTO components
        (asset_id, type, rfid_tag_id, current_location_id,
         pallet_type, sleeve_fold_type, lid_hinge_type, insert_type, layer_pad_type, color, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        asset_id, type, rfid_tag_id, location_id || null,
        type === 'Pallet'     ? pallet_type      : null,
        type === 'Sleeve'     ? sleeve_fold_type : null,
        type === 'Lid'        ? lid_hinge_type   : null,
        type === 'Insert'     ? insert_type      : null,
        type === 'Layer Pad'  ? layer_pad_type   : null,
        color || null,
        notes || null,
      ]
    );

    await historyController.logHistory('REGISTERED', asset_id, { 
      type, rfid_tag_id, location_id 
    });
    res.status(201).json({ message: 'Asset created successfully', id: result.insertId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ── BULK CREATE ──
exports.bulkCreateAssets = async (req, res) => {
  const rows = req.body?.assets;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'assets array is required' });
  }
  if (rows.length > 5000) {
    return res.status(400).json({ error: 'Max 5000 rows per import' });
  }

  const VALID_TYPES = ['Pallet', 'Sleeve', 'Lid', 'Insert', 'Layer Pad'];

  // 1. Validate payload — same rules as createAsset, but batched
  const errors = [];
  const seenTag = new Set();
  const seenId  = new Set();

  rows.forEach((r, i) => {
    const n = i + 1;
    if (!r.asset_id)     errors.push(`row ${n}: asset_id is required`);
    if (!r.type || !VALID_TYPES.includes(r.type)) {
      errors.push(`row ${n}: type must be one of ${VALID_TYPES.join(', ')}`);
    }
    if (!r.rfid_tag_id)  errors.push(`row ${n}: rfid_tag_id is required`);
    if (!r.location_id)  errors.push(`row ${n}: location_id is required`);

    if (r.rfid_tag_id && seenTag.has(r.rfid_tag_id)) {
      errors.push(`row ${n}: duplicate rfid_tag_id "${r.rfid_tag_id}" in file`);
    }
    if (r.asset_id && seenId.has(r.asset_id)) {
      errors.push(`row ${n}: duplicate asset_id "${r.asset_id}" in file`);
    }
    if (r.rfid_tag_id) seenTag.add(r.rfid_tag_id);
    if (r.asset_id)    seenId.add(r.asset_id);
  });

  if (errors.length) {
    return res.status(400).json({
      error: `Validation failed (${errors.length} issue${errors.length > 1 ? 's' : ''})`,
      details: errors.slice(0, 50),
    });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 2. Duplicate check against existing DB rows — one query
    const tags = rows.map(r => r.rfid_tag_id);
    const ids  = rows.map(r => r.asset_id);
    const [existing] = await conn.query(
      'SELECT asset_id, rfid_tag_id FROM components WHERE rfid_tag_id IN (?) OR asset_id IN (?)',
      [tags, ids]
    );

    if (existing.length > 0) {
      await conn.rollback();
      return res.status(400).json({
        error: `${existing.length} record(s) already exist in DB`,
        details: [
          ...existing.slice(0, 25).map(e => `Tag already registered: ${e.rfid_tag_id}`),
          ...existing.slice(0, 25).map(e => `Asset ID already registered: ${e.asset_id}`),
        ],
      });
    }

    // 3. Single multi-row INSERT — same column set as createAsset
    const values = rows.map(r => [
      r.asset_id,
      r.type,
      r.rfid_tag_id,
      r.location_id,
      r.type === 'Pallet'    ? (r.pallet_type      || null) : null,
      r.type === 'Sleeve'    ? (r.sleeve_fold_type || null) : null,
      r.type === 'Lid'       ? (r.lid_hinge_type   || null) : null,
      r.type === 'Insert'    ? (r.insert_type      || null) : null,
      r.type === 'Layer Pad' ? (r.layer_pad_type   || null) : null,
      r.color   || null,
      r.notes   || null,
      r.status  || 'available',
    ]);

    const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');

    const [insertRes] = await conn.query(
      `INSERT INTO components
        (asset_id, type, rfid_tag_id, current_location_id,
         pallet_type, sleeve_fold_type, lid_hinge_type, insert_type, layer_pad_type,
         color, notes, status)
       VALUES ${placeholders}`,
      values.flat()
    );

    await conn.commit();

    // 4. Audit log — one entry per row, fire-and-forget after commit so a
    //    logging failure never rolls back a successful import.
    Promise.all(rows.map(r =>
      historyController.logHistory('REGISTERED', r.asset_id, {
        type: r.type, rfid_tag_id: r.rfid_tag_id, location_id: r.location_id, bulk: true,
      }).catch(err => console.warn(`history log failed for ${r.asset_id}:`, err.message))
    )).catch(() => {});

    res.status(201).json({
      message: 'Assets created successfully',
      created: rows.length,
      firstId: insertRes.insertId,
    });
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    console.error('Bulk create error:', error);

    if (error.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({ error: 'One or more location_id values do not exist' });
    }
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Duplicate asset_id or rfid_tag_id in DB', details: error.sqlMessage });
    }
    res.status(500).json({ error: error.message });
  } finally {
    conn.release();
  }
};

// ── READ (list) ──
exports.getAssets = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    let query = `
      SELECT c.*, l.location_name, l.location_code, l.type AS location_type
      FROM components c
      LEFT JOIN locations l ON c.current_location_id = l.id
    `;
    let countQuery = 'SELECT COUNT(*) as total FROM components';
    let queryParams = [];

    // If there's a search term, search the ENTIRE database
    if (search) {
      query += ` WHERE c.asset_id LIKE ? OR c.rfid_tag_id LIKE ?`;
      countQuery += ` WHERE asset_id LIKE ? OR rfid_tag_id LIKE ?`;
      queryParams = [`%${search}%`, `%${search}%`];
    }

    query += ` ORDER BY c.id DESC LIMIT ? OFFSET ?`;

    const [rows] = await db.query(query, [...queryParams, limit, offset]);
    const [[{ total }]] = await db.query(countQuery, queryParams);

    res.json({ data: rows, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── READ (single) ──
exports.getAssetById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.*, l.location_name, l.location_code, l.type AS location_type
       FROM components c
       LEFT JOIN locations l ON c.current_location_id = l.id
       WHERE c.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Asset not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── UPDATE ──
exports.updateAsset = async (req, res) => {
  const { id } = req.params;
  const {
    asset_id, type, rfid_tag_id, location_id,
    pallet_type, sleeve_fold_type, lid_hinge_type, color, notes, status,
  } = req.body;

  try {
    const [existing] = await db.query('SELECT * FROM components WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Asset not found' });

    if (rfid_tag_id) {
      const [tagConflict] = await db.query(
        'SELECT id FROM components WHERE rfid_tag_id = ? AND id != ?',
        [rfid_tag_id, id]
      );
      if (tagConflict.length > 0) {
        return res.status(400).json({ error: 'RFID Tag is already used by another asset.' });
      }
    }

    const resolvedType = type ?? existing[0].type;

    await db.query(
      `UPDATE components SET
        asset_id = ?,
        type = ?,
        rfid_tag_id = ?,
        current_location_id = ?,
        pallet_type = ?,
        sleeve_fold_type = ?,
        lid_hinge_type = ?,
        color = ?,
        notes = ?,
        status = ?
       WHERE id = ?`,
      [
        asset_id ?? existing[0].asset_id,
        resolvedType,
        rfid_tag_id ?? existing[0].rfid_tag_id,
        location_id ?? existing[0].current_location_id,
        resolvedType === 'Pallet' ? (pallet_type ?? null) : null,
        resolvedType === 'Sleeve' ? (sleeve_fold_type ?? null) : null,
        resolvedType === 'Lid'    ? (lid_hinge_type ?? null)   : null,
        color ?? existing[0].color,
        notes ?? existing[0].notes,
        status ?? existing[0].status,
        id,
      ]
    );
    res.json({ message: 'Asset updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── DELETE ──
exports.deleteAsset = async (req, res) => {
  const { id } = req.params;
  try {
    const [existing] = await db.query('SELECT * FROM components WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Asset not found' });

    if (existing[0].set_id) {
      return res.status(400).json({
        error: 'Cannot delete an asset that is currently part of a set. Detach it from the set first.',
      });
    }

    await db.query('DELETE FROM components WHERE id = ?', [id]);
    res.json({ message: 'Asset deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── EXCEPTIONS (for Overview / Exceptions page) ──
exports.getExceptions = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM exceptions ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── CONTAINERS (for Overview / Containers page) ──
exports.getContainers = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM containers ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── ADMIN STATS — Fast COUNT queries ──
exports.getAdminStats = async (req, res) => {
  try {
    const getCount = async (query) => {
      const [rows] = await db.query(query);
      return rows[0]?.count || 0;
    };

    // 1. Get the count for EVERY type (Pallet, Sleeve, Lid, Insert, Layer Pad)
    const [typeRows] = await db.query(
      'SELECT type, COUNT(*) as count FROM components GROUP BY type'
    );
    
    // 2. Format it into a clean object: { total: 20, Pallet: 5, Sleeve: 4, ... }
    const assetBreakdown = { total: 0 };
    typeRows.forEach(row => {
      assetBreakdown[row.type] = row.count;
      assetBreakdown.total += row.count;
    });

    // 3. Get the other counts
    const [containers, exceptions] = await Promise.all([
      getCount('SELECT COUNT(*) AS count FROM containers'),
      getCount('SELECT COUNT(*) AS count FROM exceptions')
    ]);

    // 4. Send it all back
    res.json({ 
      assets: assetBreakdown.total, // Total for the KPI dashboard
      assetBreakdown,               // Detailed breakdown for the ComponentTypesCard
      containers, 
      exceptions 
    });
  } catch (err) {
    console.error("Stats endpoint error:", err);
    res.status(500).json({ error: err.message });
  }
};

// Startup sanity check
const expected = [
  'createAsset', 'getAssets', 'getAssetById', 'updateAsset', 'deleteAsset',
  'getExceptions', 'getContainers', 'getAdminStats', 'bulkCreateAssets',
];
expected.forEach((name) => {
  if (typeof module.exports[name] !== 'function') {
    console.error(`❌ assetController missing export: ${name}`);
  }
});

// ── RESOLVE EXCEPTION ──
exports.resolveException = async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('UPDATE exceptions SET status = "closed" WHERE id = ?', [id]);
    res.json({ success: true, message: 'Exception resolved successfully.' });
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
};


