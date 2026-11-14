const db = require('../config/db');

// Get rules for all vehicle types
exports.getVehicleConfigs = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM vehicle_configs');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Add a new vehicle type rule (Future-proofing)
exports.createVehicleConfig = async (req, res) => {
  const { vehicle_type, required_inserts, required_layer_pads } = req.body;
  try {
    await db.query(
      'INSERT INTO vehicle_configs (vehicle_type, required_inserts, required_layer_pads) VALUES (?, ?, ?)',
      [vehicle_type, required_inserts, required_layer_pads]
    );
    res.status(201).json({ message: 'Rule added successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};