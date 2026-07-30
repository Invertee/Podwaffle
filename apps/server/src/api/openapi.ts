import { API_VERSION, BUILD_VERSION } from "../app.js";

export function openApiDocument() {
  const error = {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          details: {},
          currentRevision: { type: "integer", minimum: 0 },
        },
      },
    },
  };
  const authenticated = [{ cookieAuth: [] }, { bearerAuth: [] }];
  return {
    openapi: "3.1.0",
    info: {
      title: "Podwaffle API",
      version: BUILD_VERSION,
      description: `Podwaffle ${API_VERSION} REST and durable synchronisation API`,
    },
    servers: [{ url: "/" }],
    paths: {
      "/api/v1/system": {
        get: { responses: { "200": { description: "System status" } } },
      },
      "/api/v1/join/profiles": {
        get: { responses: { "200": { description: "Enabled profiles" } } },
      },
      "/api/v1/join": {
        post: {
          requestBody: { required: true },
          responses: {
            "201": { description: "Device enrolled" },
            "401": { description: "Invalid join code" },
          },
        },
      },
      "/api/v1/logout": {
        post: {
          responses: { "204": { description: "Browser credential cleared" } },
        },
      },
      "/api/v1/me": {
        get: {
          security: authenticated,
          responses: { "200": { description: "Session" } },
        },
      },
      "/api/v1/devices": {
        get: {
          security: authenticated,
          responses: { "200": { description: "Active profile devices" } },
        },
      },
      "/api/v1/devices/{deviceId}": {
        delete: {
          security: authenticated,
          parameters: [
            {
              name: "deviceId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: { "200": { description: "Device revoked" } },
        },
      },
      "/api/v1/snapshot": {
        get: {
          security: authenticated,
          responses: { "200": { description: "Complete profile snapshot" } },
        },
      },
      "/api/v1/sync": {
        get: {
          security: authenticated,
          parameters: [
            {
              name: "afterRevision",
              in: "query",
              required: true,
              schema: { type: "integer", minimum: 0 },
            },
          ],
          responses: {
            "200": { description: "Ordered durable events" },
            "409": { description: "Snapshot required" },
          },
        },
      },
      "/api/v1/discover/search": {
        get: {
          security: authenticated,
          responses: { "200": { description: "Apple podcast search results" } },
        },
      },
      "/api/v1/subscriptions": {
        get: {
          security: authenticated,
          responses: { "200": { description: "Ordered podcast library" } },
        },
        post: {
          security: authenticated,
          responses: {
            "201": { description: "Podcast subscribed and ingested" },
          },
        },
      },
      "/api/v1/subscriptions/order": {
        put: {
          security: authenticated,
          responses: {
            "200": { description: "Complete podcast order applied" },
          },
        },
      },
      "/api/v1/podcasts/{podcastId}/episodes": {
        get: {
          security: authenticated,
          responses: { "200": { description: "Normalised podcast episodes" } },
        },
      },
      "/api/v1/episodes/{episodeId}/state": {
        patch: {
          security: authenticated,
          responses: { "200": { description: "Played override applied" } },
        },
      },
      "/api/v1/episodes/{episodeId}/progress": {
        post: {
          security: authenticated,
          responses: {
            "200": { description: "Progress and completion applied" },
          },
        },
      },
      "/api/v1/queue": {
        get: {
          security: authenticated,
          responses: { "200": { description: "Current ordered queue" } },
        },
        delete: {
          security: authenticated,
          responses: { "200": { description: "Queue cleared" } },
        },
      },
      "/api/v1/queue/items": {
        post: {
          security: authenticated,
          responses: { "201": { description: "Episode added to queue" } },
        },
      },
      "/api/v1/queue/order": {
        put: {
          security: authenticated,
          responses: { "200": { description: "Complete queue order applied" } },
        },
      },
      "/api/v1/playback": {
        get: {
          security: authenticated,
          responses: { "200": { description: "Current playback state" } },
        },
      },
      "/api/v1/playback/lease": {
        post: {
          security: authenticated,
          responses: { "200": { description: "Playback ownership acquired" } },
        },
        delete: {
          security: authenticated,
          responses: { "200": { description: "Playback ownership released" } },
        },
      },
      "/api/v1/playback/state": {
        post: {
          security: authenticated,
          responses: {
            "200": { description: "Confirmed playback state stored" },
          },
        },
      },
      "/api/v1/playback/cast": {
        post: {
          security: authenticated,
          responses: {
            "200": { description: "Receiver-confirmed Cast mode started" },
          },
        },
        delete: {
          security: authenticated,
          responses: {
            "200": { description: "Cast handed back to local playback" },
          },
        },
      },
      "/api/v1/playback/commands": {
        post: {
          security: authenticated,
          responses: {
            "202": { description: "Command relayed to the Cast owner" },
          },
        },
      },
      "/api/v1/playback/commands/{commandId}/result": {
        post: {
          security: authenticated,
          responses: {
            "200": { description: "Receiver-confirmed command result stored" },
          },
        },
      },
      "/api/v1/playback/movements": {
        post: {
          security: authenticated,
          responses: {
            "201": { description: "Confirmed typed movement stored" },
          },
        },
      },
      "/api/v1/playback/telemetry": {
        post: {
          security: authenticated,
          responses: {
            "201": { description: "Deduplicated telemetry stored" },
          },
        },
      },
      "/api/v1/stats": {
        get: {
          security: authenticated,
          responses: {
            "200": { description: "Period-filtered listening statistics" },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        cookieAuth: { type: "apiKey", in: "cookie", name: "pw_device" },
        bearerAuth: { type: "http", scheme: "bearer" },
      },
      schemas: { ApiError: error },
    },
  };
}
