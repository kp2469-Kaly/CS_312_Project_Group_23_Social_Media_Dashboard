const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const axios = require('axios');
const querystring = require('querystring');

require('dotenv').config();

const router = express.Router();

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING *',
      [name, email, hashedPassword]
    );

    console.log('User registered successfully:', newUser.rows[0].email);
    res.json({ message: 'User registered successfully', user: newUser.rows[0] });

  } catch (error) {
    console.error('Registration error:', error.message || error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    if (user.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.rows[0].password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId: user.rows[0].id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log('User logged in successfully:', user.rows[0].email);
    res.json({ message: 'Login successful', token });

  } catch (error) {
    console.error('Login error:', error.message || error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

function verifyToken(req, res, next) {
  const token = req.headers['authorization'];

  if (!token)
    return res.status(403).json({ error: 'Token required' });

  jwt.verify(token.replace("Bearer ", ""), process.env.JWT_SECRET, (err, decoded) => {
    if (err)
      return res.status(403).json({ error: 'Invalid token' });

    req.userId = decoded.userId;
    next();
  });
}

router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [req.userId]);
    res.json(user.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/post', verifyToken, async (req, res) => {
  const { content } = req.body;

  if (!content) return res.status(400).json({ error: 'Content required' });

  try {
    const newPost = await pool.query(
      'INSERT INTO posts (user_id, content) VALUES ($1, $2) RETURNING *',
      [req.userId, content]
    );

    res.json(newPost.rows[0]);
  } catch (err) {
    console.error('Post error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/posts', verifyToken, async (req, res) => {
  try {
    const posts = await pool.query(
      `SELECT posts.id, posts.content, posts.created_at, users.name 
       FROM posts 
       JOIN users ON posts.user_id = users.id
       WHERE posts.user_id = $1
       ORDER BY posts.created_at DESC`,
      [req.userId]
    );

    res.json(posts.rows);
  } catch (err) {
    console.error('Fetch posts error:', err);
    res.status(500).json({ error: 'Server error' });
router.post('/schedule', verifyToken, async (req, res) => {
  const { content, scheduled_time, mediaUrl = null } = req.body;

  if (!content || !scheduled_time)
    return res.status(400).json({ error: "Content and schedule time required" });

  try {
    const result = await pool.query(
      `INSERT INTO scheduled_posts (user_id, content, scheduled_time, media_url, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.userId, content, scheduled_time, mediaUrl, 'pending']
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Schedule Error:", err);
    res.status(500).json({ error: "Server error" });
router.get('/schedules', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM scheduled_posts
       WHERE user_id = $1
       ORDER BY scheduled_time ASC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch Schedules Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get('/analytics', verifyToken, async (req, res) => {
  const days = Number(req.query.days) || 7;

  try {
    const pagesRes = await pool.query(
      `SELECT page_id FROM facebook_pages WHERE user_id = $1`,
      [req.userId]
    );

    const pageIds = pagesRes.rows.map(r => r.page_id);

    if (pageIds.length === 0) {
      return res.json([]);
    }

    const aggRes = await pool.query(
      `SELECT insight_date::date AS date,
              SUM(CASE WHEN metric_name = 'page_fans' THEN metric_value ELSE 0 END) AS followers,
              SUM(CASE WHEN metric_name = 'page_post_engagements' THEN metric_value ELSE 0 END) AS engagement
       FROM facebook_insights
       WHERE user_id = $1
         AND page_id = ANY($2)
         AND insight_date >= (CURRENT_DATE - ($3::int - 1))
       GROUP BY insight_date
       ORDER BY insight_date ASC`,
      [req.userId, pageIds, days]
    );

    const analyticsData = aggRes.rows.map(r => ({
      day: r.date.toLocaleString('en-US', { month: 'short', day: 'numeric' }),
      date: r.date,
      followers: Number(r.followers) || 0,
      engagement: Number(r.engagement) || 0,
    }));

    res.json(analyticsData);
  } catch (err) {
    console.error('Analytics Error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/accounts', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT platform, connected FROM social_accounts WHERE user_id = $1`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// Create or update account connection status
router.post('/accounts', verifyToken, async (req, res) => {
  const { platform } = req.body;

  try {
    await pool.query(
      `INSERT INTO social_accounts (user_id, platform, connected)
       VALUES ($1, $2, TRUE)
       ON CONFLICT (user_id, platform)
       DO UPDATE SET connected = TRUE`,
      [req.userId, platform]
    );
    
    res.json({ message: `${platform} connected!` });
  } catch (err) {
    console.error("Account Connect Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get('/facebook/login', (req, res) => {
  const jwtToken = req.query.token;

  if (!jwtToken) return res.status(400).json({ error: "Missing user token" });

  const fbAuthUrl =
    "https://www.facebook.com/v18.0/dialog/oauth?" +
    querystring.stringify({
      client_id: process.env.FB_APP_ID,
      redirect_uri: process.env.FB_REDIRECT_URI,
      scope: "public_profile,email",
      response_type: "code",
      state: jwtToken // save token in OAuth state
    });

  res.redirect(fbAuthUrl);
});

router.get('/facebook/callback', async (req, res) => {
  const code = req.query.code;
  const stateToken = req.query.state;

  console.log('Facebook callback received query:', req.query);

  if (!code || !stateToken)
    return res.status(400).json({ error: "OAuth callback missing code/state" });

  let userId;
  try {
    const decoded = jwt.verify(stateToken, process.env.JWT_SECRET);
    userId = decoded.userId;
  } catch {
    return res.status(403).json({ error: "Invalid state token" });
  }

  try {
    const tokenResponse = await axios.get(
      `https://graph.facebook.com/v18.0/oauth/access_token?` +
      querystring.stringify({
        client_id: process.env.FB_APP_ID,
        client_secret: process.env.FB_APP_SECRET,
        redirect_uri: process.env.FB_REDIRECT_URI,
        code
      })
    );

    const access_token = tokenResponse.data.access_token;

    await pool.query(
      `INSERT INTO social_accounts (user_id, platform, access_token, connected)
       VALUES ($1, 'facebook', $2, TRUE)
       ON CONFLICT (user_id, platform)
       DO UPDATE SET access_token = $2, connected = TRUE`,
      [userId, access_token]
    );

    res.send(`
      <html>
        <head><title>Redirecting...</title></head>
        <body>
          <script>
            window.location.href = 'http://localhost:3000/accounts?connected=facebook';
          </script>
          Redirecting to SocialDash...
        </body>
      </html>
    `);

    } catch (err) {
    console.error("FB OAuth Error:", err.response?.data || err);
    const details = JSON.stringify(err.response?.data || err.message || err, null, 2);
    res.status(500).send(`
      <html>
        <head><title>Facebook Connect Failed</title></head>
        <body style="font-family: sans-serif; padding: 20px">
          <h2>Facebook connection failed</h2>
          <pre style="background:#f6f8fa;padding:10px;border-radius:6px;overflow:auto;max-height:300px">${details}</pre>
          <p><a href="http://localhost:3000/accounts">Return to SocialDash</a></p>
        </body>
      </html>
    `);
  }
});

router.get('/instagram/login', (req, res) => {
  const jwtToken = req.query.token;

  if (!jwtToken) return res.status(400).json({ error: "Missing user token" });

  const instagramAuthUrl =
    "https://api.instagram.com/oauth/authorize?" +
    querystring.stringify({
      client_id: process.env.INSTAGRAM_APP_ID,
      redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
      scope: "user_profile,user_media",
      response_type: "code",
      state: jwtToken
    });

  res.redirect(instagramAuthUrl);
});

router.get('/instagram/callback', async (req, res) => {
  const code = req.query.code;
  const stateToken = req.query.state;

  if (!code || !stateToken)
    return res.status(400).json({ error: "OAuth callback missing code/state" });

  let userId;
  try {
    const decoded = jwt.verify(stateToken, process.env.JWT_SECRET);
    userId = decoded.userId;
  } catch {
    return res.status(403).json({ error: "Invalid state token" });
  }

  console.log('Instagram callback received query:', req.query);

  try {
    const tokenResponse = await axios.post(
      `https://graph.instagram.com/access_token?` +
      querystring.stringify({
        client_id: process.env.INSTAGRAM_APP_ID,
        client_secret: process.env.INSTAGRAM_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
        code
      })
    );

    const access_token = tokenResponse.data.access_token;

    await pool.query(
      `INSERT INTO social_accounts (user_id, platform, access_token, connected)
       VALUES ($1, 'instagram', $2, TRUE)
       ON CONFLICT (user_id, platform)
       DO UPDATE SET access_token = $2, connected = TRUE`,
      [userId, access_token]
    );

    res.send(`
      <html>
        <head><title>Redirecting...</title></head>
        <body>
          <script>
            window.location.href = 'http://localhost:3000/accounts?connected=instagram';
          </script>
          Redirecting to SocialDash...
        </body>
      </html>
    `);

    } catch (err) {
    console.error("Instagram OAuth Error:", err.response?.data || err);
    const details = JSON.stringify(err.response?.data || err.message || err, null, 2);
    res.status(500).send(`
      <html>
        <head><title>Instagram Connect Failed</title></head>
        <body style="font-family: sans-serif; padding: 20px">
          <h2>Instagram connection failed</h2>
          <pre style="background:#f6f8fa;padding:10px;border-radius:6px;overflow:auto;max-height:300px">${details}</pre>
          <p><a href="http://localhost:3000/accounts">Return to SocialDash</a></p>
        </body>
      </html>
    `);
  }
});

router.get('/twitter/login', (req, res) => {
  const jwtToken = req.query.token;

  if (!jwtToken) return res.status(400).json({ error: "Missing user token" });

  const twitterAuthUrl =
    "https://twitter.com/i/oauth2/authorize?" +
    querystring.stringify({
      client_id: process.env.TWITTER_CLIENT_ID,
      redirect_uri: process.env.TWITTER_REDIRECT_URI,
      response_type: "code",
      scope: "tweet.read tweet.write users.read follows.read follows.write",
      state: jwtToken,
      code_challenge: "challenge",
      code_challenge_method: "plain"
    });

  res.redirect(twitterAuthUrl);
});

router.get('/twitter/callback', async (req, res) => {
  const code = req.query.code;
  const stateToken = req.query.state;

  if (!code || !stateToken)
    return res.status(400).json({ error: "OAuth callback missing code/state" });

  let userId;
  try {
    const decoded = jwt.verify(stateToken, process.env.JWT_SECRET);
    userId = decoded.userId;
  } catch {
    return res.status(403).json({ error: "Invalid state token" });
  }

  console.log('Twitter callback received query:', req.query);

  try {
    const tokenResponse = await axios.post(
      `https://api.twitter.com/2/oauth2/token`,
      querystring.stringify({
        code,
        grant_type: 'authorization_code',
        client_id: process.env.TWITTER_CLIENT_ID,
        redirect_uri: process.env.TWITTER_REDIRECT_URI,
        code_verifier: 'challenge'
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(
            `${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`
          ).toString('base64')}`
        }
      }
    );

    const access_token = tokenResponse.data.access_token;
    const refresh_token = tokenResponse.data.refresh_token;

    await pool.query(
      `INSERT INTO social_accounts (user_id, platform, access_token, refresh_token, connected)
       VALUES ($1, 'twitter', $2, $3, TRUE)
       ON CONFLICT (user_id, platform)
       DO UPDATE SET access_token = $2, refresh_token = $3, connected = TRUE`,
      [userId, access_token, refresh_token]
    );

    res.send(`
      <html>
        <head><title>Redirecting...</title></head>
        <body>
          <script>
            window.location.href = 'http://localhost:3000/accounts?connected=twitter';
          </script>
          Redirecting to SocialDash...
        </body>
      </html>
    `);

    } catch (err) {
    console.error("Twitter OAuth Error:", err.response?.data || err);
    const details = JSON.stringify(err.response?.data || err.message || err, null, 2);
    res.status(500).send(`
      <html>
        <head><title>Twitter Connect Failed</title></head>
        <body style="font-family: sans-serif; padding: 20px">
          <h2>Twitter connection failed</h2>
          <pre style="background:#f6f8fa;padding:10px;border-radius:6px;overflow:auto;max-height:300px">${details}</pre>
          <p><a href="http://localhost:3000/accounts">Return to SocialDash</a></p>
        </body>
      </html>
    `);
  }
});

module.exports = router;
