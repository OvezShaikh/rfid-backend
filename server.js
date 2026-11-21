const express = require('express');
const cors = require('cors');
const assetRoutes = require('./routes/assetRoutes');
const scanRoutes = require('./routes/scanRoutes');
const locationRoutes = require('./routes/locationRoutes');
const containerRoutes = require('./routes/containerRoutes');
const challanRoutes = require('./routes/challanRoutes');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const { verifyToken, requireRole } = require('./middleware/authMiddleware');
const reportRoutes = require('./routes/reportRoutes');
const whatsappController = require('./controllers/whatsappController');
const whatsappWebhookController = require('./controllers/whatsappWebhookController');
const deviceRoutes = require('./routes/deviceRoutes');
const clientRoutes = require('./routes/clientRoutes');
const emailRoutes = require('./routes/emailRoutes');
const reportScheduleRoutes = require('./routes/reportScheduleRoutes');


const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes); 

// Apply verifyToken to ALL routes below this line
app.use('/api/assets', verifyToken, assetRoutes);
app.use('/api/containers', verifyToken, containerRoutes);
app.use('/api/locations', verifyToken, locationRoutes);
app.use('/api/challans', verifyToken, challanRoutes);
app.use('/api/scan', verifyToken, scanRoutes);

// Config routes
const configController = require('./controllers/configController');
app.get('/api/configs/vehicles', verifyToken, requireRole([1, 2]), configController.getVehicleConfigs);
app.post('/api/configs/vehicles', verifyToken, requireRole([1]), configController.createVehicleConfig);

// Health Check
app.get('/health', (req, res) => res.status(200).send('Server is running.'));

// Report routes
app.use('/api/reports', reportRoutes);

// WhatsApp Simulation route
app.post('/api/whatsapp/simulate', verifyToken, requireRole([1, 2]), whatsappController.simulateChat);

// The Real WhatsApp Bot (Meta)
app.get('/api/whatsapp/webhook', whatsappWebhookController.verifyWebhook); // ADD THIS
app.post('/api/whatsapp/webhook', whatsappWebhookController.handleWebhook); // ADD THIS

// Device routes
app.use('/api/devices', verifyToken, deviceRoutes);

// Client routes
app.use('/api/clients', clientRoutes);

// Email routes
app.use('/api', verifyToken, emailRoutes);

// Report Schedule routes
app.use('/api/report-schedule', verifyToken, reportScheduleRoutes);

const PORT = process.env.PORT || 5000;
const { startScheduler } = require('./services/reportScheduler');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters before starting the API.');
}
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => {
  console.error('Unhandled request error:', err);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
  startScheduler();
});