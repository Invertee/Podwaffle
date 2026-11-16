import { randomUUID } from "node:crypto";
import supertest from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import { configureLogging } from "../../src/logging.js";
import type { Runtime } from "../../src/runtime.js";
import { join, testRuntime } from "../helpers.js";

let runtime: Runtime | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await runtime?.close();
  runtime = undefined;
  vi.restoreAllMocks();
});

function feed(episodes: number): string {
  return (
    "<rss><channel><title>Diagnostic show</title>" +
    Array.from(
      { length: episodes },
      (_, index) =>
        "<item><guid>episode-" +
        index +
        "</guid><title>Episode " +
        index +
        "</title><pubDate>" +
        new Date(Date.UTC(2026, 10, 10 + index)).toUTCString() +
        "</pubDate></item>",
    ).join("") +
    "</channel></rss>"
  );
}

it("reports persisted backoff and manual recovery, including new and unchanged episodes", async () => {
  configureLogging("info");
  const output = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  const logs = () => output.mock.calls.map(([chunk]) => String(chunk)).join("");
  const fetch = vi.fn().mockImplementation(async () => new Response(feed(1)));
  vi.stubGlobal("fetch", fetch);
  const created = await testRuntime();
  runtime = created.runtime;
  runtime.feedScheduler.stop();
  const agent = supertest.agent(created.baseUrl);
  await join(agent);
  const subscribed = await agent
    .post("/api/v1/subscriptions")
    .send({
      commandId: randomUUID(),
      feedUrl: "https://feeds.example.com/podcast.rss",
    })
    .expect(201);
  const podcastId = (subscribed.body as { subscription: { id: string } })
    .subscription.id;
  runtime.database.db
    .prepare(
      "UPDATE podcasts SET next_check_at = ?, failure_count = 5 WHERE id = ?",
    )
    .run("2026-01-01T00:00:00.000Z", podcastId);
  const cause = Object.assign(
    new Error("getaddrinfo ENOTFOUND feeds.example.com"),
    { code: "ENOTFOUND", hostname: "feeds.example.com" },
  );
  fetch.mockRejectedValueOnce(new TypeError("fetch failed", { cause }));
  output.mockClear();
  await runtime.feedScheduler.refreshDue();
  const blocked = runtime.database.db
    .prepare("SELECT failure_count, next_check_at FROM podcasts WHERE id = ?")
    .get(podcastId) as { failure_count: number; next_check_at: string };
  expect(blocked.failure_count).toBe(6);
  expect(Date.parse(blocked.next_check_at)).toBeGreaterThan(Date.now());
  expect(logs()).toContain('errorCodes=["ENOTFOUND"]');
  expect(logs()).toContain("podcastTitle=Diagnostic show");
  expect(logs()).toContain("nextRetryAt=" + blocked.next_check_at);

  output.mockClear();
  runtime.feedScheduler.start();
  runtime.feedScheduler.stop();
  expect(logs()).toContain("dueFeeds=0");
  expect(logs()).toContain(
    "Podcast feed retry is waiting after earlier failures",
  );
  expect(logs()).toContain("nextRetryAt=" + blocked.next_check_at);

  fetch.mockImplementation(async () => new Response(feed(2)));
  output.mockClear();
  await agent
    .post("/api/v1/podcasts/" + podcastId + "/refresh")
    .send({ commandId: randomUUID() })
    .expect(200);
  expect(logs()).toContain("source=manual");
  expect(logs()).toContain("episodes=2");
  expect(logs()).toContain("newEpisodes=1");
  expect(logs()).toContain("Podcast feed refresh saved");
  const recovered = runtime.database.db
    .prepare("SELECT failure_count FROM podcasts WHERE id = ?")
    .get(podcastId) as { failure_count: number };
  expect(recovered.failure_count).toBe(0);
  expect(
    runtime.database.db
      .prepare("SELECT COUNT(*) AS total FROM episodes WHERE podcast_id = ?")
      .get(podcastId),
  ).toMatchObject({ total: 2 });

  fetch.mockResolvedValueOnce(new Response(null, { status: 304 }));
  output.mockClear();
  await agent
    .post("/api/v1/podcasts/" + podcastId + "/refresh")
    .send({ commandId: randomUUID() })
    .expect(200);
  expect(logs()).toContain("Publisher reports no feed changes (HTTP 304)");
  expect(logs()).toContain("status=not-modified");
  expect(logs()).toContain("newEpisodes=0");
});
