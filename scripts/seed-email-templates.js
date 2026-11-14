// scripts/seed-email-templates.js
require('dotenv').config();
const db = require('../config/db');

// ── Shared HTML builder — responsive mobile-friendly version ───────────────
function buildHtml(theme, fields) {
  const fieldRows = [];
  for (let i = 0; i < fields.length; i += 2) {
    const a = fields[i];
    const b = fields[i + 1] || { label: '', value: '' };
    fieldRows.push(`
      <tr>
        <td width="50%" style="padding:12px 0;vertical-align:top;">
          <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#98A2B3;font-weight:600;">${a.label}</div>
          <div style="font-size:15px;color:#0A1929;margin-top:4px;font-weight:500;">${a.value}</div>
        </td>
        <td width="50%" style="padding:12px 0;vertical-align:top;">
          <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#98A2B3;font-weight:600;">${b.label}</div>
          <div style="font-size:15px;color:#0A1929;margin-top:4px;font-weight:500;">${b.value}</div>
        </td>
      </tr>`);
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${theme.title}</title>
<style>
  /* Mobile Responsive Fixes */
  @media only screen and (max-width: 480px) {
    /* Force the header into a single column */
    .header-stack { 
      display: block !important; 
      width: 100% !important; 
    }
    /* Keep the logo left-aligned */
    .header-logo-cell {
      text-align: left !important;
      padding-bottom: 16px !important;
    }
    /* Put the pill on the right side underneath the logo */
    .header-badge-cell {
      text-align: right !important;
    }
    .header-logo { 
      max-width: 100% !important; 
      width: 220px !important; 
    }
    .field-col { 
      display: block !important; 
      width: 100% !important; 
      padding-bottom: 8px !important; 
    }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;padding:32px 16px;">
<tr><td align="center">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(16,24,40,0.06);">

  <!-- Header bar -->
  <tr><td style="background:#FFFFFF;padding:24px 32px;border-bottom:1px solid #EAECF0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      
      <!-- Logo Column -->
      <td align="left" style="vertical-align:middle;" class="header-stack header-logo-cell">
        <img src="cid:unostar-logo" alt="Unostar Value Chain" width="240" class="header-logo" style="display:block;border:0;max-width:100%;height:auto;">
      </td>
      
      <!-- Badge Column -->
      <td align="right" style="vertical-align:middle;" class="header-stack header-badge-cell">
        <span class="header-badge" style="display:inline-block;background:${theme.accentBg};color:${theme.accent};padding:6px 14px;border-radius:100px;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:700;white-space:nowrap;">${theme.badge}</span>
      </td>

    </tr></table>
  </td></tr>

  <!-- Title -->
  <tr><td style="padding:32px 32px 8px 32px;">
    <h1 style="margin:0;font-size:24px;line-height:32px;color:#0A1929;font-weight:700;">${theme.title}</h1>
    <p style="margin:8px 0 0 0;font-size:14px;line-height:20px;color:#667085;">${theme.subtitle}</p>
  </td></tr>

  <!-- DC Number card -->
  <tr><td style="padding:24px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${theme.accentBg};border:1px solid ${theme.accentBorder};border-radius:8px;">
      <tr><td style="padding:16px 20px;">
        <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${theme.accent};font-weight:600;">${theme.refLabel}</div>
        <div style="font-size:20px;font-weight:700;color:#0A1929;font-family:'Courier New',monospace;margin-top:4px;">${theme.refValue}</div>
      </td></tr>
    </table>
  </td></tr>

  <!-- Details grid (Stacks on mobile) -->
  <tr><td style="padding:0 32px 24px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${fieldRows.join('').replace(/<td width="50%" style="/g, '<td width="50%" class="field-col" style="')}
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#F9FAFB;padding:20px 32px;border-top:1px solid #EAECF0;">
    <p style="margin:0;font-size:12px;line-height:18px;color:#98A2B3;">
      Automated notification from <strong style="color:#667085;">Unostar RFID Tracking Pool</strong>. Please do not reply to this email.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

// ── The 3 templates ────────────────────────────────────────────────────
const templates = [
  {
    event_key: 'dc_created',
    name:      'DC Created — Dispatch Notification',
    subject:   'DC {{dc_number}} dispatched from {{from_location}} to {{to_location}}',
    body_html: buildHtml({
      accent:       '#027A48',
      accentBg:     '#ECFDF3',
      accentBorder: '#ABEFC6',
      badge:        'Dispatch Confirmed',
      title:        'Delivery Challan Dispatched',
      subtitle:     'Your materials are on the way.',
      refLabel:     'Challan Number',
      refValue:     '{{dc_number}}',
    }, [
      { label: 'From',       value: '{{from_location}}' },
      { label: 'To',         value: '{{to_location}}'   },
      { label: 'Vehicle',    value: '{{vehicle_no}}'    },
      { label: 'Driver',     value: '{{driver_name}}'   },
      { label: 'Items',      value: '{{item_count}}'    },
      { label: 'Dispatched', value: '{{created_at}}'    },
    ]),
    body_text: `Dispatch Confirmed

DC: {{dc_number}}
From: {{from_location}}
To: {{to_location}}
Vehicle: {{vehicle_no}}
Driver: {{driver_name}}
Items: {{item_count}}
Dispatched: {{created_at}}

Automated by Unostar RFID Tracking Pool.`,
  },
  {
    event_key: 'dc_received',
    name:      'DC Received — Inbound Notification',
    subject:   'DC {{dc_number}} received at {{to_location}}',
    body_html: buildHtml({
      accent:       '#175CD3',
      accentBg:     '#EFF8FF',
      accentBorder: '#B2DDFF',
      badge:        'Receipt Confirmed',
      title:        'Materials Received',
      subtitle:     'Your delivery has been confirmed at the destination.',
      refLabel:     'Challan Number',
      refValue:     '{{dc_number}}',
    }, [
      { label: 'Received At', value: '{{to_location}}' },
      { label: 'Items',       value: '{{item_count}}'  },
      { label: 'Received',    value: '{{received_at}}' },
    ]),
    body_text: `Receipt Confirmed

DC: {{dc_number}}
Received at: {{to_location}}
Items: {{item_count}}
Received: {{received_at}}

Automated by Unostar RFID Tracking Pool.`,
  },
  {
    event_key: 'dc_returned',
    name:      'DC Returned — Return Notification',
    subject:   'Return recorded for DC {{dc_number}}',
    body_html: buildHtml({
      accent:       '#B54708',
      accentBg:     '#FFFAEB',
      accentBorder: '#FEDF89',
      badge:        'Return Recorded',
      title:        'Return Confirmed',
      subtitle:     'Empty containers have been received back at the origin.',
      refLabel:     'Challan Number',
      refValue:     '{{dc_number}}',
    }, [
      { label: 'Returned To', value: '{{to_location}}' },
      { label: 'Items',       value: '{{item_count}}'  },
      { label: 'Recorded',    value: '{{returned_at}}' },
    ]),
    body_text: `Return Recorded

DC: {{dc_number}}
Returned to: {{to_location}}
Items: {{item_count}}
Recorded: {{returned_at}}

Automated by Unostar RFID Tracking Pool.`,
  },
];

// ── Upsert ─────────────────────────────────────────────────────────────
async function run() {
  for (const t of templates) {
    await db.query(
      `INSERT INTO email_templates (event_key, name, subject, body_html, body_text, is_active)
       VALUES (?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name      = VALUES(name),
         subject   = VALUES(subject),
         body_html = VALUES(body_html),
         body_text = VALUES(body_text)`,
      [t.event_key, t.name, t.subject, t.body_html, t.body_text]
    );
    console.log(`✅ ${t.event_key}`);
  }
  console.log('\nAll 3 templates upserted.');
  process.exit(0);
}

run().catch((e) => { console.error('❌', e.message); process.exit(1); });