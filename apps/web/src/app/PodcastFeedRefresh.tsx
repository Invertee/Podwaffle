import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export function PodcastFeedRefresh({ podcastId }: { podcastId: string }) {
  const queryClient = useQueryClient();
  const refresh = useMutation({
    mutationFn: () => api.refreshPodcast(podcastId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
        queryClient.invalidateQueries({ queryKey: ["episodes", podcastId] }),
      ]);
    },
  });
  const added = refresh.data?.discoveredEpisodeIds.length ?? 0;
  return (
    <div className="podcast-feed-refresh">
      <button
        type="button"
        disabled={refresh.isPending}
        onClick={() => refresh.mutate()}
      >
        {refresh.isPending ? "Checking feed…" : "Refresh feed"}
      </button>
      {refresh.isSuccess && (
        <span role="status">
          {added > 0
            ? `Added ${added} new episode${added === 1 ? "" : "s"}.`
            : "No new episodes found."}
        </span>
      )}
      {refresh.isError && (
        <span role="alert">
          Could not refresh the feed. Check the server log for details.
        </span>
      )}
    </div>
  );
}
