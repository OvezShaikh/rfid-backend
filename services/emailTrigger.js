// services/emailTrigger.js
const db = require('../config/db');
const { transporter } = require('./mailer');   // reuse the Zoho transporter from mailer.js
const path = require('path');
const fs = require('fs');
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'unostar-logo.png');
const LOGO_CID = 'unostar-logo';

// ─── Simple {{var}} / {{nested.var}} renderer — no extra dependency ──
function render(str, vars) {
  if (!str) return '';
  return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), vars);
    return v == null ? '' : String(v);
  });
}

// ─── Resolve recipients for a location ──────────────────────────────
// Includes:
//   - every active group scoped to this location
//   - every active global group (location_id IS NULL)
//   - the legacy "email_recipients" setting from the old UI (so nothing breaks)
async function resolveRecipients(locationId) {
  let groups;

  if (locationId) {
    // Scoped: groups for this location + global groups
    [groups] = await db.query(`
      SELECT g.id, m.email
      FROM email_groups g
      LEFT JOIN email_group_members m ON m.group_id = g.id
      WHERE g.is_active = 1
        AND (g.location_id = ? OR g.location_id IS NULL)
    `, [locationId]);
  } else {
    // No location given (test trigger, or event without location):
    // use every active group's members
    [groups] = await db.query(`
      SELECT g.id, m.email
      FROM email_groups g
      LEFT JOIN email_group_members m ON m.group_id = g.id
      WHERE g.is_active = 1
    `);
  }

  const emails = new Set();
  groups.forEach((g) => { if (g.email) emails.add(g.email.trim().toLowerCase()); });

  // Legacy fallback
  const [legacy] = await db.query(
    `SELECT setting_value FROM settings WHERE setting_key = 'email_recipients'`
  );
  if (legacy.length) {
    try {
      JSON.parse(legacy[0].setting_value).forEach((e) => emails.add(String(e).toLowerCase()));
    } catch (_) {}
  }

  return [...emails];
}

// ─── Main entry point ───────────────────────────────────────────────
async function trigger(eventKey, context) {
  const startedAt = new Date();

  // 1. Load template
  const [tplRows] = await db.query(
    `SELECT * FROM email_templates WHERE event_key = ? AND is_active = 1 LIMIT 1`,
    [eventKey]
  );
  if (tplRows.length === 0) {
    console.warn(`[email] no active template for "${eventKey}" — skipping`);
    return { skipped: true, reason: 'no template' };
  }
  const tpl = tplRows[0];

  // 2. Resolve recipients from groups + legacy
  const locationId = context.location_id || context.from_location_id || context.to_location_id || null;
  const recipients = await resolveRecipients(locationId);

  if (recipients.length === 0) {
    console.warn(`[email] no recipients for location ${locationId} on "${eventKey}" — skipping`);
    return { skipped: true, reason: 'no recipients' };
  }

  // 3. Prepare content
  const vars = {
    ...context,
    created_at:   context.created_at   || new Date().toLocaleString('en-IN'),
    received_at:  context.received_at  || new Date().toLocaleString('en-IN'),
    returned_at:  context.returned_at  || new Date().toLocaleString('en-IN'),
  };
  const subject = render(tpl.subject,   vars);
  const html    = render(tpl.body_html, vars);
  const text    = render(tpl.body_text, vars);

  // 4. Insert pending log
  const [logResult] = await db.query(
    `INSERT INTO email_log (event_key, template_id, recipients, subject, status, context)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
    [eventKey, tpl.id, recipients.join(','), subject, JSON.stringify(context)]
  );
  const logId = logResult.insertId;



  // 5. Send
  try {
    const mailOptions = {
        from: `"${process.env.SMTP_FROM_NAME || 'RFID Tracking Pool'}" <${process.env.SMTP_FROM_EMAIL || 'info@unostar.in'}>`,
        to: recipients.join(', '),
        subject,
        text,
        html,
    };

// Attach the logo inline if it exists — templates reference it as cid:unostar-logo
if (fs.existsSync(LOGO_PATH)) {
  mailOptions.attachments = [{
    filename: 'unostar-logo.png',
    path:     LOGO_PATH,
    cid:      LOGO_CID,
  }];
} else {
  console.warn(`[email] logo missing at ${LOGO_PATH} — sending without logo`);
}

const info = await transporter.sendMail(mailOptions);

    await db.query(
      `UPDATE email_log SET status='sent', message_id=?, sent_at=NOW() WHERE id=?`,
      [info.messageId || null, logId]
    );

    console.log(`[email] ${eventKey} → ${recipients.length} recipient(s) in ${Date.now() - startedAt}ms`);
    return { sent: true, recipients: recipients.length, messageId: info.messageId, logId };
  } catch (err) {
    await db.query(
      `UPDATE email_log SET status='failed', error_message=? WHERE id=?`,
      [err.message, logId]
    );
    console.error(`[email] ${eventKey} FAILED:`, err.message);
    return { sent: false, error: err.message, logId };
  }
}

module.exports = { trigger, resolveRecipients, render };