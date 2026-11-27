// services/dockTatReport.js
const ExcelJS = require('exceljs');
const db = require('../config/db');

// ⚠️ Must match the real action_type values in scan_logs.
// UAT is empty so this cannot be verified yet — when the first scan
// arrives, run: SELECT DISTINCT action_type FROM scan_logs;
// and patch these two constants if they differ.
const DOCK_IN  = 'DOCK_IN';
const DOCK_OUT = 'DOCK_OUT';

async function buildDockTatWorkbook(referenceDate = new Date()) {
  const end   = referenceDate;
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);

  // UAT scan_logs columns: id, tag_id, action_type, vehicle_no, location_id, operator_id, created_at
  // No challan link exists in UAT — TAT is per vehicle-visit, not per challan.
  const [rows] = await db.query(`
    SELECT
      sl.vehicle_no,
      l.location_name,
      MIN(CASE WHEN sl.action_type = ? THEN sl.created_at END) AS dock_in_time,
      MAX(CASE WHEN sl.action_type = ? THEN sl.created_at END) AS dock_out_time,
      TIMESTAMPDIFF(
        MINUTE,
        MIN(CASE WHEN sl.action_type = ? THEN sl.created_at END),
        COALESCE(MAX(CASE WHEN sl.action_type = ? THEN sl.created_at END), UTC_TIMESTAMP())
      ) AS tat_minutes,
      CASE
        WHEN MAX(CASE WHEN sl.action_type = ? THEN sl.created_at END) IS NULL THEN 'OPEN'
        ELSE 'CLOSED'
      END AS dock_status
    FROM scan_logs sl
    LEFT JOIN locations l ON l.id = sl.location_id
    WHERE sl.created_at >= ? AND sl.created_at < ?
      AND sl.action_type IN (?, ?)
    GROUP BY sl.vehicle_no, l.location_name
    HAVING dock_in_time IS NOT NULL
    ORDER BY dock_in_time DESC
  `, [DOCK_IN, DOCK_OUT, DOCK_IN, DOCK_OUT, DOCK_OUT, start, end, DOCK_IN, DOCK_OUT]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'UnoTrace';

  const cols = [
    { header: 'Vehicle',     key: 'vehicle_no',    width: 20 },
    { header: 'Location',    key: 'location_name', width: 24 },
    { header: 'Dock In',     key: 'dock_in_time',  width: 22 },
    { header: 'Dock Out',    key: 'dock_out_time', width: 22 },
    { header: 'TAT (min)',   key: 'tat_minutes',   width: 12 },
    { header: 'Dock Status', key: 'dock_status',   width: 12 },
  ];

  const ws = wb.addWorksheet('Dock TAT (24h)');
  ws.columns = cols;
  ws.getRow(1).font = { bold: true };
  rows.forEach(r => ws.addRow({
    vehicle_no:    r.vehicle_no,
    location_name: r.location_name,
    dock_in_time:  r.dock_in_time  ? new Date(r.dock_in_time).toLocaleString('en-IN')  : '',
    dock_out_time: r.dock_out_time ? new Date(r.dock_out_time).toLocaleString('en-IN') : '',
    tat_minutes:   r.tat_minutes,
    dock_status:   r.dock_status,
  }));

  const open = wb.addWorksheet('Still Open');
  open.columns = cols.map(c => ({ ...c }));
  open.getRow(1).font = { bold: true };
  rows.filter(r => r.dock_status === 'OPEN').forEach(r => open.addRow({
    vehicle_no:    r.vehicle_no,
    location_name: r.location_name,
    dock_in_time:  r.dock_in_time ? new Date(r.dock_in_time).toLocaleString('en-IN') : '',
    dock_out_time: '',
    tat_minutes:   r.tat_minutes,
    dock_status:   r.dock_status,
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