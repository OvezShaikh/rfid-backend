// controllers/emailTemplateController.js
const db = require('../config/db');

exports.list = async (req, res) => {
  const [rows] = await db.query('SELECT * FROM email_templates ORDER BY id');
  res.json(rows);
};

exports.update = async (req, res) => {
  const { id } = req.params;
  const { subject, body_html, body_text, is_active } = req.body;
  try {
    await db.query(
      `UPDATE email_templates SET
         subject   = COALESCE(?, subject),
         body_html = COALESCE(?, body_html),
         body_text = COALESCE(?, body_text),
         is_active = COALESCE(?, is_active)
       WHERE id = ?`,
      [subject, body_html, body_text, is_active, id]
    );
    res.json({ message: 'Template updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};