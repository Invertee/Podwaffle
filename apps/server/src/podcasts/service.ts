import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  DiscoveryResult,
  Episode,
  Podcast,
  QueueItem,
  Subscription,
} from "@podwaffle/contracts";
import { parseRss, type ParsedFeed } from "./rss.js";

interface PodcastRow {
  id: string;
  feed_url: string;
  apple_collection_id: string | null;
  title: string;
  author: string | null;
  description: string | null;
  artwork_url: string | null;
  website_url: string | null;
  last_checked_at: string | null;
  last_success_at: string | null;
}

interface EpisodeRow {
  id: string;
  podcast_id: string;
  podcast_title: string;
  title: string;
  description_html: string | null;
  enclosure_url: string | null;
  enclosure_type: string | null;
  published_at: string | null;
  first_discovered_at: string;
  duration_ms: number | null;
  artwork_url: string | null;
  episode_url: string | null;
  position_ms: number | null;
  played: number | null;
  played_at: string | null;
  manual_play_state: "none" | "played" | "unplayed" | null;
  last_played_at: string | null;
}

const episodeSelect = `
  SELECT e.*, p.title AS podcast_title, s.position_ms, s.played, s.played_at,
         s.manual_play_state, s.last_played_at
  FROM episodes e
  JOIN podcasts p ON p.id = e.podcast_id
  LEFT JOIN episode_state s ON s.episode_id = e.id AND s.profile_id = ?`;

function mapPodcast(row: PodcastRow): Podcast {
  return {
    id: row.id,
    feedUrl: row.feed_url,
    appleCollectionId: row.apple_collection_id,
    title: row.title,
    author: row.author,
    description: row.description,
    artworkUrl: row.artwork_url,
    websiteUrl: row.website_url,
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
  };
}

function mapEpisode(row: EpisodeRow): Episode {
  return {
    id: row.id,
    podcastId: row.podcast_id,
    podcastTitle: row.podcast_title,
    title: row.title,
    descriptionHtml: row.description_html,
    enclosureUrl: row.enclosure_url,
    enclosureType: row.enclosure_type,
    publishedAt: row.published_at,
    firstDiscoveredAt: row.first_discovered_at,
    durationMs: row.duration_ms,
    artworkUrl: row.artwork_url,
    episodeUrl: row.episode_url,
    positionMs: row.position_ms ?? 0,
    played: row.played === 1,
    playedAt: row.played_at,
    manualPlayState: row.manual_play_state ?? "none",
    lastPlayedAt: row.last_played_at,
  };
}

function completeOrder(
  currentIds: string[],
  requestedIds: string[],
  label: string,
): void {
  if (
    currentIds.length !== requestedIds.length ||
    new Set(requestedIds).size !== requestedIds.length ||
    currentIds.some((id) => !requestedIds.includes(id))
  ) {
    throw new Error(`${label} must contain every current item exactly once`);
  }
}

export async function searchApple(
  db: DatabaseSync,
  profileId: string,
  query: string,
  signal?: AbortSignal,
): Promise<DiscoveryResult[]> {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("media", "podcast");
  url.searchParams.set("entity", "podcast");
  url.searchParams.set("limit", "25");
  url.searchParams.set("term", query);
  const response = await fetch(url, signal ? { signal } : {});
  if (!response.ok) throw new Error(`Apple search failed (${response.status})`);
  const body = (await response.json()) as {
    results?: Array<{
      collectionId?: number;
      feedUrl?: string;
      collectionName?: string;
      artistName?: string;
      artworkUrl600?: string;
      primaryGenreName?: string;
    }>;
  };
  const subscribed = new Set(
    (
      db
        .prepare(
          `SELECT p.feed_url FROM subscriptions s JOIN podcasts p ON p.id = s.podcast_id
           WHERE s.profile_id = ?`,
        )
        .all(profileId) as unknown as Array<{ feed_url: string }>
    ).map((row) => row.feed_url),
  );
  return (body.results ?? []).flatMap((result) => {
    if (
      result.collectionId === undefined ||
      !result.feedUrl ||
      !result.collectionName
    )
      return [];
    return [
      {
        appleCollectionId: String(result.collectionId),
        feedUrl: result.feedUrl,
        title: result.collectionName,
        author: result.artistName ?? null,
        artworkUrl: result.artworkUrl600 ?? null,
        genre: result.primaryGenreName ?? null,
        subscribed: subscribed.has(result.feedUrl),
      },
    ];
  });
}

