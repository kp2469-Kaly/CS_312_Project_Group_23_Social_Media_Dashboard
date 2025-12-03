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

// =============== TWITTER ACCOUNTS MANAGEMENT ===============

// Fetch Twitter account info
router.get('/accounts', verifyToken, async (req, res) => {
  try {
    const userAccount = await pool.query(
      'SELECT access_token FROM social_accounts WHERE user_id = $1 AND platform = $2',
      [req.userId, 'twitter']
    );

    if (userAccount.rows.length === 0) {
      return res.status(400).json({ error: 'Twitter account not connected' });
    }

    const accessToken = userAccount.rows[0].access_token;

    // Fetch Twitter user info from Twitter API v2
    const userResponse = await axios.get(
      `https://api.twitter.com/2/users/me`,
      {
        params: {
          'user.fields': 'id,name,username,description,profile_image_url,public_metrics'
        },
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const twitterUser = userResponse.data.data;

    // Store account in database
    await pool.query(
      `INSERT INTO twitter_accounts (user_id, twitter_id, username, bio, profile_picture_url, followers_count, access_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, twitter_id)
       DO UPDATE SET username = $3, bio = $4, profile_picture_url = $5, followers_count = $6, access_token = $7`,
      [
        req.userId,
        twitterUser.id,
        twitterUser.username,
        twitterUser.description || null,
        twitterUser.profile_image_url || null,
        twitterUser.public_metrics?.followers_count || 0,
        accessToken
      ]
    );

    // Return account from database
    const dbAccount = await pool.query(
      'SELECT * FROM twitter_accounts WHERE user_id = $1 AND twitter_id = $2',
      [req.userId, twitterUser.id]
    );

    res.json(dbAccount.rows[0] || twitterUser);

  } catch (error) {
    console.error('Fetch Twitter accounts error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch Twitter accounts' });
  }
});

// Select Twitter account as active
router.post('/accounts/select', verifyToken, async (req, res) => {
  const { twitterId } = req.body;

  if (!twitterId) {
    return res.status(400).json({ error: 'Twitter ID required' });
  }

  try {
    // Deselect all other accounts
    await pool.query(
      'UPDATE twitter_accounts SET is_selected = FALSE WHERE user_id = $1',
      [req.userId]
    );

    // Select the new account
    const result = await pool.query(
      'UPDATE twitter_accounts SET is_selected = TRUE WHERE user_id = $1 AND twitter_id = $2 RETURNING *',
      [req.userId, twitterId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Twitter account not found' });
    }

    res.json({ message: 'Twitter account selected', account: result.rows[0] });

  } catch (error) {
    console.error('Select Twitter account error:', error);
    res.status(500).json({ error: 'Failed to select account' });
  }
});

// Get selected Twitter account
router.get('/accounts/selected', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM twitter_accounts WHERE user_id = $1 AND is_selected = TRUE LIMIT 1',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.json(null);
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Get selected Twitter account error:', error);
    res.status(500).json({ error: 'Failed to get selected account' });
  }
});

