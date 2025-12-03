const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();
const PORT = 5000;

app.use(cors({
  origin: 'http://localhost:3000',
  methods: 'GET,POST,PUT,DELETE',
  credentials: true
}));

app.use(express.json());

try {
  const morgan = require('morgan');
  app.use(morgan('dev'));
} catch (e) {
  console.warn('morgan not available; request logging disabled');
}

const authRoutes = require('./routes/authRoutes');
const facebookRoutes = require('./routes/facebookRoutes');
const instagramRoutes = require('./routes/instagramRoutes');
const twitterRoutes = require('./routes/twitterRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/facebook', facebookRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api/twitter', twitterRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'API is working' });
});

app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users');
    res.json(result.rows);
  } catch (err) {
    console.error("DB Query Error:", err);
    res.status(500).json({ error: err.message || 'Database error' });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