export async function downloadFeed(
  feedUrl: string,
  headers: Record<string, string> = {},
): Promise<{
  status: "updated" | "not-modified";
  feed?: ParsedFeed;
  etag: string | null;
  lastModified: string | null;
}> {
  const response = await fetch(feedUrl, {
    headers: {
      accept: "application/rss+xml, application/xml, text/xml",
      ...headers,
    },
    redirect: "follow",
  });
  if (response.status === 304)
    return {
      status: "not-modified",
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    };
  if (!response.ok) throw new Error(`Feed refresh failed (${response.status})`);
  const xml = await response.text();
  if (xml.length > 20 * 1024 * 1024) throw new Error("RSS feed is too large");
  return {
    status: "updated",
    feed: parseRss(xml),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
  };
}

export function upsertPodcastAndEpisodes(
  db: DatabaseSync,
  input: {
    feedUrl: string;
    appleCollectionId?: string;
    title?: string;
    author?: string;
    artworkUrl?: string;
  },
  downloaded: Awaited<ReturnType<typeof downloadFeed>>,
  refreshMinutes: number,
): { podcast: Podcast; discoveredEpisodeIds: string[] } {
  const now = new Date().toISOString();
  const nextCheck = new Date(
    Date.now() + refreshMinutes * 60 * 1000,
  ).toISOString();
  const existing = db
    .prepare("SELECT * FROM podcasts WHERE feed_url = ?")
    .get(input.feedUrl) as PodcastRow | undefined;
  const id = existing?.id ?? randomUUID();
  const feed = downloaded.feed;
  if (!existing) {
    db.prepare(
      `INSERT INTO podcasts(
        id, feed_url, apple_collection_id, title, author, description, artwork_url,
        website_url, etag, last_modified, last_checked_at, last_success_at,
        next_check_at, failure_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(
      id,
      input.feedUrl,
      input.appleCollectionId ?? null,
      feed?.title ?? input.title ?? input.feedUrl,
      feed?.author ?? input.author ?? null,
      feed?.description ?? null,
      feed?.artworkUrl ?? input.artworkUrl ?? null,
      feed?.websiteUrl ?? null,
      downloaded.etag,
      downloaded.lastModified,
      now,
      now,
      nextCheck,
      now,
      now,
    );
  } else {
    db.prepare(
      `UPDATE podcasts SET apple_collection_id = COALESCE(?, apple_collection_id),
       title = COALESCE(?, title), author = COALESCE(?, author),
       description = COALESCE(?, description), artwork_url = COALESCE(?, artwork_url),
       website_url = COALESCE(?, website_url), etag = COALESCE(?, etag),
       last_modified = COALESCE(?, last_modified), last_checked_at = ?,
       last_success_at = ?, next_check_at = ?, failure_count = 0, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.appleCollectionId ?? null,
      feed?.title ?? input.title ?? null,
      feed?.author ?? input.author ?? null,
      feed?.description ?? null,
      feed?.artworkUrl ?? input.artworkUrl ?? null,
      feed?.websiteUrl ?? null,
      downloaded.etag,
      downloaded.lastModified,
      now,
      now,
      nextCheck,
      now,
      id,
    );
  }
  const discoveredEpisodeIds: string[] = [];
  for (const episode of feed?.episodes ?? []) {
    const identity =
      episode.guid ??
      episode.enclosureUrl ??
      `${episode.title}\n${episode.publishedAt ?? ""}`;
    const stableGuid =
      episode.guid ??
      `podwaffle:${createHash("sha256").update(identity).digest("hex")}`;
    const found = db
      .prepare("SELECT id FROM episodes WHERE podcast_id = ? AND guid = ?")
      .get(id, stableGuid) as { id: string } | undefined;
    const episodeId = found?.id ?? randomUUID();
    if (!found) discoveredEpisodeIds.push(episodeId);
    db.prepare(
      `INSERT INTO episodes(
        id, podcast_id, guid, enclosure_url, enclosure_type, title,
        description_html, published_at, first_discovered_at, duration_ms,
        artwork_url, episode_url, explicit, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(podcast_id, guid) WHERE guid IS NOT NULL DO UPDATE SET
        enclosure_url=excluded.enclosure_url, enclosure_type=excluded.enclosure_type,
        title=excluded.title, description_html=excluded.description_html,
        published_at=excluded.published_at, duration_ms=excluded.duration_ms,
        artwork_url=excluded.artwork_url, episode_url=excluded.episode_url,
        explicit=excluded.explicit, removed_at=NULL, updated_at=excluded.updated_at`,
    ).run(
      episodeId,
      id,
      stableGuid,
      episode.enclosureUrl,
      episode.enclosureType,
      episode.title,
      episode.descriptionHtml,
      episode.publishedAt,
      now,
      episode.durationMs,
      episode.artworkUrl ?? feed?.artworkUrl ?? null,
      episode.episodeUrl,
      episode.explicit ? 1 : 0,
      now,
      now,
    );
  }
  return {
    podcast: mapPodcast(
      db
        .prepare("SELECT * FROM podcasts WHERE id = ?")
        .get(id) as unknown as PodcastRow,
    ),
    discoveredEpisodeIds,
  };
}

