import { z } from "zod";

export const analysisSettingsSchema = z.object({
  enabled: z.boolean(),
  phrases: z.array(z.string().trim().min(1).max(160)).max(50).default([]),
  llmPrompt: z.string().trim().max(2000).default(""),
  sensitivity: z.enum(["low", "balanced", "high"]).default("balanced"),
  edgeFocusMinutes: z.number().int().min(0).max(15).default(5),
});
export type AnalysisSettings = z.infer<typeof analysisSettingsSchema>;

export const analysisSegmentSchema = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    kind: z.enum([
      "advertisement",
      "promotion",
      "chapter",
      "intro",
      "outro",
      "unknown",
    ]),
    title: z.string().max(200),
    confidence: z.number().min(0).max(1),
    source: z.enum(["publisher", "embedded", "rules", "gemini", "local"]),
    evidence: z.string().max(500),
    boundaryStatus: z.literal("approximate"),
  })
  .refine((s) => s.endMs > s.startMs, "Invalid segment range");

export const analysisResultSchema = z
  .object({
    version: z.literal(1),
    language: z.literal("en"),
    episodeId: z.string().max(200),
    durationMs: z
      .number()
      .int()
      .positive()
      .max(8 * 3600000),
    fingerprint: z.object({
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      sizeBytes: z.number().int().positive(),
      etag: z.string().nullable(),
    }),
    model: z.string().max(200),
    provider: z.enum(["rules", "gemini", "local"]),
    classifierModel: z.string().max(200).optional(),
    generatedAt: z.iso.datetime(),
    segments: z.array(analysisSegmentSchema).max(2000),
    fragments: z
      .array(
        z.object({
          startMs: z.number().nonnegative(),
          endMs: z.number().positive(),
          text: z.string().max(4000),
        }),
      )
      .max(20000),
    diagnostics: z.object({
      sampleWindows: z
        .array(
          z.object({
            startMs: z.number().nonnegative(),
            endMs: z.number().positive(),
          }),
        )
        .max(200),
      acousticBoundariesMs: z.array(z.number().nonnegative()).max(2000),
      warnings: z.array(z.string().max(2000)).max(100),
    }),
    transcriptExpired: z.boolean(),
  })
  .superRefine((value, ctx) => {
    for (const range of [
      ...value.segments,
      ...value.fragments,
      ...value.diagnostics.sampleWindows,
    ]) {
      if (range.endMs <= range.startMs || range.endMs > value.durationMs)
        ctx.addIssue({
          code: "custom",
          message: "Range outside media duration",
        });
    }
  });
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export interface EpisodeAnalysis {
  configured: boolean;
  job: null | {
    id: string;
    status: string;
    stage: string;
    progress: number;
    createdAt: string;
    finishedAt: string | null;
    error: string | null;
    attempts: number;
    remoteJobId: string | null;
    nextAttemptAt: string;
    stale: boolean;
    transcriptExpiresAt: string | null;
    result: AnalysisResult | null;
    logs: Array<{ createdAt: string; level: string; message: string }>;
  };
}
