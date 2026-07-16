'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Parser = require('rss-parser');

const _dataRoot = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const PODCASTS_DIR = path.join(_dataRoot, 'podcasts');

// ---------------------------------------------------------------------------
// Directory bootstrap
// ---------------------------------------------------------------------------
(async () => {
  try {
    await fs.promises.mkdir(PODCASTS_DIR, { recursive: true });
    console.log(`[feedService] Podcasts directory ready: ${PODCASTS_DIR}`);
  } catch (err) {
    console.error('[feedService] Failed to create podcasts directory:', err);
  }
})();

// ---------------------------------------------------------------------------
// RSS Parser configuration
// ---------------------------------------------------------------------------
const parser = new Parser({
  customFields: {
    feed: [
      ['itunes:image', 'itunesImage'],
      ['itunes:author', 'itunesAuthor']
    ],
    item: [
      ['itunes:duration', 'itunesDuration'],
      ['itunes:episode', 'itunesEpisode'],
      ['itunes:image', 'itunesImage'],
      ['enclosure', 'enclosure']
    ]
  },
  timeout: 15000,
  headers: {
    'User-Agent': 'Podwaffle/1.0 (podcast client)'
  }
});

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Returns the MD5 hash of the feed URL, used as a stable feed identifier.
 */
function getFeedId(feedUrl) {
  return crypto.createHash('md5').update(feedUrl).digest('hex');
}

/**
 * Parse an itunes duration value (could be "HH:MM:SS", "MM:SS", or a bare number)
 * into integer seconds.
 */
function parseDuration(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Math.round(value);
  if (typeof value === 'string') {
    // Already a number string?
    if (/^\d+$/.test(value.trim())) {
      return parseInt(value.trim(), 10);
    }
    const parts = value.trim().split(':').map(Number);
    if (parts.length === 3) {
      // HH:MM:SS
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      // MM:SS
      return parts[0] * 60 + parts[1];
    }
  }
  return 0;
}

/**
 * Extract image URL from various possible itunes image shapes.
 */
function extractItunesImageUrl(itunesImage) {
  if (!itunesImage) return null;
  if (typeof itunesImage === 'string') return itunesImage;
  if (typeof itunesImage === 'object') {
    return itunesImage.href || itunesImage['$'] && itunesImage['$'].href || null;
  }
  return null;
}

/**
 * Build the canonical file path for a cached feed.
 */
function feedFilePath(feedId) {
  return path.join(PODCASTS_DIR, `${feedId}.json`);
}

// ---------------------------------------------------------------------------
// Core I/O
// ---------------------------------------------------------------------------

/**
 * Read a cached feed from disk by feedId. Returns null if not found.
 */
async function getCachedFeed(feedId) {
  const filePath = feedFilePath(feedId);
  console.log(`[feedService] getCachedFeed(${feedId}) → ${filePath}`);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const feed = JSON.parse(raw);
    console.log(`[feedService] getCachedFeed(${feedId}) → loaded "${feed.title}" (${feed.episodes.length} episodes)`);
    return feed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`[feedService] getCachedFeed(${feedId}) → not cached yet`);
    } else {
      console.error(`[feedService] getCachedFeed(${feedId}) → read error:`, err);
    }
    return null;
  }
}

/**
 * Helper: get feedId from URL then read cache.
 */
async function getCachedFeedByUrl(feedUrl) {
  const feedId = getFeedId(feedUrl);
  return getCachedFeed(feedId);
}

async function getCachedFeedsByUrls(feedUrls) {
  const feeds = await Promise.all((Array.isArray(feedUrls) ? feedUrls : []).map(getCachedFeedByUrl));
  return feeds.filter(Boolean);
}

/**
 * Write a feed object to disk.
 */
