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

// =============== FACEBOOK PAGES MANAGEMENT ===============

// Fetch list of pages user manages
router.get('/pages', verifyToken, async (req, res) => {
  try {
    const userAccount = await pool.query(
      'SELECT access_token FROM social_accounts WHERE user_id = $1 AND platform = $2',
      [req.userId, 'facebook']
    );

    if (userAccount.rows.length === 0) {
      return res.status(400).json({ error: 'Facebook account not connected' });
    }

    const accessToken = userAccount.rows[0].access_token;

    // Fetch pages from Facebook Graph API
    const response = await axios.get(
      `https://graph.facebook.com/v18.0/me/accounts`,
      {
        params: {
          access_token: accessToken,
          fields: 'id,name,picture,followers_count'
        }
      }
    );

    const pages = response.data.data || [];

    // Store pages in database
    for (const page of pages) {
      await pool.query(
        `INSERT INTO facebook_pages (user_id, page_id, page_name, page_access_token, profile_picture_url, followers_count)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, page_id)
         DO UPDATE SET page_name = $3, page_access_token = $4, followers_count = $6`,
        [
          req.userId,
          page.id,
          page.name,
          page.access_token,
          page.picture?.data?.url || null,
          page.followers_count || 0
        ]
      );
    }

    // Return pages from database
    const dbPages = await pool.query(
      'SELECT * FROM facebook_pages WHERE user_id = $1 ORDER BY followers_count DESC',
      [req.userId]
    );

    res.json(dbPages.rows);

  } catch (error) {
    console.error('Fetch pages error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch pages' });
  }
});

// Select a page to manage
router.post('/pages/select', verifyToken, async (req, res) => {
  const { pageId } = req.body;

  if (!pageId) {
    return res.status(400).json({ error: 'Page ID required' });
  }

  try {
    // Deselect all other pages
    await pool.query(
      'UPDATE facebook_pages SET is_selected = FALSE WHERE user_id = $1',
      [req.userId]
    );

    // Select the new page
    const result = await pool.query(
      'UPDATE facebook_pages SET is_selected = TRUE WHERE user_id = $1 AND page_id = $2 RETURNING *',
      [req.userId, pageId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Page not found' });
    }

    res.json({ message: 'Page selected', page: result.rows[0] });

  } catch (error) {
    console.error('Select page error:', error);
    res.status(500).json({ error: 'Failed to select page' });
  }
});

// Get selected page
router.get('/pages/selected', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM facebook_pages WHERE user_id = $1 AND is_selected = TRUE LIMIT 1',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.json(null);
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Get selected page error:', error);
    res.status(500).json({ error: 'Failed to get selected page' });
  }
});