export function addSubscription(
  db: DatabaseSync,
  profileId: string,
  podcastId: string,
): void {
  const exists = db
    .prepare(
      "SELECT 1 FROM subscriptions WHERE profile_id = ? AND podcast_id = ?",
    )
    .get(profileId, podcastId);
  if (exists) return;
  const maximum = db
    .prepare(
      "SELECT COALESCE(MAX(sort_index), -1) AS value FROM subscriptions WHERE profile_id = ?",
    )
    .get(profileId) as { value: number };
  db.prepare(
    `INSERT INTO subscriptions(profile_id, podcast_id, sort_index, subscribed_at)
     VALUES (?, ?, ?, ?)`,
  ).run(profileId, podcastId, maximum.value + 1, new Date().toISOString());
}

export function listSubscriptions(
  db: DatabaseSync,
  profileId: string,
): Subscription[] {
  const rows = db
    .prepare(
      `SELECT p.*, s.sort_index, s.subscribed_at,
       EXISTS(
         SELECT 1 FROM episodes e
         LEFT JOIN episode_state es ON es.profile_id = s.profile_id AND es.episode_id = e.id
         WHERE e.podcast_id = p.id AND e.removed_at IS NULL
           AND e.first_discovered_at > s.subscribed_at
           AND e.first_discovered_at >= ?
           AND COALESCE(es.played, 0) = 0
       ) AS has_new_episode
       FROM subscriptions s JOIN podcasts p ON p.id = s.podcast_id
       WHERE s.profile_id = ? ORDER BY s.sort_index`,
    )
    .all(
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      profileId,
    ) as unknown as Array<
    PodcastRow & {
      sort_index: number;
      subscribed_at: string;
      has_new_episode: number;
    }
  >;
  return rows.map((row) => ({
    ...mapPodcast(row),
    sortIndex: row.sort_index,
    subscribedAt: row.subscribed_at,
    hasNewEpisode: row.has_new_episode === 1,
  }));
}

export function reorderSubscriptions(
  db: DatabaseSync,
  profileId: string,
  podcastIds: string[],
): void {
  const current = (
    db
      .prepare(
        "SELECT podcast_id FROM subscriptions WHERE profile_id = ? ORDER BY sort_index",
      )
      .all(profileId) as unknown as Array<{ podcast_id: string }>
  ).map((row) => row.podcast_id);
  completeOrder(current, podcastIds, "Podcast order");
  podcastIds.forEach((id, index) =>
    db
      .prepare(
        "UPDATE subscriptions SET sort_index = ? WHERE profile_id = ? AND podcast_id = ?",
      )
      .run(index, profileId, id),
  );
}

export function getPodcast(
  db: DatabaseSync,
  podcastId: string,
): Podcast | null {
  const row = db
    .prepare("SELECT * FROM podcasts WHERE id = ?")
    .get(podcastId) as PodcastRow | undefined;
  return row ? mapPodcast(row) : null;
}

export function listEpisodes(
  db: DatabaseSync,
  profileId: string,
  podcastId?: string,
): Episode[] {
  const rows = db
    .prepare(
      `${episodeSelect}
       WHERE e.removed_at IS NULL ${podcastId ? "AND e.podcast_id = ?" : ""}
       ORDER BY COALESCE(e.published_at, e.first_discovered_at) DESC`,
    )
    .all(
      ...(podcastId ? [profileId, podcastId] : [profileId]),
    ) as unknown as EpisodeRow[];
  return rows.map(mapEpisode);
}

