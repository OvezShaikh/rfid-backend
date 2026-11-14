// controllers/emailController.js
const nodemailer = require('nodemailer');
const db = require('../config/db'); // Your MySQL connection

// Configure the transporter (e.g., for Brevo, Gmail, or standard SMTP)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp-relay.brevo.com', 
  port: process.env.SMTP_PORT || 587,
  auth: {
    user: process.env.SMTP_USER, // Your Brevo login
    pass: process.env.SMTP_PASS, // Your Brevo API Key or SMTP password
  },
});

// 1. Get saved recipients
exports.getSettings = async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT setting_value FROM settings WHERE setting_key = 'email_recipients'`);
    const recipients = rows.length ? JSON.parse(rows[0].setting_value) : [];
    res.json({ recipients });
  } catch (error) {
    console.error('DB Error in getSettings:', error); // ADD THIS
    res.status(500).json({ error: 'Failed to fetch settings', details: error.message });
  }
};

// 2. Save recipients
exports.saveSettings = async (req, res) => {
  const { recipients } = req.body;
  try {
    // Insert or Update the JSON array in the DB
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

// 3. Send the email
exports.sendReport = async (req, res) => {
  const { recipients } = req.body;

  if (!recipients || recipients.length === 0) {
    return res.status(400).json({ error: 'No recipients provided' });
  }

  try {
    // Email configuration
    const mailOptions = {
      from: `"${process.env.SMTP_FROM_NAME || 'RFID Tracking Pool'}" <${process.env.SMTP_FROM_EMAIL || 'info@unostar.in'}>`,
      to: recipients.join(', '), // Array of recipient emails
      subject: 'Daily Report: Last 24 Hours',
      text: 'Hello,\n\nPlease find attached the daily report for the last 24 hours.\n\nRegards,\nSystem Admin',
      // html: '<b>Hello</b>, please find the attached report.', // Optional HTML version
      // attachments: [
      //   {
      //     filename: 'report.xlsx',
      //     path: '/path/to/your/generated/report.xlsx' // You would generate this dynamically
      //   }
      // ]
    };

    // Send the email
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent: ', info.messageId);

    res.json({ success: true, message: 'Emails sent successfully!' });
  } catch (error) {
    console.error('Email error:', error);
    res.status(500).json({ error: 'Failed to send email', details: error.message });
  }
};