/* Broaden browser RSS parsing for real-world podcast feed variants. */
(function installRssParserRepair(root) {
  'use strict';

  const api = root && root.api;
  if (!api || api.__rssParserRepairInstalled) return;

  const originalParse = typeof api._parseExternalPodcastFeed === 'function'
    ? api._parseExternalPodcastFeed.bind(api)
    : null;

  function elementChildren(node) {
    return Array.from(node?.children || []);
  }

  function localName(node) {
    return String(node?.localName || node?.tagName || '').toLowerCase().replace(/^.*:/, '');
  }

  function findFirst(rootNode, names) {
    const wanted = new Set((names || []).map((name) => String(name).toLowerCase().replace(/^.*:/, '')));
    if (!rootNode || wanted.size === 0) return null;
    const nodes = [rootNode, ...Array.from(rootNode.getElementsByTagName?.('*') || [])];
    return nodes.find((node) => wanted.has(localName(node))) || null;
  }

  function findAll(rootNode, names) {
    const wanted = new Set((names || []).map((name) => String(name).toLowerCase().replace(/^.*:/, '')));
    if (!rootNode || wanted.size === 0) return [];
    return Array.from(rootNode.getElementsByTagName?.('*') || []).filter((node) => wanted.has(localName(node)));
  }

  function text(rootNode, names) {
    const node = findFirst(rootNode, names);
    return String(node?.textContent || '').trim();
  }

  function attr(node, names) {
    for (const name of names || []) {
      const value = node?.getAttribute?.(name);
      if (value) return String(value).trim();
    }
    return '';
  }

  function findAudioUrl(entry) {
    const candidates = findAll(entry, ['enclosure', 'content', 'link']);
    for (const node of candidates) {
      const rel = attr(node, ['rel']).toLowerCase();
      const type = attr(node, ['type']).toLowerCase();
      const url = attr(node, ['url', 'href', 'src']);
      if (!url) continue;
      if (localName(node) === 'enclosure') return url;
      if (rel === 'enclosure') return url;
      if (type.startsWith('audio/')) return url;
      if (/\.(mp3|m4a|aac|ogg|opus|wav)(?:$|[?#])/i.test(url)) return url;
    }
    return '';
  }

  function imageUrlFor(rootNode, fallback) {
    const imageNodes = findAll(rootNode, ['image', 'thumbnail']);
    for (const node of imageNodes) {
      const direct = attr(node, ['href', 'url', 'src']);
      if (direct) return direct;
      const nested = text(node, ['url']);
      if (nested) return nested;
    }
    return fallback || 'icons/icon-192.png';
  }

  function parseFeed(xmlText, seedPodcast = {}) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(String(xmlText || ''), 'text/xml');
    if (xml.querySelector('parsererror')) throw new Error('Podcast feed could not be parsed');

    const channel = findFirst(xml, ['channel', 'feed']) || xml.documentElement;
    const feedImage = imageUrlFor(channel, seedPodcast.imageUrl);
    const entries = findAll(channel, ['item', 'entry']);

    const episodes = entries.map((entry, index) => {
      const audioUrl = findAudioUrl(entry);
      if (!audioUrl) return null;
      const rawPublished = text(entry, ['pubDate', 'published', 'updated', 'date']);
      const parsedPublished = rawPublished ? new Date(rawPublished) : null;
      const publishedAt = parsedPublished && !Number.isNaN(parsedPublished.getTime())
        ? parsedPublished.toISOString()
        : new Date(0).toISOString();
      const guid = text(entry, ['guid', 'id']) || `${seedPodcast.feedId || 'podcast'}-episode-${index + 1}`;
      return {
        guid,
        title: text(entry, ['title']) || `Episode ${index + 1}`,
        description: text(entry, ['description', 'summary', 'encoded', 'content']) || '',
        audioUrl,
        imageUrl: imageUrlFor(entry, feedImage),
        podcastImageUrl: feedImage,
        podcastTitle: text(channel, ['title']) || seedPodcast.title || 'Podcast',
        feedId: seedPodcast.feedId,
        pubDate: publishedAt,
        publishedAt,
        duration: api._parseDurationSeconds?.(text(entry, ['duration'])) || 0,
      };
    }).filter(Boolean);

    return {
      ...seedPodcast,
      title: text(channel, ['title']) || seedPodcast.title || 'Podcast',
      author: text(channel, ['author', 'creator', 'managingEditor']) || seedPodcast.author || '',
      description: text(channel, ['description', 'summary', 'subtitle']) || seedPodcast.description || '',
      imageUrl: feedImage,
      episodes,
      totalEpisodes: episodes.length,
      episodeCount: episodes.length,
      hasRecentEpisode: episodes.length > 0,
      newEpisodesAvailable: false,
      lastRefreshed: new Date().toISOString(),
    };
  }

  api._parseExternalPodcastFeed = function parseExternalPodcastFeedRobust(xmlText, seedPodcast) {
    const parsed = parseFeed(xmlText, seedPodcast || {});
    if (parsed.episodes.length > 0 || !originalParse) return parsed;
    const legacy = originalParse(xmlText, seedPodcast || {});
    return Array.isArray(legacy?.episodes) && legacy.episodes.length > 0 ? legacy : parsed;
  };

  api.__rssParserRepairInstalled = true;
  api.__rssParserRepair = { parseFeed, findAudioUrl };
})(window);
