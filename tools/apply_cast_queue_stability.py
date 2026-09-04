from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}")
    file.write_text(text.replace(old, new, 1))


service = "apps/android/modules/podwaffle-media/android/src/main/java/com/podwaffle/media/PodwaffleMediaService.kt"
replace_once(
    service,
    '''internal fun shouldSuppressCastStartupTransition(
''',
    '''internal fun canReconcileActiveCastQueueWithoutReload(
    activeCast: Boolean,
    currentId: String?,
    currentIndex: Int,
    candidateIds: List<String>,
): Boolean =
    activeCast &&
        currentIndex == 0 &&
        currentId != null &&
        candidateIds.firstOrNull() == currentId

internal fun shouldSuppressCastStartupTransition(
''',
)

replace_once(
    service,
    '''        val currentId = player.currentMediaItem?.mediaId
        val currentPosition = player.currentPosition.coerceAtLeast(0L)
        val selection = reconcileQueueSelection(
            candidates.map { it.mediaId },
            currentId,
            currentPosition,
            requestedIndex,
        )
''',
    '''        val currentId = player.currentMediaItem?.mediaId
        val currentPosition = player.currentPosition.coerceAtLeast(0L)
        val candidateIds = candidates.map { it.mediaId }
        if (
            canReconcileActiveCastQueueWithoutReload(
                player === castPlayer && isCasting(),
                currentId,
                player.currentMediaItemIndex,
                candidateIds,
            )
        ) {
            // Do not reload/prepare the active Cast item for a queue-only change.
            // CastPlayer.setMediaItems() sends a receiver queue load which can
            // briefly pause playback and, on some receivers, detach the sender.
            // The playback invariant keeps the current episode at queue index 0,
            // so mutate only the future queue while the receiver keeps playing.
            reconcileActiveCastQueueTail(player, candidates)
            lastMediaItem = player.currentMediaItem
            lastObservedMediaId = currentId
            lastObservedPositionMs = currentPosition
            lastObservedDurationMs =
                EpisodeMedia.fromMediaItem(player.currentMediaItem)?.durationMs
                    ?: lastObservedDurationMs
            persistPlayback()
            notifyQueueChanged()
            notifyCastStateChanged()
            notifyStateChanged()
            return
        }
        val selection = reconcileQueueSelection(
            candidateIds,
            currentId,
            currentPosition,
            requestedIndex,
        )
''',
)

replace_once(
    service,
    '''    fun playEpisode(
        local: MediaItem,
''',
    '''    private fun reconcileActiveCastQueueTail(
        player: Player,
        candidates: List<MediaItem>,
    ) {
        val desiredTail = candidates.drop(1)
        val existingTail = buildList {
            for (index in 1 until player.mediaItemCount) {
                add(player.getMediaItemAt(index))
            }
        }
        var sharedPrefix = 0
        while (
            sharedPrefix < existingTail.size &&
            sharedPrefix < desiredTail.size &&
            existingTail[sharedPrefix].mediaId == desiredTail[sharedPrefix].mediaId
        ) {
            sharedPrefix += 1
        }

        val replaceFrom = 1 + sharedPrefix
        if (player.mediaItemCount > replaceFrom) {
            player.removeMediaItems(replaceFrom, player.mediaItemCount)
        }
        val replacement = desiredTail.drop(sharedPrefix)
        if (replacement.isNotEmpty()) {
            player.addMediaItems(replaceFrom, replacement)
        }
    }

    fun playEpisode(
        local: MediaItem,
''',
)

test = "apps/android/modules/podwaffle-media/android/src/test/java/com/podwaffle/media/QueueSelectionTest.kt"
replace_once(
    test,
    '''    @Test
    fun suppressesOnlyUnexpectedAutomaticTransitionsDuringCastStartup() {
''',
    '''    @Test
    fun keepsTheCurrentCastItemLoadedWhenOnlyTheFutureQueueChanges() {
        assertTrue(
            canReconcileActiveCastQueueWithoutReload(
                activeCast = true,
                currentId = "current",
                currentIndex = 0,
                candidateIds = listOf("current", "next", "new"),
            ),
        )
        assertFalse(
            canReconcileActiveCastQueueWithoutReload(
                activeCast = true,
                currentId = "current",
                currentIndex = 1,
                candidateIds = listOf("previous", "current", "next"),
            ),
        )
        assertFalse(
            canReconcileActiveCastQueueWithoutReload(
                activeCast = true,
                currentId = "current",
                currentIndex = 0,
                candidateIds = listOf("replacement", "next"),
            ),
        )
        assertFalse(
            canReconcileActiveCastQueueWithoutReload(
                activeCast = false,
                currentId = "current",
                currentIndex = 0,
                candidateIds = listOf("current", "next"),
            ),
        )
    }

    @Test
    fun suppressesOnlyUnexpectedAutomaticTransitionsDuringCastStartup() {
''',
)

card = "apps/android/src/components/PushDiagnosticsCard.tsx"
replace_once(
    card,
    '''  Pressable,
  StyleSheet,
''',
    '''  Pressable,
  ScrollView,
  StyleSheet,
''',
)
replace_once(
    card,
    '''      <View style={styles.console}>
''',
    '''      <ScrollView
        style={styles.console}
        contentContainerStyle={styles.consoleContent}
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
''',
)
replace_once(
    card,
    '''          ))
        )}
      </View>
    </View>
''',
    '''          ))
        )}
      </ScrollView>
    </View>
''',
)
replace_once(
    card,
    '''  console: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.bgPrimary,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
''',
    '''  console: {
    height: 200,
    borderRadius: radii.md,
    backgroundColor: colors.bgPrimary,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  consoleContent: {
    gap: spacing.xs,
    padding: spacing.sm,
  },
''',
)

replace_once(
    "apps/android/app.config.ts",
    '''  version: "0.4.33",
''',
    '''  version: "0.4.34",
''',
)
replace_once(
    "apps/android/app.config.ts",
    '''    buildNumber: "35",
''',
    '''    buildNumber: "36",
''',
)
replace_once(
    "apps/android/app.config.ts",
    '''    versionCode: 37,
''',
    '''    versionCode: 38,
''',
)
replace_once(
    "apps/android/app.config.ts",
    '''    nativeRuntimeVersion: "0.4-native-27",
''',
    '''    nativeRuntimeVersion: "0.4-native-28",
''',
)
replace_once(
    "apps/android/package.json",
    '''  "version": "0.4.33",
''',
    '''  "version": "0.4.34",
''',
)
replace_once(
    "apps/android/modules/podwaffle-media/package.json",
    '''  "version": "0.4.21",
''',
    '''  "version": "0.4.22",
''',
)
replace_once(
    "apps/android/modules/podwaffle-media/android/build.gradle",
    '''version = '0.4.21'
''',
    '''version = '0.4.22'
''',
)
replace_once(
    "apps/android/modules/podwaffle-media/android/build.gradle",
    '''    versionCode 25
    versionName "0.4.21"
''',
    '''    versionCode 26
    versionName "0.4.22"
''',
)
replace_once(
    "CHANGELOG.md",
    '''## Unreleased

''',
    '''## Unreleased

- Kept active Cast playback loaded when queue changes arrive from another client,
  reconciling only future receiver queue items instead of reloading and preparing
  the current episode, which could pause audio and destabilize sender control.
  Also compacted the Android push diagnostics viewer into a four-row-height
  scrollable console. Updated Android to 0.4.34 / versionCode 38 / native runtime
  0.4-native-28.
''',
)
