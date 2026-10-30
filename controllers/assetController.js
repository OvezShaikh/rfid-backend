const db = require('../config/db');

// ── CREATE ──
exports.createAsset = async (req, res) => {
  const {
    asset_id, type, rfid_tag_id, location_id,
    pallet_type, sleeve_fold_type, lid_hinge_type, color, notes,
  } = req.body;

  try {
    const [existing] = await db.query(
      'SELECT id FROM components WHERE rfid_tag_id = ?', [rfid_tag_id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: 'RFID Tag is already registered to another asset.' });
    }

    const [result] = await db.query(
      `INSERT INTO components
        (asset_id, type, rfid_tag_id, current_location_id,
         pallet_type, sleeve_fold_type, lid_hinge_type, color, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        asset_id, type, rfid_tag_id, location_id || null,
        type === 'Pallet' ? pallet_type      : null,
        type === 'Sleeve' ? sleeve_fold_type : null,
        type === 'Lid'    ? lid_hinge_type   : null,
        color || null,
        notes || null,
      ]
    );
    res.status(201).json({ message: 'Asset created successfully', id: result.insertId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ── READ (list) ──
exports.getAssets = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT c.*, l.location_name, l.location_code, l.type AS location_type
      FROM components c
      LEFT JOIN locations l ON c.current_location_id = l.id
      ORDER BY c.id DESC
    `);
    res.json(rows);
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