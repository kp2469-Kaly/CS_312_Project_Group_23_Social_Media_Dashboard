const express = require('express');
const axios = require('axios');
const pool = require('../db');

require('dotenv').config();

const router = express.Router();

// Middleware to verify token
function verifyToken(req, res, next) {
  const token = req.headers['authorization'];

  if (!token)
    return res.status(403).json({ error: 'Token required' });

  const jwt = require('jsonwebtoken');
  jwt.verify(token.replace("Bearer ", ""), process.env.JWT_SECRET, (err, decoded) => {
    if (err)
      return res.status(403).json({ error: 'Invalid token' });

    req.userId = decoded.userId;
    next();
  });
}

// =============== INSTAGRAM ACCOUNTS MANAGEMENT ===============

// Fetch list of Instagram accounts user manages
router.get('/accounts', verifyToken, async (req, res) => {
  try {
    const userAccount = await pool.query(
      'SELECT access_token FROM social_accounts WHERE user_id = $1 AND platform = $2',
      [req.userId, 'instagram']
    );

    if (userAccount.rows.length === 0) {
      return res.status(400).json({ error: 'Instagram account not connected' });
    }

    const accessToken = userAccount.rows[0].access_token;

    // Fetch Instagram user info from Facebook Graph API (Instagram Basic Display)
    const userResponse = await axios.get(
      `https://graph.instagram.com/me`,
      {
        params: {
          fields: 'id,username,name,biography,website,profile_picture_url,followers_count',
          access_token: accessToken
        }
      }
    );

    const igAccount = userResponse.data;

    // Store account in database
    await pool.query(
      `INSERT INTO instagram_accounts (user_id, instagram_id, username, profile_picture_url, bio, followers_count, access_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, instagram_id)
       DO UPDATE SET username = $3, profile_picture_url = $4, bio = $5, followers_count = $6, access_token = $7`,
      [
        req.userId,
        igAccount.id,
        igAccount.username,
        igAccount.profile_picture_url || null,
        igAccount.biography || null,
        igAccount.followers_count || 0,
        accessToken
      ]
    );

    // Return account from database
    const dbAccount = await pool.query(
      'SELECT * FROM instagram_accounts WHERE user_id = $1 AND instagram_id = $2',
      [req.userId, igAccount.id]
    );

    res.json(dbAccount.rows[0] || igAccount);

  } catch (error) {
    console.error('Fetch Instagram accounts error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch Instagram accounts' });
  }
});

// Select Instagram account as active
router.post('/accounts/select', verifyToken, async (req, res) => {
  const { instagramId } = req.body;

  if (!instagramId) {
    return res.status(400).json({ error: 'Instagram ID required' });
  }

  try {
    // Deselect all other accounts
    await pool.query(
      'UPDATE instagram_accounts SET is_selected = FALSE WHERE user_id = $1',
      [req.userId]
    );

    // Select the new account
    const result = await pool.query(
      'UPDATE instagram_accounts SET is_selected = TRUE WHERE user_id = $1 AND instagram_id = $2 RETURNING *',
      [req.userId, instagramId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Instagram account not found' });
    }

    res.json({ message: 'Instagram account selected', account: result.rows[0] });

  } catch (error) {
    console.error('Select Instagram account error:', error);
    res.status(500).json({ error: 'Failed to select account' });
  }
});

// Get selected Instagram account
router.get('/accounts/selected', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM instagram_accounts WHERE user_id = $1 AND is_selected = TRUE LIMIT 1',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.json(null);
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Get selected Instagram account error:', error);
    res.status(500).json({ error: 'Failed to get selected account' });
  }
});