async function saveFeed(feedData) {
  const filePath = feedFilePath(feedData.feedId);
  console.log(`[feedService] saveFeed(${feedData.feedId}) → writing to ${filePath}`);
  try {
    await fs.promises.writeFile(filePath, JSON.stringify(feedData, null, 2), 'utf8');
    console.log(`[feedService] saveFeed(${feedData.feedId}) → saved OK`);
  } catch (err) {
    console.error(`[feedService] saveFeed(${feedData.feedId}) → write error:`, err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Feed fetching & caching
// ---------------------------------------------------------------------------

/**
 * Fetch the RSS feed at feedUrl, parse it, compare to any existing cache to
 * mark genuinely new episodes (isNew=true), and save the result.
 *
 * Returns the updated feed cache object.
 */
async function fetchAndCacheFeed(feedUrl) {
  console.log(`[feedService] fetchAndCacheFeed() → fetching: ${feedUrl}`);
  const feedId = getFeedId(feedUrl);

  let parsed;
  try {
    parsed = await parser.parseURL(feedUrl);
    console.log(`[feedService] fetchAndCacheFeed(${feedId}) → parsed feed: "${parsed.title}", ${(parsed.items || []).length} items`);
  } catch (err) {
    console.error(`[feedService] fetchAndCacheFeed(${feedId}) → parse error:`, err.message);
    throw new Error(`Failed to fetch/parse feed at ${feedUrl}: ${err.message}`);
  }

  // Read existing cache to detect new episodes
  const existing = await getCachedFeed(feedId);
  const existingGuids = new Set();
  const existingPubDates = {};
  if (existing && existing.episodes) {
    for (const ep of existing.episodes) {
      existingGuids.add(ep.guid);
      existingPubDates[ep.guid] = ep.pubDate;
    }
    console.log(`[feedService] fetchAndCacheFeed(${feedId}) → existing cache has ${existingGuids.size} episodes`);
  } else {
    console.log(`[feedService] fetchAndCacheFeed(${feedId}) → no existing cache, treating all episodes as existing`);
  }

  let newEpisodesAvailable = false;
  const newGuids = [];

  const episodes = (parsed.items || []).map((item, index) => {
    // Determine the episode GUID (fall back to link or title+pubDate hash)
    const rawGuid = item.guid || item.id || item.link ||
      crypto.createHash('md5').update((item.title || '') + (item.pubDate || '')).digest('hex');

    // Determine if this is genuinely new (only if we already had a cache)
    let isNew = false;
    if (existing) {
      if (!existingGuids.has(rawGuid)) {
        isNew = true;
        newEpisodesAvailable = true;
        newGuids.push(rawGuid);
        console.log(`[feedService] fetchAndCacheFeed(${feedId}) → NEW episode detected: "${item.title}"`);
      }
    }

    // Resolve audio URL from enclosure or a direct link
    let audioUrl = '';
    if (item.enclosure && item.enclosure.url) {
      audioUrl = item.enclosure.url;
    } else if (item.enclosure && typeof item.enclosure === 'string') {
      audioUrl = item.enclosure;
    } else if (item.link) {
      audioUrl = item.link;
    }

    // Resolve episode image
    const episodeImageUrl =
      extractItunesImageUrl(item.itunesImage) ||
      (item.itunes && item.itunes.image) ||
      null;

    // Parse duration
    const durationRaw = item.itunesDuration || (item.itunes && item.itunes.duration) || 0;
    const duration = parseDuration(durationRaw);

    // Episode number
    const episodeNumber = item.itunesEpisode
      ? parseInt(item.itunesEpisode, 10)
      : (item.itunes && item.itunes.episode ? parseInt(item.itunes.episode, 10) : null);

    // Parse pubDate to ISO
    let pubDate = null;
    if (item.pubDate) {
      try {
        pubDate = new Date(item.pubDate).toISOString();
      } catch (_) {
        pubDate = item.pubDate;
      }
    } else if (item.isoDate) {
      pubDate = item.isoDate;
    }

    return {
      guid: rawGuid,
      title: item.title || `Episode ${index + 1}`,
      description: item.content || item.contentSnippet || item['content:encoded'] || item.summary || '',
      pubDate,
      duration,
      audioUrl,
      imageUrl: episodeImageUrl,
      episodeNumber: isNaN(episodeNumber) ? null : episodeNumber,
      isNew
    };
  });

  // Resolve feed-level image
  const feedImageUrl =
    extractItunesImageUrl(parsed.itunesImage) ||
    (parsed.itunes && parsed.itunes.image) ||
    parsed.image && parsed.image.url ||
    null;

  const feedData = {
    feedUrl,
    feedId,
    title: parsed.title || 'Unknown Podcast',
    description: parsed.description || parsed.subtitle || '',
    imageUrl: feedImageUrl,
    author: parsed.itunesAuthor || (parsed.itunes && parsed.itunes.author) || parsed.author || '',
    link: parsed.link || feedUrl,
    lastRefreshed: new Date().toISOString(),
    newEpisodesAvailable,
    episodes
  };

  await saveFeed(feedData);
  console.log(`[feedService] fetchAndCacheFeed(${feedId}) → cached ${episodes.length} episodes, ${newGuids.length} new`);
  return feedData;
}

// ---------------------------------------------------------------------------
// Episode access
// ---------------------------------------------------------------------------

/**
 * Return a paginated slice of episodes from a cached feed.
 */
async function getEpisodes(feedId, limit = 100, offset = 0) {
  console.log(`[feedService] getEpisodes(${feedId}, limit=${limit}, offset=${offset})`);
  const feed = await getCachedFeed(feedId);
  if (!feed) {
    console.warn(`[feedService] getEpisodes(${feedId}) → not cached`);
    return [];
  }
  const slice = (feed.episodes || []).slice(offset, offset + limit);
  console.log(`[feedService] getEpisodes(${feedId}) → returning ${slice.length} of ${feed.episodes.length}`);
  return slice;
}

// ---------------------------------------------------------------------------
// Batch refresh
// ---------------------------------------------------------------------------

/**
 * Refresh all feeds subscribed to by any user.
 *
 * @param {Function} getUserGuids - async () => string[]
 * @param {Function} getSubscriptions - async (guid) => string[]
 * @returns {Object} Summary { total, succeeded, failed, newEpisodesFeeds }
 */
async function refreshAllSubscribedFeeds(getUserGuids, getSubscriptions) {
  console.log('[feedService] refreshAllSubscribedFeeds() → starting...');

  let guids;
  try {
    guids = await getUserGuids();
  } catch (err) {
    console.error('[feedService] refreshAllSubscribedFeeds() → failed to get user guids:', err);
    return { total: 0, succeeded: 0, failed: 0, newEpisodesFeeds: [] };
  }

  // Collect all unique feed URLs across all users
  const urlSet = new Set();
  for (const guid of guids) {
    try {
      const subs = await getSubscriptions(guid);
      for (const url of subs) urlSet.add(url);
    } catch (err) {
      console.error(`[feedService] refreshAllSubscribedFeeds() → error getting subs for ${guid}:`, err);
    }
  }

  const feedUrls = Array.from(urlSet);
  console.log(`[feedService] refreshAllSubscribedFeeds() → ${feedUrls.length} unique feeds to refresh`);

  const summary = { total: feedUrls.length, succeeded: 0, failed: 0, newEpisodesFeeds: [] };

  for (let i = 0; i < feedUrls.length; i++) {
    const url = feedUrls[i];
    console.log(`[feedService] refreshAllSubscribedFeeds() → [${i + 1}/${feedUrls.length}] refreshing ${url}`);
    try {
      const result = await fetchAndCacheFeed(url);
      summary.succeeded++;
      if (result.newEpisodesAvailable) {
        summary.newEpisodesFeeds.push(result.feedId);
        console.log(`[feedService] refreshAllSubscribedFeeds() → feed ${result.feedId} has new episodes`);
      }
    } catch (err) {
      console.error(`[feedService] refreshAllSubscribedFeeds() → failed for ${url}:`, err.message);
      summary.failed++;
    }

    // Be polite — wait 2 seconds between feed fetches (skip delay after last one)
    if (i < feedUrls.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log(`[feedService] refreshAllSubscribedFeeds() → done. succeeded=${summary.succeeded}, failed=${summary.failed}, newFeeds=${summary.newEpisodesFeeds.length}`);
  return summary;
}

// ---------------------------------------------------------------------------
// New-episode flag helpers
// ---------------------------------------------------------------------------

/**
 * Set isNew=true on the specified episodes within a cached feed.
 */
async function markEpisodesNew(feedId, newGuids) {
  console.log(`[feedService] markEpisodesNew(${feedId}, count=${newGuids.length})`);
  const feed = await getCachedFeed(feedId);
  if (!feed) {
    console.warn(`[feedService] markEpisodesNew(${feedId}) → feed not in cache`);
    return;
  }
  const guidSet = new Set(newGuids);
  let marked = 0;
  for (const ep of feed.episodes) {
    if (guidSet.has(ep.guid)) {
      ep.isNew = true;
      marked++;
    }
  }
  feed.newEpisodesAvailable = marked > 0;
  await saveFeed(feed);
  console.log(`[feedService] markEpisodesNew(${feedId}) → marked ${marked} episodes as new`);
}

/**
 * Clear the newEpisodesAvailable flag on a feed (user has seen the new episodes).
 */
async function clearNewFlag(feedId) {
  console.log(`[feedService] clearNewFlag(${feedId})`);
  const feed = await getCachedFeed(feedId);
  if (!feed) {
    console.warn(`[feedService] clearNewFlag(${feedId}) → feed not in cache`);
    return;
  }
  feed.newEpisodesAvailable = false;
  for (const ep of feed.episodes) {
    ep.isNew = false;
  }
  await saveFeed(feed);
  console.log(`[feedService] clearNewFlag(${feedId}) → flag cleared`);
}

/**
 * Returns true when a feed contains at least one episode published within the
 * last `hours` hours.
 */
function hasRecentEpisode(feed, hours = 12) {
  if (!feed || !Array.isArray(feed.episodes) || hours <= 0) return false;

  const cutoff = Date.now() - (hours * 60 * 60 * 1000);
  return feed.episodes.some((episode) => {
    if (!episode || !episode.pubDate) return false;
    const publishedAt = new Date(episode.pubDate).getTime();
    return Number.isFinite(publishedAt) && publishedAt >= cutoff && publishedAt <= Date.now();
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  getFeedId,
  fetchAndCacheFeed,
  getCachedFeed,
  getCachedFeedByUrl,
  getCachedFeedsByUrls,
  getEpisodes,
  refreshAllSubscribedFeeds,
  markEpisodesNew,
  clearNewFlag,
  hasRecentEpisode
};
