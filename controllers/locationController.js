const db = require('../config/db');

exports.getLocations = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, location_code, location_name, type FROM locations ORDER BY type, location_name'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createLocation = async (req, res) => {
  const { location_code, location_name, type } = req.body;
  try {
    const [result] = await db.query(
      'INSERT INTO locations (location_code, location_name, type) VALUES (?, ?, ?)',
      [location_code, location_name, type]
    );
    res.status(201).json({ message: 'Location created', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Location code already exists.' });
    }
    res.status(500).json({ error: err.message });
  }
};

exports.updateLocation = async (req, res) => {
  const { id } = req.params;
  const { location_code, location_name, type } = req.body;
  try {
    const [existing] = await db.query('SELECT * FROM locations WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Location not found' });

    await db.query(
      'UPDATE locations SET location_code = ?, location_name = ?, type = ? WHERE id = ?',
      [
        location_code ?? existing[0].location_code,
        location_name ?? existing[0].location_name,
        type ?? existing[0].type,
        id,
      ]
    );
    res.json({ message: 'Location updated' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Location code already exists.' });
    }
    res.status(500).json({ error: err.message });
  }
};

exports.deleteLocation = async (req, res) => {
  const { id } = req.params;
  try {
    const [existing] = await db.query('SELECT * FROM locations WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Location not found' });

    // Block delete if any component or container points at this location
    const [[{ usedInComponents }]] = await db.query(
      'SELECT COUNT(*) AS usedInComponents FROM components WHERE current_location_id = ?', [id]
    );
    const [[{ usedInContainers }]] = await db.query(
      'SELECT COUNT(*) AS usedInContainers FROM containers WHERE current_location_id = ?', [id]
    );

    if (usedInComponents > 0 || usedInContainers > 0) {
      return res.status(400).json({
        error: `Cannot delete: ${usedInComponents} component(s) and ${usedInContainers} container(s) reference this location.`,
      });
    }

    await db.query('DELETE FROM locations WHERE id = ?', [id]);
    res.json({ message: 'Location deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};