// Disconnect Instagram account
router.post('/disconnect', verifyToken, async (req, res) => {
  try {
    // Delete Instagram accounts
    await pool.query(
      'DELETE FROM instagram_accounts WHERE user_id = $1',
      [req.userId]
    );

    // Delete Instagram media
    await pool.query(
      'DELETE FROM instagram_media WHERE user_id = $1',
      [req.userId]
    );

    // Delete account connection
    await pool.query(
      'DELETE FROM social_accounts WHERE user_id = $1 AND platform = $2',
      [req.userId, 'instagram']
    );

    res.json({ message: 'Instagram account disconnected' });

  } catch (error) {
    console.error('Disconnect Instagram error:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// =============== INSTAGRAM MEDIA ===============

// Fetch media from selected Instagram account
router.get('/media', verifyToken, async (req, res) => {
  const { limit = 10 } = req.query;

  try {
    const selectedAccount = await pool.query(
      'SELECT * FROM instagram_accounts WHERE user_id = $1 AND is_selected = TRUE LIMIT 1',
      [req.userId]
    );

    if (selectedAccount.rows.length === 0) {
      return res.status(400).json({ error: 'No Instagram account selected' });
    }

    const account = selectedAccount.rows[0];
    const url = `https://graph.instagram.com/${account.instagram_id}/media`;

    const response = await axios.get(url, {
      params: {
        fields: 'id,caption,media_type,media_url,timestamp,like_count,comments_count',
        access_token: account.access_token,
        limit: limit
      }
    });

    // Store media in database
    for (const media of response.data.data || []) {
      await pool.query(
        `INSERT INTO instagram_media (user_id, instagram_id, media_id, caption, media_type, media_url, likes_count, comments_count, created_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (instagram_id, media_id) DO UPDATE SET caption = $4, likes_count = $7, comments_count = $8`,
        [
          req.userId,
          account.instagram_id,
          media.id,
          media.caption || null,
          media.media_type,
          media.media_url || null,
          media.like_count || 0,
          media.comments_count || 0,
          media.timestamp || new Date().toISOString()
        ]
      );
    }

    res.json({
      media: response.data.data || [],
      paging: response.data.paging || {}
    });

  } catch (error) {
    console.error('Fetch Instagram media error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

// Get stored Instagram media
router.get('/media/stored', verifyToken, async (req, res) => {
  const { limit = 20 } = req.query;

  try {
    const result = await pool.query(
      `SELECT * FROM instagram_media 
       WHERE user_id = $1 
       ORDER BY created_time DESC
       LIMIT $2`,
      [req.userId, limit]
    );

    res.json(result.rows);

  } catch (error) {
    console.error('Get stored Instagram media error:', error);
    res.status(500).json({ error: 'Failed to get media' });
  }
});

// Get Instagram insights
router.get('/insights', verifyToken, async (req, res) => {
  try {
    const selectedAccount = await pool.query(
      'SELECT * FROM instagram_accounts WHERE user_id = $1 AND is_selected = TRUE LIMIT 1',
      [req.userId]
    );

    if (selectedAccount.rows.length === 0) {
      return res.status(400).json({ error: 'No Instagram account selected' });
    }

    const account = selectedAccount.rows[0];
    const url = `https://graph.instagram.com/${account.instagram_id}/insights`;

    const response = await axios.get(url, {
      params: {
        metric: 'impressions,reach,profile_views',
        period: 'day',
        access_token: account.access_token
      }
    });

    res.json(response.data.data || []);

  } catch (error) {
    console.error('Fetch Instagram insights error:', error.response?.data || error.message);
    // Instagram Business Account is required for insights - return empty array if not available
    res.json([]);
  }
});

// =============== INSTAGRAM POSTING ===============

// Publish photo to Instagram
router.post('/publish', verifyToken, async (req, res) => {
  const { postId, caption, imageUrl } = req.body;

  if (!imageUrl) {
    return res.status(400).json({ error: 'Image URL required' });
  }

  try {
    const selectedAccount = await pool.query(
      'SELECT * FROM instagram_accounts WHERE user_id = $1 AND is_selected = TRUE LIMIT 1',
      [req.userId]
    );

    if (selectedAccount.rows.length === 0) {
      return res.status(400).json({ error: 'No Instagram account selected' });
    }

    const account = selectedAccount.rows[0];

    // Instagram API requires using Instagram Graph API
    // Create a container first
    const containerResponse = await axios.post(
      `https://graph.instagram.com/${account.instagram_id}/media`,
      {
        image_url: imageUrl,
        caption: caption || '',
        access_token: account.access_token
      }
    );

    const containerId = containerResponse.data.id;

    // Publish the container
    const publishResponse = await axios.post(
      `https://graph.instagram.com/${account.instagram_id}/media_publish`,
      {
        creation_id: containerId,
        access_token: account.access_token
      }
    );

    // Update scheduled post if from scheduler
    if (postId) {
      await pool.query(
        'UPDATE scheduled_posts SET status = $1, facebook_post_id = $2, published_at = NOW() WHERE id = $3',
        ['published', publishResponse.data.id, postId]
      );
    }

    res.json({ message: 'Photo published to Instagram', mediaId: publishResponse.data.id });

  } catch (error) {
    console.error('Publish to Instagram error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to publish to Instagram' });
  }
});

module.exports = router;