export function getEpisode(
  db: DatabaseSync,
  profileId: string,
  episodeId: string,
): Episode | null {
  const row = db
    .prepare(`${episodeSelect} WHERE e.id = ?`)
    .get(profileId, episodeId) as EpisodeRow | undefined;
  return row ? mapEpisode(row) : null;
}

export function setEpisodeState(
  db: DatabaseSync,
  profileId: string,
  episodeId: string,
  played: boolean,
): Episode {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO episode_state(
      profile_id, episode_id, played, played_at, manual_play_state, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, episode_id) DO UPDATE SET
      played=excluded.played, played_at=excluded.played_at,
      manual_play_state=excluded.manual_play_state, updated_at=excluded.updated_at`,
  ).run(
    profileId,
    episodeId,
    played ? 1 : 0,
    played ? now : null,
    played ? "played" : "unplayed",
    now,
  );
  const episode = getEpisode(db, profileId, episodeId);
  if (!episode) throw new Error("Episode not found");
  return episode;
}

export function setEpisodeProgress(
  db: DatabaseSync,
  profileId: string,
  episodeId: string,
  positionMs: number,
  durationMs: number | null | undefined,
  forceComplete = false,
): Episode {
  const now = new Date().toISOString();
  const existing = getEpisode(db, profileId, episodeId);
  if (!existing) throw new Error("Episode not found");
  const effectiveDuration = durationMs ?? existing.durationMs;
  const complete =
    forceComplete ||
    (effectiveDuration !== null &&
      effectiveDuration > 0 &&
      positionMs / effectiveDuration >= 0.98 &&
      existing.manualPlayState !== "unplayed");
  db.prepare(
    `INSERT INTO episode_state(
      profile_id, episode_id, position_ms, duration_ms, played, played_at,
      manual_play_state, last_played_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'none', ?, ?)
    ON CONFLICT(profile_id, episode_id) DO UPDATE SET
      position_ms=excluded.position_ms, duration_ms=COALESCE(excluded.duration_ms, episode_state.duration_ms),
      played=CASE WHEN episode_state.manual_play_state='unplayed' THEN 0 ELSE excluded.played END,
      played_at=CASE WHEN episode_state.manual_play_state='unplayed' THEN NULL ELSE excluded.played_at END,
      last_played_at=excluded.last_played_at, updated_at=excluded.updated_at`,
  ).run(
    profileId,
    episodeId,
    positionMs,
    effectiveDuration,
    complete ? 1 : 0,
    complete ? now : null,
    now,
    now,
  );
  return getEpisode(db, profileId, episodeId)!;
}

export function listInProgress(db: DatabaseSync, profileId: string): Episode[] {
  return listEpisodes(db, profileId).filter(
    (episode) => episode.positionMs > 0 && !episode.played,
  );
}

export function listHistory(db: DatabaseSync, profileId: string): Episode[] {
  const rows = db
    .prepare(
      `${episodeSelect}
       WHERE s.last_played_at IS NOT NULL
       ORDER BY s.last_played_at DESC`,
    )
    .all(profileId) as unknown as EpisodeRow[];
  return rows.map(mapEpisode);
}

export function listQueue(db: DatabaseSync, profileId: string): QueueItem[] {
  const rows = db
    .prepare(
      `SELECT q.id AS queue_id, q.sort_index, q.added_at, episode_data.*
       FROM queue_items q
       JOIN (${episodeSelect}) AS episode_data ON episode_data.id = q.episode_id
       WHERE q.profile_id = ? ORDER BY q.sort_index`,
    )
    .all(profileId, profileId) as unknown as Array<
    EpisodeRow & { queue_id: string; sort_index: number; added_at: string }
  >;
  return rows.map((row) => ({
    id: row.queue_id,
    sortIndex: row.sort_index,
    addedAt: row.added_at,
    episode: mapEpisode(row),
  }));
}

export function addQueueItem(
  db: DatabaseSync,
  profileId: string,
  episodeId: string,
  position: "next" | "bottom",
): QueueItem[] {
  const episodeState = db
    .prepare(
      `SELECT played, played_at
       FROM episode_state WHERE profile_id = ? AND episode_id = ?`,
    )
    .get(profileId, episodeId) as
    { played: number; played_at: string | null } | undefined;
  const playedAtMs =
    episodeState?.played === 1 && episodeState.played_at
      ? Date.parse(episodeState.played_at)
      : Number.NaN;
  const existing = db
    .prepare(
      `SELECT id, added_at FROM queue_items
       WHERE profile_id = ? AND episode_id = ?`,
    )
    .get(profileId, episodeId) as { id: string; added_at: string } | undefined;
  if (existing) {
    const addedAtMs = Date.parse(existing.added_at);
    const staleCompletion =
      Number.isFinite(playedAtMs) &&
      Number.isFinite(addedAtMs) &&
      addedAtMs <= playedAtMs;
    if (!staleCompletion) return listQueue(db, profileId);
    db.prepare("DELETE FROM queue_items WHERE id = ?").run(existing.id);
    normalizeQueue(db, profileId);
  }

  const playing = db
    .prepare(
      `SELECT q.sort_index FROM playback_state p
       JOIN queue_items q ON q.profile_id = p.profile_id AND q.episode_id = p.episode_id
       WHERE p.profile_id = ?`,
    )
    .get(profileId) as { sort_index: number } | undefined;
  const target =
    position === "next"
      ? (playing?.sort_index ?? -1) + 1
      : (
          db
            .prepare(
              "SELECT COALESCE(MAX(sort_index), -1) + 1 AS value FROM queue_items WHERE profile_id = ?",
            )
            .get(profileId) as { value: number }
        ).value;
  if (position === "next") {
    db.prepare(
      "UPDATE queue_items SET sort_index = sort_index + 1 WHERE profile_id = ? AND sort_index >= ?",
    ).run(profileId, target);
  }
  const addedAtMs = Number.isFinite(playedAtMs)
    ? Math.max(Date.now(), playedAtMs + 1)
    : Date.now();
  db.prepare(
    "INSERT INTO queue_items(id, profile_id, episode_id, sort_index, added_at) VALUES (?, ?, ?, ?, ?)",
  ).run(
    randomUUID(),
    profileId,
    episodeId,
    target,
    new Date(addedAtMs).toISOString(),
  );
  return listQueue(db, profileId);
}

export function reorderQueue(
  db: DatabaseSync,
  profileId: string,
  queueItemIds: string[],
): QueueItem[] {
  const current = listQueue(db, profileId).map((item) => item.id);
  completeOrder(current, queueItemIds, "Queue order");
  queueItemIds.forEach((id, index) =>
    db
      .prepare(
        "UPDATE queue_items SET sort_index = ? WHERE profile_id = ? AND id = ?",
      )
      .run(index, profileId, id),
  );
  return listQueue(db, profileId);
}

export function normalizeQueue(
  db: DatabaseSync,
  profileId: string,
): QueueItem[] {
  const ids = listQueue(db, profileId).map((item) => item.id);
  ids.forEach((id, index) =>
    db
      .prepare("UPDATE queue_items SET sort_index = ? WHERE id = ?")
      .run(index, id),
  );
  return listQueue(db, profileId);
}

export function advanceQueueAfterCompletion(
  db: DatabaseSync,
  profileId: string,
  episodeId: string,
): QueueItem[] {
  const current = db
    .prepare(
      `SELECT id FROM queue_items
       WHERE profile_id = ? AND episode_id = ?`,
    )
    .get(profileId, episodeId) as { id: string } | undefined;
  if (current)
    db.prepare("DELETE FROM queue_items WHERE id = ?").run(current.id);
  const queue = current
    ? normalizeQueue(db, profileId)
    : listQueue(db, profileId);
  const nextEpisode = queue[0]?.episode ?? null;
  const playback = db
    .prepare("SELECT episode_id FROM playback_state WHERE profile_id = ?")
    .get(profileId) as { episode_id: string | null } | undefined;
  if (playback?.episode_id === episodeId) {
    db.prepare(
      `UPDATE playback_state SET episode_id = ?, position_ms = 0,
       duration_ms = ?, state = CASE WHEN ? IS NULL THEN 'stopped' ELSE state END,
       active_device_id = CASE WHEN ? IS NULL THEN NULL ELSE active_device_id END,
       lease_expires_at = CASE WHEN ? IS NULL THEN NULL ELSE lease_expires_at END,
       updated_at = ? WHERE profile_id = ?`,
    ).run(
      nextEpisode?.id ?? null,
      nextEpisode?.durationMs ?? null,
      nextEpisode?.id ?? null,
      nextEpisode?.id ?? null,
      nextEpisode?.id ?? null,
      new Date().toISOString(),
      profileId,
    );
  }
  return queue;
}
