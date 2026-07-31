import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DiscoveryResult,
  Episode,
  Session,
  Subscription,
} from "@podwaffle/contracts";
import { api } from "../api/client";
import { useProfileSync } from "../api/use-profile-sync";
import { useSyncStore } from "../stores/sync";
import { player } from "../player/local-player";
import { PlayerBar } from "../player/PlayerBar";
import { Icon, type IconName } from "./Icon";

type Page = "library" | "discover" | "progress" | "history" | "profile";

function EpisodeList({
  episodes,
  revision,
  busy,
  onPlayed,
  onQueue,
  onPlay,
}: {
  episodes: Episode[];
  revision: number;
  busy: boolean;
  onPlayed: (episode: Episode) => void;
  onQueue: (episodeId: string, position: "next" | "bottom") => void;
  onPlay: (episode: Episode) => void;
}) {
  if (episodes.length === 0)
    return <p className="empty">There are no episodes here yet.</p>;
  return (
    <div className="episode-list" data-revision={revision}>
      {episodes.map((episode) => (
        <article
          className={`episode ${episode.played ? "played" : ""}`}
          key={episode.id}
        >
          <div className="episode-copy">
            <p className="eyebrow">{episode.podcastTitle}</p>
            <h3>{episode.title}</h3>
            <p>
              {episode.publishedAt
                ? new Date(episode.publishedAt).toLocaleDateString()
                : "Publication date unavailable"}
              {episode.durationMs
                ? ` · ${Math.round(episode.durationMs / 60_000)} min`
                : ""}
              {episode.positionMs > 0
                ? ` · ${Math.round(episode.positionMs / 60_000)} min played`
                : ""}
            </p>
          </div>
          <div className="row-actions">
            <button
              className="icon-button"
              aria-label={`Play ${episode.title}`}
              title="Play episode"
              disabled={!episode.enclosureUrl}
              onClick={() => onPlay(episode)}
            >
              <Icon name="play" />
            </button>
            <button
              className="icon-button"
              aria-label={`Add ${episode.title} to play next`}
              title="Add to play next"
              disabled={busy}
              onClick={() => onQueue(episode.id, "next")}
            >
              <Icon name="queueNext" />
            </button>
            <button
              className="icon-button"
              aria-label={`Add ${episode.title} to the bottom of the queue`}
              title="Add to queue"
              disabled={busy}
              onClick={() => onQueue(episode.id, "bottom")}
            >
              <Icon name="queue" />
            </button>
            <button
              className={`icon-button played-toggle ${episode.played ? "active" : ""}`}
              aria-label={`Mark ${episode.title} ${episode.played ? "unplayed" : "played"}`}
              title={`Mark ${episode.played ? "unplayed" : "played"}`}
              disabled={busy}
              onClick={() => onPlayed(episode)}
            >
              <Icon name="check" />
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

export function Dashboard({ session }: { session: Session }) {
  const queryClient = useQueryClient();
  useProfileSync(true);
  const connected = useSyncStore((state) => state.connected);
  const snapshot = useSyncStore((state) => state.snapshot);
  useEffect(
    () => player.applySharedPlayback(snapshot?.playback ?? null),
    [snapshot?.playback],
  );
  const revision = snapshot?.revision ?? session.profile.revision;
  const [page, setPage] = useState<Page>("library");
  const [layout, setLayout] = useState<"tiles" | "list">(() =>
    localStorage.getItem(`podwaffle-layout:${session.profile.id}`) === "list"
      ? "list"
      : "tiles",
  );
  const [selectedPodcast, setSelectedPodcast] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [queueOpen, setQueueOpen] = useState(false);
  const [draggedPodcast, setDraggedPodcast] = useState<string | null>(null);
  const [draggedQueue, setDraggedQueue] = useState<string | null>(null);
  const [statsPeriod, setStatsPeriod] = useState<
    "today" | "7d" | "30d" | "year" | "all"
  >("30d");
  const skipSettingsKey = `podwaffle-skip-settings:${session.profile.id}`;
  const [skipBackwardSeconds, setSkipBackwardSeconds] = useState(() =>
    skipSetting(skipSettingsKey, "backward", 15),
  );
  const [skipForwardSeconds, setSkipForwardSeconds] = useState(() =>
    skipSetting(skipSettingsKey, "forward", 30),
  );
  useEffect(() => {
    player.setSkipDurations(skipBackwardSeconds, skipForwardSeconds);
    localStorage.setItem(
      skipSettingsKey,
      JSON.stringify({
        backward: skipBackwardSeconds,
        forward: skipForwardSeconds,
      }),
    );
  }, [skipBackwardSeconds, skipForwardSeconds, skipSettingsKey]);

  const subscriptions = useQuery({
    queryKey: ["subscriptions"],
    queryFn: api.subscriptions,
  });
  const episodes = useQuery({
    queryKey: ["episodes", selectedPodcast],
    queryFn: () => api.episodes(selectedPodcast!),
    enabled: selectedPodcast !== null,
  });
  const inProgress = useQuery({
    queryKey: ["in-progress"],
    queryFn: api.inProgress,
    enabled: page === "progress",
  });
  const history = useQuery({
    queryKey: ["history"],
    queryFn: api.history,
    enabled: page === "history",
  });
  const discovery = useQuery({
    queryKey: ["discovery", submittedQuery],
    queryFn: () => api.search(submittedQuery),
    enabled: submittedQuery.length >= 2,
  });
  const queue = useQuery({
    queryKey: ["queue"],
    queryFn: api.queue,
  });
  useEffect(
    () =>
      player.subscribeQueue((nextQueue) =>
        queryClient.setQueryData(["queue"], nextQueue),
      ),
    [queryClient],
  );
  const devices = useQuery({
    queryKey: ["devices"],
    queryFn: api.devices,
    enabled: page === "profile",
  });
  const stats = useQuery({
    queryKey: ["stats", statsPeriod],
    queryFn: () => api.stats(statsPeriod),
    enabled: page === "profile",
  });

  const refreshProfileData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
      queryClient.invalidateQueries({ queryKey: ["episodes"] }),
      queryClient.invalidateQueries({ queryKey: ["in-progress"] }),
      queryClient.invalidateQueries({ queryKey: ["history"] }),
      queryClient.invalidateQueries({ queryKey: ["queue"] }),
      queryClient.invalidateQueries({ queryKey: ["discovery"] }),
    ]);
  };
  const subscribe = useMutation({
    mutationFn: (item: DiscoveryResult) => api.subscribe(item, revision),
    onSuccess: refreshProfileData,
  });
  const unsubscribe = useMutation({
    mutationFn: (podcastId: string) => api.unsubscribe(podcastId, revision),
    onSuccess: async () => {
      setSelectedPodcast(null);
      await refreshProfileData();
    },
  });
  const reorderSubscriptions = useMutation({
    mutationFn: (podcastIds: string[]) =>
      api.reorderSubscriptions(podcastIds, revision),
    onMutate: async (podcastIds) => {
      await queryClient.cancelQueries({ queryKey: ["subscriptions"] });
      const prior = queryClient.getQueryData<Subscription[]>(["subscriptions"]);
      if (prior) {
        const byId = new Map(prior.map((item) => [item.id, item]));
        queryClient.setQueryData(
          ["subscriptions"],
          podcastIds.map((id) => byId.get(id)!),
        );
      }
      return { prior };
    },
    onError: (_error, _ids, context) =>
      queryClient.setQueryData(["subscriptions"], context?.prior),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
  });
  const played = useMutation({
    mutationFn: (episode: Episode) =>
      api.setPlayed(episode.id, !episode.played, revision),
    onSuccess: refreshProfileData,
  });
  const addQueue = useMutation({
    mutationFn: ({
      episodeId,
      position,
    }: {
      episodeId: string;
      position: "next" | "bottom";
    }) => api.addQueue(episodeId, position, revision),
    onSuccess: async () => {
      setQueueOpen(true);
      await queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
  });
  const queueOrder = useMutation({
    mutationFn: (ids: string[]) => api.reorderQueue(ids, revision),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["queue"] }),
  });
  const queueRemove = useMutation({
    mutationFn: (id: string) => api.removeQueue(id, revision),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["queue"] }),
  });
  const queueClear = useMutation({
    mutationFn: () => api.clearQueue(revision),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["queue"] }),
  });
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => queryClient.setQueryData(["session"], null),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revoke(id, revision),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["devices"] }),
  });
  const busy =
    played.isPending ||
    addQueue.isPending ||
    queueOrder.isPending ||
    queueRemove.isPending;
  const selected = useMemo(
    () => subscriptions.data?.find((item) => item.id === selectedPodcast),
    [selectedPodcast, subscriptions.data],
  );

  const movePodcast = (targetId: string) => {
    if (!draggedPodcast || draggedPodcast === targetId || !subscriptions.data)
      return;
    const ids = subscriptions.data.map((item) => item.id);
    const from = ids.indexOf(draggedPodcast);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ...ids.splice(from, 1));
    reorderSubscriptions.mutate(ids);
    setDraggedPodcast(null);
  };
  const moveQueue = (targetId: string) => {
    if (!draggedQueue || draggedQueue === targetId || !queue.data) return;
    const ids = queue.data.map((item) => item.id);
    const from = ids.indexOf(draggedQueue);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ...ids.splice(from, 1));
    queueOrder.mutate(ids);
    setDraggedQueue(null);
  };

  return (
    <div className="workspace">
      <aside className="sidebar">
        <button
          className="brand-lockup"
          aria-label="Go to podcasts"
          onClick={() => {
            setPage("library");
            setSelectedPodcast(null);
          }}
        >
          <img src="/icon-512.png" alt="" />
          <span>Podwaffle</span>
        </button>
        <nav aria-label="Primary">
          {(
            [
              ["library", "Podcasts", "podcasts"],
              ["progress", "In progress", "progress"],
              ["discover", "Discover", "discover"],
              ["history", "History", "history"],
              ["profile", "Profile", "profile"],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              className={page === id ? "active" : ""}
              key={id}
              onClick={() => {
                setPage(id);
                setSelectedPodcast(null);
              }}
            >
              <Icon name={icon as IconName} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <button className="queue-button" onClick={() => setQueueOpen(true)}>
          <span>
            <Icon name="queue" />
            Queue
          </span>
          <b>{queue.data?.length ?? 0}</b>
        </button>
      </aside>

      <main className="content">
        <header>
          <div>
            <p className="eyebrow">Podwaffle</p>
            <h1>{session.profile.displayName}&rsquo;s listening</h1>
          </div>
          <div className="header-actions">
            <button className="secondary" onClick={() => setQueueOpen(true)}>
              Queue · {queue.data?.length ?? 0}
            </button>
            <span className={`status ${connected ? "online" : ""}`}>
              <span aria-hidden="true" />
              {connected ? "Live sync" : "Reconnecting"}
            </span>
          </div>
        </header>

        {page === "library" && !selected && (
          <section>
            <div className="section-heading">
              <div></div>
              <div className="segmented">
                {(["tiles", "list"] as const).map((mode) => (
                  <button
                    aria-label={`${mode === "tiles" ? "Tile" : "List"} layout`}
                    className={layout === mode ? "active" : ""}
                    key={mode}
                    title={`${mode === "tiles" ? "Tile" : "List"} layout`}
                    onClick={() => {
                      setLayout(mode);
                      localStorage.setItem(
                        `podwaffle-layout:${session.profile.id}`,
                        mode,
                      );
                    }}
                  >
                    <Icon name={mode} />
                  </button>
                ))}
              </div>
            </div>
            <div className={`podcast-grid ${layout}`}>
              {subscriptions.data?.map((podcast) => (
                <article
                  className="podcast-card"
                  draggable
                  key={podcast.id}
                  onDragStart={() => setDraggedPodcast(podcast.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => movePodcast(podcast.id)}
                >
                  <button onClick={() => setSelectedPodcast(podcast.id)}>
                    <div className="artwork">
                      {podcast.artworkUrl ? (
                        <img src={podcast.artworkUrl} alt="" />
                      ) : (
                        <span>PW</span>
                      )}
                      {podcast.hasNewEpisode && (
                        <i aria-label="New episodes" title="New episodes" />
                      )}
                    </div>
                    <div>
                      <h3>{podcast.title}</h3>
                      <p>{podcast.author ?? "Unknown author"}</p>
                    </div>
                  </button>
                </article>
              ))}
            </div>
            {subscriptions.data?.length === 0 && (
              <div className="empty">
                <p>Your library is empty.</p>
                <button onClick={() => setPage("discover")}>
                  Find a podcast
                </button>
              </div>
            )}
          </section>
        )}

        {page === "library" && selected && (
          <section>
            <button
              className="text-button"
              onClick={() => setSelectedPodcast(null)}
            >
              ← Back to podcasts
            </button>
            <div className="podcast-hero">
              {selected.artworkUrl && <img src={selected.artworkUrl} alt="" />}
              <div>
                <p className="eyebrow">{selected.author}</p>
                <h2>{selected.title}</h2>
                <p>{selected.description}</p>
              </div>
            </div>
            <EpisodeList
              episodes={episodes.data ?? []}
              revision={revision}
              busy={busy}
              onPlayed={(episode) => played.mutate(episode)}
              onQueue={(episodeId, position) =>
                addQueue.mutate({ episodeId, position })
              }
              onPlay={(episode) => void player.load(episode)}
            />
          </section>
        )}

        {page === "discover" && (
          <section>
            <form
              className="search"
              onSubmit={(event) => {
                event.preventDefault();
                setSubmittedQuery(query.trim());
              }}
            >
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search shows, people, and topics"
                aria-label="Search podcasts"
              />
              <button>Search</button>
            </form>
            <div className="search-results">
              {discovery.data?.map((item) => (
                <article className="search-result" key={item.appleCollectionId}>
                  {item.artworkUrl ? (
                    <img src={item.artworkUrl} alt="" />
                  ) : (
                    <div />
                  )}
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.author}</p>
                  </div>
                  {item.subscribed ? (
                    <button
                      className="unsubscribe-button"
                      disabled={unsubscribe.isPending}
                      onClick={() => {
                        const subscription = subscriptions.data?.find(
                          (podcast) =>
                            podcast.feedUrl === item.feedUrl ||
                            (item.appleCollectionId !== null &&
                              podcast.appleCollectionId ===
                                item.appleCollectionId),
                        );
                        if (subscription) unsubscribe.mutate(subscription.id);
                      }}
                    >
                      Unsubscribe
                    </button>
                  ) : (
                    <button
                      disabled={subscribe.isPending}
                      onClick={() => subscribe.mutate(item)}
                    >
                      Subscribe
                    </button>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {page === "progress" && (
          <section>
            <EpisodeList
              episodes={inProgress.data ?? []}
              revision={revision}
              busy={busy}
              onPlayed={(episode) => played.mutate(episode)}
              onQueue={(episodeId, position) =>
                addQueue.mutate({ episodeId, position })
              }
              onPlay={(episode) => void player.load(episode)}
            />
          </section>
        )}

        {page === "history" && (
          <section>
            <EpisodeList
              episodes={history.data ?? []}
              revision={revision}
              busy={busy}
              onPlayed={(episode) => played.mutate(episode)}
              onQueue={(episodeId, position) =>
                addQueue.mutate({ episodeId, position })
              }
              onPlay={(episode) => void player.load(episode)}
            />
          </section>
        )}

        {page === "profile" && (
          <section className="profile-page">
            <div className="panel skip-settings">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Playback</p>
                  <h2>Skip intervals</h2>
                </div>
                <span>Used by player controls and keyboard shortcuts.</span>
              </div>
              <div className="skip-settings-fields">
                <label>
                  Skip backward
                  <span>
                    <input
                      aria-label="Skip backward seconds"
                      type="number"
                      min={1}
                      max={120}
                      value={skipBackwardSeconds}
                      onChange={(event) =>
                        setSkipBackwardSeconds(
                          skipValue(event.target.value, 15),
                        )
                      }
                    />
                    seconds
                  </span>
                </label>
                <label>
                  Skip forward
                  <span>
                    <input
                      aria-label="Skip forward seconds"
                      type="number"
                      min={1}
                      max={120}
                      value={skipForwardSeconds}
                      onChange={(event) =>
                        setSkipForwardSeconds(skipValue(event.target.value, 30))
                      }
                    />
                    seconds
                  </span>
                </label>
              </div>
            </div>
            <div className="panel stats-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Your listening</p>
                  <h2>Statistics</h2>
                </div>
                <select
                  aria-label="Statistics period"
                  value={statsPeriod}
                  onChange={(event) =>
                    setStatsPeriod(event.target.value as typeof statsPeriod)
                  }
                >
                  <option value="today">Today</option>
                  <option value="7d">7 days</option>
                  <option value="30d">30 days</option>
                  <option value="year">This year</option>
                  <option value="all">All time</option>
                </select>
              </div>
              <div className="stat-grid">
                <article>
                  <strong>{formatDuration(stats.data?.listenedMs ?? 0)}</strong>
                  <span>Listening time</span>
                </article>
                <article>
                  <strong>{stats.data?.activeListeningDays ?? 0}</strong>
                  <span>Active days</span>
                </article>
                <article>
                  <strong>
                    {formatDuration(stats.data?.skippedForwardMs ?? 0)}
                  </strong>
                  <span>Skipped forward</span>
                </article>
                <article>
                  <strong>{stats.data?.episodesCompleted ?? 0}</strong>
                  <span>Episodes completed</span>
                </article>
                <article>
                  <strong>{stats.data?.currentStreak ?? 0} days</strong>
                  <span>Current streak</span>
                </article>
                <article>
                  <strong>{stats.data?.longestStreak ?? 0} days</strong>
                  <span>Longest streak</span>
                </article>
                <article>
                  <strong>{stats.data?.subscriptions ?? 0}</strong>
                  <span>Subscriptions</span>
                </article>
                <article>
                  <strong>{stats.data?.historyEntries ?? 0}</strong>
                  <span>History entries</span>
                </article>
              </div>
            </div>
            <div className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Security</p>
                  <h2>Connected devices</h2>
                </div>
                <button className="secondary" onClick={() => logout.mutate()}>
                  Log out
                </button>
              </div>
              <div className="device-list">
                {devices.data?.map((device) => (
                  <article className="device" key={device.id}>
                    <div className="device-icon">
                      {device.platform === "web" ? "W" : "A"}
                    </div>
                    <div>
                      <h3>{device.name}</h3>
                      <p>{device.current ? "This device" : device.platform}</p>
                    </div>
                    {!device.current && (
                      <button
                        className="danger"
                        onClick={() => revoke.mutate(device.id)}
                      >
                        Revoke
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      {queueOpen && (
        <div className="drawer-backdrop" onClick={() => setQueueOpen(false)}>
          <aside
            className="queue-drawer"
            aria-label="Queue"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Coming up</p>
                <h2>Queue</h2>
              </div>
              <button className="secondary" onClick={() => setQueueOpen(false)}>
                Close
              </button>
            </div>
            {queue.data?.map((item, index) => (
              <article
                className={`queue-item ${index === 0 ? "current" : ""}`}
                draggable
                key={item.id}
                onDragStart={() => setDraggedQueue(item.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => moveQueue(item.id)}
              >
                <span>{index + 1}</span>
                <div>
                  <h3>{item.episode.title}</h3>
                  <p>{item.episode.podcastTitle}</p>
                </div>
                <button
                  className="secondary"
                  onClick={() => queueRemove.mutate(item.id)}
                >
                  Remove
                </button>
              </article>
            ))}
            {queue.data?.length === 0 && (
              <p className="empty">Queue is empty.</p>
            )}
            {!!queue.data?.length && (
              <button
                className="danger clear"
                onClick={() => queueClear.mutate()}
              >
                Clear queue
              </button>
            )}
          </aside>
        </div>
      )}
      <PlayerBar
        onQueue={() => setQueueOpen(true)}
        queueCount={queue.data?.length ?? 0}
      />
    </div>
  );
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${hours}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function skipSetting(
  key: string,
  setting: "backward" | "forward",
  fallback: number,
): number {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<
      string,
      unknown
    >;
    return skipValue(saved[setting], fallback);
  } catch {
    return fallback;
  }
}

function skipValue(value: unknown, fallback: number): number {
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= 120
    ? seconds
    : fallback;
}
