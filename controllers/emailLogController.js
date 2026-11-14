// controllers/emailLogController.js
const db = require('../config/db');
const emailTrigger = require('../services/emailTrigger');

exports.list = async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const [rows] = await db.query(
    `SELECT id, event_key, recipients, subject, status, error_message, sent_at, created_at
     FROM email_log ORDER BY id DESC LIMIT ?`,
    [limit]
  );
  res.json(rows);
};

exports.testTrigger = async (req, res) => {
  const { event_key, location_id } = req.body;
  if (!event_key) return res.status(400).json({ error: 'event_key required' });
  try {
    const result = await emailTrigger.trigger(event_key, {
      location_id: location_id || null,
      dc_number:   'TEST-DC-001',
      from_location: 'TEST Origin',
      to_location:   'TEST Destination',
      vehicle_no:    'MH-00-TEST-0001',
      driver_name:   'Test Driver',
      item_count:    5,
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.retry = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query('SELECT * FROM email_log WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Log entry not found' });
    const log = rows[0];
    if (log.status === 'sent') {
      return res.status(400).json({ error: 'Already sent' });
    }

    // Re-run the trigger with the original context
    const ctx = typeof log.context === 'string' ? JSON.parse(log.context) : (log.context || {});
    const result = await emailTrigger.trigger(log.event_key, ctx);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};