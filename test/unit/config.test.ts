import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

jest.mock("fs");
jest.mock("os", () => ({ homedir: jest.fn(() => "/test/home") }));

const mockedReadFileSync = jest.mocked(readFileSync);
const mockedWriteFileSync = jest.mocked(writeFileSync);
const mockedExistsSync = jest.mocked(existsSync);
const mockedMkdirSync = jest.mocked(mkdirSync);
const mockedHomedir = jest.mocked(homedir);

// Load config after mocks so the module reads the mocked constants
const { loadConfig, saveConfig, getConfigPath } = jest.requireActual<typeof import("../../src/config")>("../../src/config");

describe("config", () => {
  const TEST_HOME = "/test/home";
  const CONFIG_DIR = join(TEST_HOME, ".pi", "agent");
  const CONFIG_PATH = join(CONFIG_DIR, "web-config.json");

  beforeEach(() => {
    jest.clearAllMocks();
    mockedHomedir.mockReturnValue(TEST_HOME);
  });

  describe("loadConfig", () => {
    it("reads existing config file when it exists", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({ port: 9999, token: "my-token", agentDir: "/custom" })
      );

      const config = loadConfig();
      expect(config.port).toBe(9999);
      expect(config.token).toBe("my-token");
      expect(config.agentDir).toBe("/custom");
    });

    it("falls back to defaults when config file is missing", () => {
      mockedExistsSync.mockReturnValue(false);

      const config = loadConfig();
      expect(config.port).toBe(3456);
      expect(config.token).toHaveLength(32);
      expect(config.agentDir).toBe(CONFIG_DIR);
      expect(mockedWriteFileSync).toHaveBeenCalledWith(
        CONFIG_PATH,
        expect.stringContaining("token")
      );
    });

    it("falls back to defaults when config file is malformed JSON", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue("not json");

      const config = loadConfig();
      expect(config.port).toBe(3456);
      expect(config.token).toHaveLength(32);
    });

    it("fills in missing fields from defaults", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify({ port: 1111 }));

      const config = loadConfig();
      expect(config.port).toBe(1111);
      expect(config.token).toHaveLength(32);
      expect(config.agentDir).toBe(CONFIG_DIR);
    });
  });

  describe("saveConfig", () => {
    it("creates config dir if missing and writes config", () => {
      mockedExistsSync.mockReturnValue(false);

      const config = { port: 1234, token: "abc", agentDir: "/dir" };
      saveConfig(config);

      expect(mockedMkdirSync).toHaveBeenCalledWith(CONFIG_DIR, { recursive: true });
      expect(mockedWriteFileSync).toHaveBeenCalledWith(
        CONFIG_PATH,
        expect.stringContaining('"port": 1234')
      );
    });
  });

  describe("getConfigPath", () => {
    it("returns the expected path", () => {
      const path = getConfigPath();
      expect(path).toBe(CONFIG_PATH);
    });
  });
});
