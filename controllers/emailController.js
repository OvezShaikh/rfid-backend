// controllers/emailController.js
const db = require('../config/db');
const emailTrigger = require('../services/emailTrigger');
const { buildDockTatWorkbook } = require('../services/dockTatReport');

// 1. Get saved recipients (legacy — kept for the existing card)
exports.getSettings = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT setting_value FROM settings WHERE setting_key = 'email_recipients'`
    );
    const recipients = rows.length ? JSON.parse(rows[0].setting_value) : [];
    res.json({ recipients });
  } catch (error) {
    console.error('DB Error in getSettings:', error);
    res.status(500).json({ error: 'Failed to fetch settings', details: error.message });
  }
};

// 2. Save recipients (legacy)
exports.saveSettings = async (req, res) => {
  const { recipients } = req.body;
  try {
    await db.query(`
      INSERT INTO settings (setting_key, setting_value)
      VALUES ('email_recipients', ?)
      ON DUPLICATE KEY UPDATE setting_value = ?
    `, [JSON.stringify(recipients), JSON.stringify(recipients)]);
    res.json({ success: true, message: 'Saved successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save settings' });
  }
};

// 3. Reusable: build Dock TAT xlsx + send via trigger
//    Called by HTTP handler AND scheduler.
async function runDockTatReport({ recipients } = {}) {
  const { buffer, totals, stamp } = await buildDockTatWorkbook();

  const context = {
    period_label: `Last 24 hours (${stamp})`,
    total: totals.total,
    open:  totals.open,
    closed: totals.closed,
    // Optional: override recipients when caller supplies them
    ...(recipients && recipients.length ? { override_recipients: recipients } : {}),
  };

  const result = await emailTrigger.trigger(
    'dock_tat_daily',
    context,
    { attachments: [{ filename: `DockTAT_${stamp}.xlsx`, content: buffer }] }
  );

  return { ...result, totals };
}

// 4. HTTP handler — supports both "test to given recipients" and "send to groups"
exports.sendReport = async (req, res) => {
  const { recipients } = req.body || {};
  try {
    const result = await runDockTatReport({ recipients });
    if (result.skipped) {
      return res.status(400).json({
        success: false,
        error: `Skipped: ${result.reason}. Check email_templates for event_key='dock_tat_daily' and recipient groups.`,
      });
    }
    res.json({ success: !!result.sent, result });
  } catch (error) {
    console.error('sendReport error:', error);
    res.status(500).json({ error: 'Failed to send email', details: error.message });
  }
};

// Export the reusable runner for scheduler / other callers
exports.runDockTatReport = runDockTatReport;