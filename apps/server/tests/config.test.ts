import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const originalDevMode = process.env.PODWAFFLE_DEV_MODE;
const originalOptionsPath = process.env.PODWAFFLE_OPTIONS_PATH;
const originalDataDir = process.env.PODWAFFLE_DATA_DIR;

afterEach(() => {
  if (originalDevMode === undefined) delete process.env.PODWAFFLE_DEV_MODE;
  else process.env.PODWAFFLE_DEV_MODE = originalDevMode;
  if (originalOptionsPath === undefined)
    delete process.env.PODWAFFLE_OPTIONS_PATH;
  else process.env.PODWAFFLE_OPTIONS_PATH = originalOptionsPath;
  if (originalDataDir === undefined) delete process.env.PODWAFFLE_DATA_DIR;
  else process.env.PODWAFFLE_DATA_DIR = originalDataDir;
});

describe("development configuration", () => {
  it("loads the committed default config and isolated data directory in dev mode", async () => {
    process.env.PODWAFFLE_DEV_MODE = "true";
    delete process.env.PODWAFFLE_OPTIONS_PATH;
    delete process.env.PODWAFFLE_DATA_DIR;
    const config = await loadConfig();
    expect(config.profileNames).toEqual(["Developer", "Guest"]);
    expect(config.join_code).toBe("podwaffle-dev");
    expect(config.dataDir.replaceAll("\\", "/")).toMatch(
      /apps\/server\/\.data$/,
    );
  });
});
