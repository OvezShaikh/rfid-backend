// services/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false, // port 587 uses STARTTLS, not implicit TLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: 15000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
});

transporter.verify((err) => {
  if (err) {
    console.error('❌ SMTP verify failed:', err.message);
    console.error('   → Check SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env');
  } else {
    console.log(`✅ SMTP ready (${process.env.SMTP_HOST}:${process.env.SMTP_PORT})`);
  }
});

module.exports = { transporter };