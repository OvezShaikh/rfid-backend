// services/emailTrigger.js
const db = require('../config/db');
const { transporter } = require('./mailer');
const path = require('path');
const fs = require('fs');
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'unostar-logo.png');
const LOGO_CID = 'unostar-logo';

function render(str, vars) {
  if (!str) return '';
  return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => {
    const v = p.split('.').reduce((o, k) => (o == null ? o : o[k]), vars);
    return v == null ? '' : String(v);
  });
}

async function resolveRecipients(locationId) {
  let groups;
  if (locationId) {
    [groups] = await db.query(`
      SELECT g.id, m.email
      FROM email_groups g
      LEFT JOIN email_group_members m ON m.group_id = g.id
      WHERE g.is_active = 1
        AND (g.location_id = ? OR g.location_id IS NULL)
    `, [locationId]);
  } else {
    [groups] = await db.query(`
      SELECT g.id, m.email
      FROM email_groups g
      LEFT JOIN email_group_members m ON m.group_id = g.id
      WHERE g.is_active = 1
    `);
  }
  const emails = new Set();
  groups.forEach((g) => { if (g.email) emails.add(g.email.trim().toLowerCase()); });

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

/**
 * Trigger an email event.
 * @param {string} eventKey
 * @param {object} context
 * @param {object} [options] - optional extras
 * @param {Array<{filename:string, path?:string, content?:Buffer, cid?:string}>} [options.attachments]
 */
async function trigger(eventKey, context, options = {}) {
  const startedAt = new Date();

  const [tplRows] = await db.query(
    `SELECT * FROM email_templates WHERE event_key = ? AND is_active = 1 LIMIT 1`,
    [eventKey]
  );
  if (tplRows.length === 0) {
    console.warn(`[email] no active template for "${eventKey}" — skipping`);
    return { skipped: true, reason: 'no template' };
  }
  const tpl = tplRows[0];

  const locationId = context.location_id || context.from_location_id || context.to_location_id || null;
const recipients = await resolveRecipients(locationId);

// ADDITIVE: allow caller to explicitly override recipients (e.g. "Send test email" button).
// If not provided, behaviour is identical to before.
const override = Array.isArray(context.override_recipients) ? context.override_recipients : null;
const finalRecipients = override && override.length ? override : recipients;

if (finalRecipients.length === 0) {
  console.warn(`[email] no recipients for location ${locationId} on "${eventKey}" — skipping`);
  return { skipped: true, reason: 'no recipients' };
}

  const vars = {
    ...context,
    created_at: context.created_at || new Date().toLocaleString('en-IN'),
    received_at: context.received_at || new Date().toLocaleString('en-IN'),
    returned_at: context.returned_at || new Date().toLocaleString('en-IN'),
  };
  const subject = render(tpl.subject, vars);
  const html = render(tpl.body_html, vars);
  const text = render(tpl.body_text, vars);

  const [logResult] = await db.query(
    `INSERT INTO email_log (event_key, template_id, recipients, subject, status, context)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
    [eventKey, tpl.id, finalRecipients.join(','), subject, JSON.stringify(context)]
  );
  const logId = logResult.insertId;

  try {
    const mailOptions = {
      from: `"${process.env.SMTP_FROM_NAME || 'RFID Tracking Pool'}" <${process.env.SMTP_FROM_EMAIL || 'info@unostar.in'}>`,
      to: finalRecipients.join(', '),
      subject, text, html,
    };

    // Build attachments: logo (inline CID) + caller-supplied files
    const attachments = [];
    if (fs.existsSync(LOGO_PATH)) {
      attachments.push({ filename: 'unostar-logo.png', path: LOGO_PATH, cid: LOGO_CID });
    } else {
      console.warn(`[email] logo missing at ${LOGO_PATH} — sending without logo`);
    }
    if (Array.isArray(options.attachments)) {
      attachments.push(...options.attachments);
    }
    if (attachments.length > 0) {
      mailOptions.attachments = attachments;
    }

    const info = await transporter.sendMail(mailOptions);

    await db.query(
      `UPDATE email_log SET status='sent', message_id=?, sent_at=NOW() WHERE id=?`,
      [info.messageId || null, logId]
    );

    console.log(`[email] ${eventKey} → ${finalRecipients.length} recipient(s) in ${Date.now() - startedAt}ms`);
    return { sent: true, recipients: finalRecipients.length, messageId: info.messageId, logId };
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