package com.podwaffle.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AdSkippingTest {
    @Test fun publisherFallbackClearsAllAnalysisAndKeepsTheOriginalUrl() {
        val media = EpisodeMedia("one", "show", "One", "Show", "https://publisher.test/one.mp3", "audio/mpeg", "/offline/one.mp3", null, 60000L, null,
            analysedUrl = "https://podwaffle.test/media/checked", analysisSha256 = "a".repeat(64), adSegments = "[{\"startMs\":1000,\"endMs\":2000}]")
        val fallback = AdSkipping.publisherFallback(media)!!
        assertEquals(media.enclosureUrl, fallback.enclosureUrl)
        assertNull(fallback.analysedUrl)
        assertNull(fallback.analysisSha256)
        assertNull(fallback.localDownloadPath)
        assertEquals("[]", fallback.adSegments)
        assertNull(AdSkipping.publisherFallback(fallback))
    }
    @Test fun onlySkipsInsideAnAdvert() {
        val regions = listOf(AdRegion(10_000, 20_000))
        assertNull(AdSkipping.target(9_999, 60_000, regions))
        assertEquals(20_000L, AdSkipping.target(10_000, 60_000, regions))
        assertEquals(20_000L, AdSkipping.target(19_999, 60_000, regions))
        assertNull(AdSkipping.target(20_000, 60_000, regions))
    }
    @Test fun overlappingAndAdjacentAdvertsSkipInOneSeek() {
        val regions = listOf(AdRegion(20_000, 30_000), AdRegion(10_000, 22_000), AdRegion(30_000, 35_000))
        assertEquals(35_000L, AdSkipping.target(15_000, 60_000, regions))
    }
    @Test fun skipsNeverSeekPastTheRecordingEnd() {
        val regions = listOf(AdRegion(50_000, 70_000))
        assertEquals(59_900L, AdSkipping.target(55_000, 60_000, regions))
        assertNull(AdSkipping.target(59_900, 60_000, regions))
        assertNull(AdSkipping.target(55_000, 0, regions))
    }
}
