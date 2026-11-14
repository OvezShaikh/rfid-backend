// routes/reportScheduleRoutes.js
const express = require('express');
const router = express.Router();
const { runReport } = require('../services/reportScheduler');

// POST /api/report-schedule/send-now  { period: 'week'|'month'|'year' }
router.post('/send-now', async (req, res) => {
  const period = req.body?.period;
  if (!['week', 'month', 'year'].includes(period)) {
    return res.status(400).json({ error: 'period must be one of: week, month, year' });
  }
  try {
    const result = await runReport(period);
    res.json({ success: true, period, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;