// Disconnect Facebook account and remove pages
router.post('/disconnect', verifyToken, async (req, res) => {
  try {
    // Delete pages
    await pool.query(
      'DELETE FROM facebook_pages WHERE user_id = $1',
      [req.userId]
    );

    // Delete account connection
    await pool.query(
      'DELETE FROM social_accounts WHERE user_id = $1 AND platform = $2',
      [req.userId, 'facebook']
    );

    res.json({ message: 'Facebook account disconnected' });

  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// =============== FACEBOOK POSTS ===============

// Fetch posts from selected page
router.get('/posts', verifyToken, async (req, res) => {
  const { limit = 10, after = null } = req.query;

  try {
    const selectedPage = await pool.query(
      'SELECT * FROM facebook_pages WHERE user_id = $1 AND is_selected = TRUE LIMIT 1',
      [req.userId]
    );

    if (selectedPage.rows.length === 0) {
      return res.status(400).json({ error: 'No page selected' });
    }

    const page = selectedPage.rows[0];
    let url = `https://graph.facebook.com/v18.0/${page.page_id}/posts`;
    
    const params = {
      access_token: page.page_access_token,
      fields: 'id,message,created_time,type,link,picture,story,full_picture,likes.summary(true),comments.summary(true)',
      limit: limit
    };

    if (after) {
      params.after = after;
    }

    const response = await axios.get(url, { params });

    res.json({
      posts: response.data.data || [],
      paging: response.data.paging || {}
    });

  } catch (error) {
    console.error('Fetch posts error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// =============== FACEBOOK INSIGHTS ===============

// Fetch page insights
router.get('/insights', verifyToken, async (req, res) => {
  const { startDate, endDate } = req.query;

  try {
    const selectedPage = await pool.query(
      'SELECT * FROM facebook_pages WHERE user_id = $1 AND is_selected = TRUE LIMIT 1',
      [req.userId]
    );

    if (selectedPage.rows.length === 0) {
      return res.status(400).json({ error: 'No page selected' });
    }

    const page = selectedPage.rows[0];
    const url = `https://graph.facebook.com/v18.0/${page.page_id}/insights`;

    const params = {
      access_token: page.page_access_token,
      metric: 'page_fans,page_engaged_users,page_post_engagements,page_impressions,page_views',
      period: 'day'
    };

    if (startDate && endDate) {
      params.since = Math.floor(new Date(startDate).getTime() / 1000);
      params.until = Math.floor(new Date(endDate).getTime() / 1000);
    }

    const response = await axios.get(url, { params });

    // Store insights in database
    for (const metric of response.data.data || []) {
      for (const value of metric.values || []) {
        await pool.query(
          `INSERT INTO facebook_insights (user_id, page_id, metric_name, metric_value, insight_date)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (page_id, metric_name, insight_date) DO NOTHING`,
          [
            req.userId,
            page.page_id,
            metric.name,
            value.value,
            new Date(value.end_time * 1000).toISOString().split('T')[0]
          ]
        );
      }
    }

    res.json(response.data.data || []);

  } catch (error) {
    console.error('Fetch insights error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch insights' });
  }
});

// Get stored insights for chart display
router.get('/insights/stored', verifyToken, async (req, res) => {
  const { metric = 'page_fans', days = 30 } = req.query;

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await pool.query(
      `SELECT insight_date, metric_value 
       FROM facebook_insights 
       WHERE user_id = $1 AND metric_name = $2 AND insight_date >= $3
       ORDER BY insight_date ASC`,
      [req.userId, metric, startDate.toISOString().split('T')[0]]
    );

    res.json(result.rows);

  } catch (error) {
    console.error('Get stored insights error:', error);
    res.status(500).json({ error: 'Failed to get insights' });
  }
});

// =============== FACEBOOK POSTING ===============

// Publish scheduled post to Facebook
router.post('/publish', verifyToken, async (req, res) => {
  const { postId } = req.body;

  try {
    const scheduledPost = await pool.query(
      'SELECT * FROM scheduled_posts WHERE id = $1 AND user_id = $2',
      [postId, req.userId]
    );

    if (scheduledPost.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const post = scheduledPost.rows[0];
    const selectedPage = await pool.query(
      'SELECT * FROM facebook_pages WHERE page_id = $1',
      [post.page_id]
    );

    if (selectedPage.rows.length === 0) {
      return res.status(400).json({ error: 'Page not found' });
    }

    const page = selectedPage.rows[0];
    const url = `https://graph.facebook.com/v18.0/${page.page_id}/feed`;

    const postData = {
      message: post.content,
      access_token: page.page_access_token
    };

    if (post.media_url) {
      postData.link = post.media_url;
    }

    const response = await axios.post(url, postData);

    // Update post status
    await pool.query(
      'UPDATE scheduled_posts SET status = $1, facebook_post_id = $2, published_at = NOW() WHERE id = $3',
      ['published', response.data.id, postId]
    );

    res.json({ message: 'Post published successfully', facebookPostId: response.data.id });

  } catch (error) {
    console.error('Publish post error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to publish post' });
  }
});

module.exports = router;