// Disconnect Twitter account
router.post('/disconnect', verifyToken, async (req, res) => {
  try {
    // Delete Twitter accounts
    await pool.query(
      'DELETE FROM twitter_accounts WHERE user_id = $1',
      [req.userId]
    );

    // Delete Twitter tweets
    await pool.query(
      'DELETE FROM twitter_tweets WHERE user_id = $1',
      [req.userId]
    );

    // Delete account connection
    await pool.query(
      'DELETE FROM social_accounts WHERE user_id = $1 AND platform = $2',
      [req.userId, 'twitter']
    );

    res.json({ message: 'Twitter account disconnected' });

  } catch (error) {
    console.error('Disconnect Twitter error:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// =============== TWITTER TWEETS ===============

// Fetch tweets from selected account
router.get('/tweets', verifyToken, async (req, res) => {
  const { limit = 10 } = req.query;

  try {
    const selectedAccount = await pool.query(
      'SELECT * FROM twitter_accounts WHERE user_id = $1 AND is_selected = TRUE LIMIT 1',
      [req.userId]
    );

    if (selectedAccount.rows.length === 0) {
      return res.status(400).json({ error: 'No Twitter account selected' });
    }

    const account = selectedAccount.rows[0];

    const response = await axios.get(
      `https://api.twitter.com/2/users/${account.twitter_id}/tweets`,
      {
        params: {
          'max_results': limit,
          'tweet.fields': 'created_at,public_metrics'
        },
        headers: {
          Authorization: `Bearer ${account.access_token}`
        }
      }
    );

    // Store tweets in database
    for (const tweet of response.data.data || []) {
      await pool.query(
        `INSERT INTO twitter_tweets (user_id, twitter_id, tweet_id, text, likes_count, retweets_count, replies_count, created_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (twitter_id, tweet_id) DO UPDATE SET text = $4, likes_count = $5, retweets_count = $6, replies_count = $7`,
        [
          req.userId,
          account.twitter_id,
          tweet.id,
          tweet.text,
          tweet.public_metrics?.like_count || 0,
          tweet.public_metrics?.retweet_count || 0,
          tweet.public_metrics?.reply_count || 0,
          tweet.created_at || new Date().toISOString()
        ]
      );
    }

    res.json({
      tweets: response.data.data || [],
      meta: response.data.meta || {}
    });

  } catch (error) {
    console.error('Fetch tweets error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch tweets' });
  }
});

// Get stored tweets
router.get('/tweets/stored', verifyToken, async (req, res) => {
  const { limit = 20 } = req.query;

  try {
    const result = await pool.query(
      `SELECT * FROM twitter_tweets 
       WHERE user_id = $1 
       ORDER BY created_time DESC
       LIMIT $2`,
      [req.userId, limit]
    );

    res.json(result.rows);

  } catch (error) {
    console.error('Get stored tweets error:', error);
    res.status(500).json({ error: 'Failed to get tweets' });
  }
});

// Get Twitter account analytics
router.get('/analytics', verifyToken, async (req, res) => {
  try {
    const selectedAccount = await pool.query(
      'SELECT * FROM twitter_accounts WHERE user_id = $1 AND is_selected = TRUE LIMIT 1',
      [req.userId]
    );

    if (selectedAccount.rows.length === 0) {
      return res.status(400).json({ error: 'No Twitter account selected' });
    }

    const account = selectedAccount.rows[0];

    // Fetch user analytics from Twitter API v2
    const response = await axios.get(
      `https://api.twitter.com/2/users/${account.twitter_id}`,
      {
        params: {
          'user.fields': 'created_at,description,public_metrics,verified'
        },
        headers: {
          Authorization: `Bearer ${account.access_token}`
        }
      }
    );

    const user = response.data.data;

    res.json({
      followers: user.public_metrics?.followers_count || 0,
      following: user.public_metrics?.following_count || 0,
      tweets: user.public_metrics?.tweet_count || 0,
      verified: user.verified || false
    });

  } catch (error) {
    console.error('Fetch Twitter analytics error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// =============== TWITTER POSTING ===============

// Post tweet
router.post('/tweet', verifyToken, async (req, res) => {
  const { postId, text } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Tweet text required' });
  }

  if (text.length > 280) {
    return res.status(400).json({ error: 'Tweet must be 280 characters or less' });
  }

  try {
    const selectedAccount = await pool.query(
      'SELECT * FROM twitter_accounts WHERE user_id = $1 AND is_selected = TRUE LIMIT 1',
      [req.userId]
    );

    if (selectedAccount.rows.length === 0) {
      return res.status(400).json({ error: 'No Twitter account selected' });
    }

    const account = selectedAccount.rows[0];

    const response = await axios.post(
      `https://api.twitter.com/2/tweets`,
      { text: text },
      {
        headers: {
          Authorization: `Bearer ${account.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Update scheduled post if from scheduler
    if (postId) {
      await pool.query(
        'UPDATE scheduled_posts SET status = $1, facebook_post_id = $2, published_at = NOW() WHERE id = $3',
        ['published', response.data.data.id, postId]
      );
    }

    res.json({ message: 'Tweet posted successfully', tweetId: response.data.data.id });

  } catch (error) {
    console.error('Post tweet error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to post tweet' });
  }
});

module.exports = router;
