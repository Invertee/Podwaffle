'use strict';

const cron = require('node-cron');

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

let scheduledTask = null;
let refreshInFlight = null;

/**
 * Core refresh logic shared by both the scheduled cron run and the
 * immediate startup run.
 */
async function _executeRefresh(feedService, userService, broadcastFn) {
  const startTime = new Date().toISOString();
  console.log(`[scheduler] Feed refresh started at ${startTime}`);

  try {
    const summary = await feedService.refreshAllSubscribedFeeds(
      userService.getAllUserGuids,
      userService.getSubscriptions
    );

    console.log('[scheduler] Refresh complete:', summary);

    // Broadcast actual updated feed snapshots to each affected user. Clients can
    // update immediately without performing their own RSS fetch.
    if (summary.newEpisodesFeeds && summary.newEpisodesFeeds.length > 0) {
      console.log(`[scheduler] Broadcasting feeds:updated for ${summary.newEpisodesFeeds.length} feed(s)`);
      if (typeof broadcastFn === 'function') {
        const users = await userService.getAllUserGuids();
        for (const guid of users) {
          const subscriptions = await userService.getSubscriptions(guid);
          const feeds = await feedService.getCachedFeedsByUrls(subscriptions);
          const changed = feeds.filter((feed) => summary.newEpisodesFeeds.includes(feed.feedId));
          if (!changed.length) continue;
          broadcastFn({
            type: 'feeds:updated',
            data: {
              guid,
              updatedFeeds: changed.map((feed) => feed.feedId),
              feeds: changed,
              refreshedAt: new Date().toISOString(),
            }
          });
        }
      } else {
        console.warn('[scheduler] broadcastFn is not a function, skipping WS broadcast');
      }
    } else {
      console.log('[scheduler] No new episodes found in this refresh run');
    }

    const endTime = new Date().toISOString();
    console.log(`[scheduler] Refresh finished at ${endTime}. Summary: total=${summary.total}, succeeded=${summary.succeeded}, failed=${summary.failed}, newFeeds=${summary.newEpisodesFeeds.length}`);

    return summary;
  } catch (err) {
    console.error('[scheduler] Refresh run encountered an unhandled error:', err);
    return { total: 0, succeeded: 0, failed: 0, newEpisodesFeeds: [], error: err.message };
  }
}

function _runRefresh(feedService, userService, broadcastFn) {
  if (refreshInFlight) {
    console.log('[scheduler] Feed refresh already running; joining the active run');
    return refreshInFlight;
  }
  refreshInFlight = _executeRefresh(feedService, userService, broadcastFn)
    .finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

/**
 * Start the node-cron scheduler that runs a feed refresh every 35 minutes.
 *
 * @param {Object}   feedService  - feedService module
 * @param {Object}   userService  - userService module
 * @param {Function} broadcastFn  - function(msgObj) that sends to all WebSocket clients
 */
function startScheduler(feedService, userService, broadcastFn) {
  console.log('[scheduler] startScheduler() → scheduling refresh every 35 minutes (cron: */35 * * * *)');

  if (scheduledTask) {
    console.warn('[scheduler] startScheduler() → a scheduler is already running, stopping previous task');
    scheduledTask.stop();
  }

  scheduledTask = cron.schedule('*/35 * * * *', async () => {
    console.log('[scheduler] Cron triggered → starting scheduled feed refresh');
    await _runRefresh(feedService, userService, broadcastFn);
  });

  console.log('[scheduler] startScheduler() → cron job registered');
  return scheduledTask;
}

/**
 * Trigger an immediate single refresh run (not cron-scheduled).
 * Used at server startup.
 *
 * @param {Object}   feedService  - feedService module
 * @param {Object}   userService  - userService module
 * @param {Function} broadcastFn  - function(msgObj) that sends to all WebSocket clients
 */
async function runImmediately(feedService, userService, broadcastFn) {
  console.log('[scheduler] runImmediately() → running a one-shot feed refresh now');
  return _runRefresh(feedService, userService, broadcastFn);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  startScheduler,
  runImmediately
};
