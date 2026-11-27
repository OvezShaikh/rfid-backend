// services/dockTatReport.js
const ExcelJS = require('exceljs');
const db = require('../config/db');

// ⚠️ PATCH THESE after running `SELECT DISTINCT action_type FROM scan_logs`
const DOCK_IN  = 'DOCK_IN';
const DOCK_OUT = 'DOCK_OUT';

async function buildDockTatWorkbook(referenceDate = new Date()) {
  const end   = referenceDate;
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);

  // For each challan touched in the last 24h:
  //   dock_in  = earliest DOCK_IN scan
  //   dock_out = latest DOCK_OUT scan (nullable)
  //   tat      = dock_out - dock_in, or now - dock_in if still open
  const [rows] = await db.query(`
    SELECT
      dc.challan_no,
      dc.vehicle_no,
      lf.location_name AS from_location,
      lt.location_name AS to_location,
      dc.status AS challan_status,
      MIN(CASE WHEN sl.action_type = ? THEN sl.created_at END) AS dock_in_time,
      MAX(CASE WHEN sl.action_type = ? THEN sl.created_at END) AS dock_out_time,
      TIMESTAMPDIFF(
        MINUTE,
        MIN(CASE WHEN sl.action_type = ? THEN sl.created_at END),
        COALESCE(
          MAX(CASE WHEN sl.action_type = ? THEN sl.created_at END),
          UTC_TIMESTAMP()
        )
      ) AS tat_minutes,
      CASE
        WHEN MAX(CASE WHEN sl.action_type = ? THEN sl.created_at END) IS NULL THEN 'OPEN'
        ELSE 'CLOSED'
      END AS dock_status
    FROM scan_logs sl
    JOIN delivery_challans dc ON dc.challan_no = sl.challan_no
    LEFT JOIN locations lf ON lf.id = dc.from_location_id
    LEFT JOIN locations lt ON lt.id = dc.to_location_id
    WHERE sl.created_at >= ? AND sl.created_at < ?
      AND sl.action_type IN (?, ?)
    GROUP BY dc.id, dc.challan_no, dc.vehicle_no, lf.location_name, lt.location_name, dc.status
    HAVING dock_in_time IS NOT NULL
    ORDER BY dock_in_time DESC
  `, [DOCK_IN, DOCK_OUT, DOCK_IN, DOCK_OUT, DOCK_OUT, start, end, DOCK_IN, DOCK_OUT]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'UnoTrace';

  const cols = [
    { header: 'Challan #',   key: 'challan_no',      width: 20 },
    { header: 'Vehicle',     key: 'vehicle_no',      width: 18 },
    { header: 'From',        key: 'from_location',   width: 22 },
    { header: 'To',          key: 'to_location',     width: 22 },
    { header: 'Dock In',     key: 'dock_in_time',    width: 22 },
    { header: 'Dock Out',    key: 'dock_out_time',   width: 22 },
    { header: 'TAT (min)',   key: 'tat_minutes',     width: 12 },
    { header: 'Dock Status', key: 'dock_status',     width: 12 },
    { header: 'Challan Status', key: 'challan_status', width: 14 },
  ];

  const ws = wb.addWorksheet('Dock TAT (24h)');
  ws.columns = cols;
  ws.getRow(1).font = { bold: true };
  rows.forEach(r => ws.addRow({
    challan_no:     r.challan_no,
    vehicle_no:     r.vehicle_no,
    from_location:  r.from_location,
    to_location:    r.to_location,
    dock_in_time:   r.dock_in_time  ? new Date(r.dock_in_time).toLocaleString('en-IN')  : '',
    dock_out_time:  r.dock_out_time ? new Date(r.dock_out_time).toLocaleString('en-IN') : '',
    tat_minutes:    r.tat_minutes,
    dock_status:    r.dock_status,
    challan_status: r.challan_status,
  }));

  const open = wb.addWorksheet('Still Open');
  open.columns = cols.map(c => ({ ...c }));
  open.getRow(1).font = { bold: true };
  rows.filter(r => r.dock_status === 'OPEN').forEach(r => open.addRow({
    challan_no:     r.challan_no,
    vehicle_no:     r.vehicle_no,
    from_location:  r.from_location,
    to_location:    r.to_location,
    dock_in_time:   r.dock_in_time ? new Date(r.dock_in_time).toLocaleString('en-IN') : '',
    dock_out_time:  '',
    tat_minutes:    r.tat_minutes,
    dock_status:    r.dock_status,
    challan_status: r.challan_status,
  }));

  const buffer = await wb.xlsx.writeBuffer();
  const openCount = rows.filter(r => r.dock_status === 'OPEN').length;

  return {
    buffer,
    totals: { total: rows.length, open: openCount, closed: rows.length - openCount },
    stamp: end.toISOString().slice(0, 10),
  };
}

module.exports = { buildDockTatWorkbook };