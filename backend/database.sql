-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create posts table
CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create schedules table
CREATE TABLE IF NOT EXISTS schedules (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  scheduled_time TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create social_accounts table
CREATE TABLE IF NOT EXISTS social_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  connected BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, platform)
);

-- Create facebook_pages table
CREATE TABLE IF NOT EXISTS facebook_pages (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id VARCHAR(255) NOT NULL,
  page_name VARCHAR(255) NOT NULL,
  page_access_token TEXT NOT NULL,
  profile_picture_url TEXT,
  followers_count INTEGER DEFAULT 0,
  is_selected BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, page_id)
);

-- Create scheduled_posts table with media support
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id VARCHAR(255),
  content TEXT NOT NULL,
  scheduled_time TIMESTAMP NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  media_url TEXT,
  facebook_post_id VARCHAR(255),
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create facebook_insights table
CREATE TABLE IF NOT EXISTS facebook_insights (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id VARCHAR(255) NOT NULL,
  metric_name VARCHAR(100) NOT NULL,
  metric_value FLOAT,
  insight_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(page_id, metric_name, insight_date)
);

-- Create instagram_accounts table
CREATE TABLE IF NOT EXISTS instagram_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instagram_id VARCHAR(255) NOT NULL,
  username VARCHAR(255) NOT NULL,
  profile_picture_url TEXT,
  bio TEXT,
  followers_count INTEGER DEFAULT 0,
  is_selected BOOLEAN DEFAULT FALSE,
  access_token TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, instagram_id)
);

-- Create instagram_media table
CREATE TABLE IF NOT EXISTS instagram_media (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instagram_id VARCHAR(255) NOT NULL,
  media_id VARCHAR(255) NOT NULL,
  caption TEXT,
  media_type VARCHAR(50),
  media_url TEXT,
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  created_time TIMESTAMP,
  fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(instagram_id, media_id)
);

-- Create twitter_accounts table
CREATE TABLE IF NOT EXISTS twitter_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  twitter_id VARCHAR(255) NOT NULL,
  username VARCHAR(255) NOT NULL,
  profile_picture_url TEXT,
  bio TEXT,
  followers_count INTEGER DEFAULT 0,
  is_selected BOOLEAN DEFAULT FALSE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, twitter_id)
);

-- Create twitter_tweets table
CREATE TABLE IF NOT EXISTS twitter_tweets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  twitter_id VARCHAR(255) NOT NULL,
  tweet_id VARCHAR(255) NOT NULL,
  text TEXT,
  likes_count INTEGER DEFAULT 0,
  retweets_count INTEGER DEFAULT 0,
  replies_count INTEGER DEFAULT 0,
  created_time TIMESTAMP,
  fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(twitter_id, tweet_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_user_id ON schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_social_accounts_user_id ON social_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_facebook_pages_user_id ON facebook_pages(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_user_id ON scheduled_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status ON scheduled_posts(status);
CREATE INDEX IF NOT EXISTS idx_facebook_insights_page_id ON facebook_insights(page_id);
CREATE INDEX IF NOT EXISTS idx_instagram_accounts_user_id ON instagram_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_instagram_media_instagram_id ON instagram_media(instagram_id);
CREATE INDEX IF NOT EXISTS idx_twitter_accounts_user_id ON twitter_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_twitter_tweets_twitter_id ON twitter_tweets(twitter_id);
