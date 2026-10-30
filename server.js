const express = require('express');
const cors = require('cors');
const assetRoutes = require('./routes/assetRoutes');
const scanRoutes = require('./routes/scanRoutes');
const locationRoutes = require('./routes/locationRoutes');

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/assets', assetRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api/locations', locationRoutes);

// Health Check
app.get('/health', (req, res) => res.status(200).send('Server is running.'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));