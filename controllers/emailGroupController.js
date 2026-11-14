// controllers/emailGroupController.js
const db = require('../config/db');

exports.list = async (req, res) => {
  try {
    const [groups] = await db.query(`
      SELECT g.*, l.location_name,
             (SELECT COUNT(*) FROM email_group_members WHERE group_id = g.id) AS member_count
      FROM email_groups g
      LEFT JOIN locations l ON g.location_id = l.id
      ORDER BY g.location_id IS NULL, l.location_name, g.name
    `);

    const ids = groups.map((g) => g.id);
    let members = [];
    if (ids.length) {
      [members] = await db.query(
        `SELECT group_id, email, name FROM email_group_members WHERE group_id IN (?)`,
        [ids]
      );
    }

    const byGroup = {};
    members.forEach((m) => {
      (byGroup[m.group_id] = byGroup[m.group_id] || []).push({ email: m.email, name: m.name });
    });

    res.json(groups.map((g) => ({ ...g, members: byGroup[g.id] || [] })));
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.create = async (req, res) => {
  const { name, location_id, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const [r] = await db.query(
      `INSERT INTO email_groups (name, location_id, description) VALUES (?, ?, ?)`,
      [name, location_id || null, description || null]
    );
    res.status(201).json({ id: r.insertId, message: 'Group created' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Group name already exists for this location' });
    res.status(500).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  const { id } = req.params;
  const { name, location_id, description, is_active } = req.body;
  try {
    await db.query(
      `UPDATE email_groups SET name=COALESCE(?,name), location_id=COALESCE(?,location_id),
       description=COALESCE(?,description), is_active=COALESCE(?,is_active) WHERE id=?`,
      [name, location_id, description, is_active, id]
    );
    res.json({ message: 'Group updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.remove = async (req, res) => {
  try {
    await db.query('DELETE FROM email_groups WHERE id=?', [req.params.id]);
    res.json({ message: 'Group deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.addMember = async (req, res) => {
  const { id } = req.params;
  const { email, name } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  try {
    await db.query(
      `INSERT INTO email_group_members (group_id, email, name) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [id, email.trim().toLowerCase(), name || null]
    );
    res.json({ message: 'Member added' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.removeMember = async (req, res) => {
  const { id, email } = req.params;
  try {
    await db.query(
      'DELETE FROM email_group_members WHERE group_id=? AND email=?',
      [id, decodeURIComponent(email)]
    );
    res.json({ message: 'Member removed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};