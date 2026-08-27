import { describe, expect, it } from "vitest";

import { stripHtml } from "./index.js";

describe("stripHtml", () => {
  it("removes feed markup and decodes named and numeric entities", () => {
    expect(
      stripHtml(
        "<p>The news &amp; more.</p><p>Early access&#x20;—&#8212; now.</p>",
      ),
    ).toBe("The news & more.\nEarly access —— now.");
  });

  it("returns null for empty descriptions", () => {
    expect(stripHtml("<p>  </p>")).toBeNull();
    expect(stripHtml(null)).toBeNull();
  });
});
