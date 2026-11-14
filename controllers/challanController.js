const db = require('../config/db');
const historyController = require('./historyController');
const emailTrigger = require('../services/emailTrigger');

// ─────────────────────────────────────────────────────────────────────
// Helper: fire-and-forget email for DC creation.
// Runs after the DC has already been committed and the response sent.
// Never throws — any failure is logged and swallowed.
// ─────────────────────────────────────────────────────────────────────
async function notifyDcCreated({ challanNo, fromId, toId, vehicleNo, driverName, setIds }) {
  try {
    // Resolve location names for the template
    const ids = [fromId, toId].filter(Boolean);
    let locMap = {};
    if (ids.length) {
      const [locs] = await db.query(
        'SELECT id, location_name FROM locations WHERE id IN (?)',
        [ids]
      );
      locMap = Object.fromEntries(locs.map((l) => [l.id, l.location_name]));
    }

    // Count components in all sets on this challan
    let itemCount = 0;
    if (Array.isArray(setIds) && setIds.length > 0) {
      const [[row]] = await db.query(
        'SELECT COUNT(*) AS c FROM components WHERE set_id IN (?)',
        [setIds]
      );
      itemCount = Number(row?.c || 0);
    }

    await emailTrigger.trigger('dc_created', {
      location_id:   toId,                          // notify destination team
      dc_number:     challanNo,
      from_location: locMap[fromId] || 'Unknown',
      to_location:   locMap[toId]   || 'Unknown',
      vehicle_no:    vehicleNo   || '-',
      driver_name:   driverName  || '-',
      item_count:    itemCount,
      created_at:    new Date().toLocaleString('en-IN'),
    });
  } catch (err) {
    // Never bubble up — email failure must not affect the DC
    console.error('[email] dc_created failed:', err.message);
  }
}

// ── 1. CREATE CHALLAN (Manual or Auto) ──
exports.createChallan = async (req, res) => {
  const {
    challan_no, from_location_id, to_location_id,
    lr_no, vehicle_no, driver_name, driver_mob, set_ids,
  } = req.body;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const finalChallanNo = challan_no || `DC-${Date.now().toString().slice(-6)}`;

    // 1. Insert Header
    const [result] = await conn.query(
      `INSERT INTO delivery_challans
       (challan_no, from_location_id, to_location_id, lr_no, vehicle_no, driver_name, driver_mob, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'dispatched')`,
      [finalChallanNo, from_location_id, to_location_id, lr_no, vehicle_no, driver_name, driver_mob]
    );
    const challanId = result.insertId;

    // 2. Insert Sets & Update Locations
    if (set_ids && set_ids.length > 0) {
      const values = set_ids.map((setId) => [challanId, setId]);
      await conn.query('INSERT INTO challan_sets (challan_id, set_id) VALUES ?', [values]);

      await conn.query(
        'UPDATE containers SET status = "dispatched", current_location_id = ?, dispatch_time = NOW() WHERE set_id IN (?)',
        [to_location_id, set_ids]
      );

      await conn.query(
        'UPDATE components SET current_location_id = ? WHERE set_id IN (?)',
        [to_location_id, set_ids]
      );

      const [components] = await conn.query('SELECT asset_id FROM components WHERE set_id IN (?)', [set_ids]);
      for (const comp of components) {
        await historyController.logHistory('DISPATCHED', comp.asset_id, {
          challan_no: finalChallanNo,
          location_id: to_location_id,
          note: 'Bulk dispatched via Challan',
        }, conn);
      }
    }

    await conn.commit();

    // ✅ Respond first — the caller gets an answer immediately
    res.status(201).json({ success: true, challan_id: challanId, challan_no: finalChallanNo });

    // ✅ Fire the email trigger AFTER the response — pure fire-and-forget.
    //    The helper's internal try/catch guarantees this never throws.
    notifyDcCreated({
      challanNo:   finalChallanNo,
      fromId:      from_location_id,
      toId:        to_location_id,
      vehicleNo:   vehicle_no,
      driverName:  driver_name,
      setIds:      set_ids,
    });
  } catch (err) {
    await conn.rollback();
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  } finally {
    conn.release();
  }
};

// ── 2. GET ALL CHALLANS ──  (unchanged)
exports.getAllChallans = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT dc.*,
        l1.location_name as from_name,
        l2.location_name as to_name_loc,
        COUNT(cs.set_id) as total_sets
      FROM delivery_challans dc
      LEFT JOIN locations l1 ON dc.from_location_id = l1.id
      LEFT JOIN locations l2 ON dc.to_location_id = l2.id
      LEFT JOIN challan_sets cs ON dc.id = cs.challan_id
      GROUP BY dc.id
      ORDER BY dc.created_at DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ── 3. GET SINGLE CHALLAN DETAILS ──  (unchanged)
exports.getChallanById = async (req, res) => {
  try {
    const [header] = await db.query('SELECT * FROM delivery_challans WHERE id = ?', [req.params.id]);
    if (header.length === 0) return res.status(404).json({ error: 'Challan not found' });

    const [sets] = await db.query(`
      SELECT cs.set_id, c.vehicle_type, COUNT(comp.id) as parts_count
      FROM challan_sets cs
      JOIN containers c ON cs.set_id = c.set_id
      LEFT JOIN components comp ON c.set_id = comp.set_id
      WHERE cs.challan_id = ?
      GROUP BY cs.set_id
    `, [req.params.id]);

    const [components] = await db.query(`
      SELECT comp.type, COUNT(*) as qty
      FROM components comp
      JOIN challan_sets cs ON comp.set_id = cs.set_id
      WHERE cs.challan_id = ?
      GROUP BY comp.type
    `, [req.params.id]);

    res.json({ ...header[0], sets, components });
  } catch (err) { res.status(500).json({ error: err.message }); }
};