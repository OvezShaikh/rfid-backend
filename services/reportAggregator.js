// services/reportAggregator.js
const db = require('../config/db');

function getISOWeek(date) {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
}

function getPeriodRange(period, ref = new Date()) {
  const d = new Date(ref);
  if (period === 'week') {
    const day = d.getDay() || 7;
    const monday = new Date(d);
    monday.setDate(d.getDate() - day + 1);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    const wk = getISOWeek(monday);
    return { start: monday, end: sunday, label: `${monday.getFullYear()}-W${String(wk).padStart(2, '0')}`, type: 'week' };
  }
  if (period === 'month') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end, label: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`, type: 'month' };
  }
  if (period === 'year') {
    const start = new Date(d.getFullYear(), 0, 1);
    const end = new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999);
    return { start, end, label: String(d.getFullYear()), type: 'year' };
  }
  throw new Error(`Unknown period: ${period}`);
}

function toMysql(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function aggregate(period, referenceDate = new Date()) {
  const range = getPeriodRange(period, referenceDate);
  const startStr = toMysql(range.start);
  const endStr = toMysql(range.end);

  // 1. All challans in the period, with sets count and location names
  const [challans] = await db.query(`
    SELECT
      dc.id, dc.challan_no, dc.from_location_id, dc.to_location_id,
      dc.lr_no, dc.vehicle_no, dc.driver_name, dc.driver_mob,
      dc.status, dc.created_at,
      l1.location_name AS from_name,
      l2.location_name AS to_name,
      COUNT(cs.set_id) AS total_sets
    FROM delivery_challans dc
    LEFT JOIN locations l1 ON dc.from_location_id = l1.id
    LEFT JOIN locations l2 ON dc.to_location_id = l2.id
    LEFT JOIN challan_sets cs ON dc.id = cs.challan_id
    WHERE dc.created_at >= ? AND dc.created_at <= ?
    GROUP BY dc.id
    ORDER BY dc.created_at ASC
  `, [startStr, endStr]);

  // 2. Component breakdown (matches ChallanPrint categories)
  const [compRows] = await db.query(`
    SELECT comp.type, COUNT(*) AS qty
    FROM components comp
    JOIN challan_sets cs ON comp.set_id = cs.set_id
    JOIN delivery_challans dc ON cs.challan_id = dc.id
    WHERE dc.created_at >= ? AND dc.created_at <= ?
    GROUP BY comp.type
  `, [startStr, endStr]);

  const components = { Pallet: 0, Sleeve: 0, Lid: 0, Insert: 0, 'Layer Pad': 0 };
  compRows.forEach((r) => { if (r.type in components) components[r.type] = Number(r.qty); });
  const totalComponents = Object.values(components).reduce((a, b) => a + b, 0);

  // 3. Exceptions in period
  const [[excRow]] = await db.query(
    `SELECT COUNT(*) AS c FROM exceptions WHERE created_at >= ? AND created_at <= ?`,
    [startStr, endStr]
  );
  const exceptions = Number(excRow?.c || 0);

  // 4. Turnaround: sets returned within the period
  const [[turnRow]] = await db.query(`
    SELECT
      AVG(TIMESTAMPDIFF(SECOND, dispatch_time, returned_at) / 3600.0) AS avg_hours,
      COUNT(*) AS returned_count
    FROM containers
    WHERE status = 'returned'
      AND returned_at >= ? AND returned_at <= ?
      AND dispatch_time IS NOT NULL
  `, [startStr, endStr]);
  const avgTurnaroundHours = turnRow?.avg_hours ? Number(turnRow.avg_hours).toFixed(1) : '0.0';
  const returnedSets = Number(turnRow?.returned_count || 0);

  // 5. Daily breakdown (for week/month reports)
  const [daily] = await db.query(`
    SELECT DATE(dc.created_at) AS day,
           COUNT(DISTINCT dc.id) AS challans,
           COUNT(cs.set_id) AS sets_count
    FROM delivery_challans dc
    LEFT JOIN challan_sets cs ON dc.id = cs.challan_id
    WHERE dc.created_at >= ? AND dc.created_at <= ?
    GROUP BY DATE(dc.created_at)
    ORDER BY day ASC
  `, [startStr, endStr]);

  // 6. Monthly rollup (for year reports)
  const [monthly] = await db.query(`
    SELECT DATE_FORMAT(dc.created_at, '%Y-%m') AS month,
           COUNT(*) AS challans
    FROM delivery_challans dc
    WHERE dc.created_at >= ? AND dc.created_at <= ?
    GROUP BY DATE_FORMAT(dc.created_at, '%Y-%m')
    ORDER BY month ASC
  `, [startStr, endStr]);

  return {
    period: range.type,
    label: range.label,
    start: range.start,
    end: range.end,
    generatedAt: new Date(),
    totals: {
      challans: challans.length,
      sets: challans.reduce((a, c) => a + Number(c.total_sets || 0), 0),
      components: totalComponents,
      exceptions,
      returnedSets,
      avgTurnaroundHours,
    },
    components,
    challans,
    daily,
    monthly,
  };
}

module.exports = { aggregate, getPeriodRange };