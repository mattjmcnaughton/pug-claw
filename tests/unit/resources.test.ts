import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { resolveConfig, getChannelConfig } from "../../src/resources.ts";

const FIXTURES = resolve(import.meta.dir, "../fixtures");
const PUG_CLAW_HOME = resolve(FIXTURES, "pug-claw-home");

function makeTmpDir(): string {
  const dir = resolve(
    tmpdir(),
    `pug-claw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Save/restore env vars around tests
function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<void> | void,
) {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const key of Object.keys(overrides)) {
      saved[key] = process.env[key];
    }
    try {
      for (const [key, val] of Object.entries(overrides)) {
        if (val === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = val;
        }
      }
      await fn();
    } finally {
      for (const [key, val] of Object.entries(saved)) {
        if (val === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = val;
        }
      }
    }
  };
}

// Clear relevant env vars for clean tests
const cleanEnv = {
  PUG_CLAW_HOME: undefined,
  PUG_CLAW_AGENTS_DIR: undefined,
  PUG_CLAW_SKILLS_DIR: undefined,
  PUG_CLAW_INTERNAL_DIR: undefined,
  PUG_CLAW_DATA_DIR: undefined,
  PUG_CLAW_CODE_DIR: undefined,
  PUG_CLAW_LOGS_DIR: undefined,
};

describe("resolveConfig", () => {
  test(
    "loads config.json from home dir",
    withEnv(cleanEnv, async () => {
      const config = await resolveConfig({ home: PUG_CLAW_HOME });
      expect(config.homeDir).toBe(PUG_CLAW_HOME);
      expect(config.defaultAgent).toBe("test-agent");
      expect(config.defaultDriver).toBe("claude");
      expect(config.agentsDir).toBe(resolve(PUG_CLAW_HOME, "agents"));
      expect(config.skillsDir).toBe(resolve(PUG_CLAW_HOME, "skills"));
      expect(config.internalDir).toBe(resolve(PUG_CLAW_HOME, "internal"));
      expect(config.dataDir).toBe(resolve(PUG_CLAW_HOME, "data"));
      expect(config.codeDir).toBe(resolve(PUG_CLAW_HOME, "code"));
      expect(config.logsDir).toBe(resolve(PUG_CLAW_HOME, "logs"));
    }),
  );

  test(
    "PUG_CLAW_HOME env override",
    withEnv({ ...cleanEnv, PUG_CLAW_HOME }, async () => {
      const config = await resolveConfig();
      expect(config.homeDir).toBe(PUG_CLAW_HOME);
      expect(config.defaultAgent).toBe("test-agent");
    }),
  );

  test(
    "--home CLI flag overrides env",
    withEnv({ ...cleanEnv, PUG_CLAW_HOME: "/tmp/should-not-use" }, async () => {
      const config = await resolveConfig({ home: PUG_CLAW_HOME });
      expect(config.homeDir).toBe(PUG_CLAW_HOME);
    }),
  );

  test(
    "individual path overrides via env",
    withEnv(
      {
        ...cleanEnv,
        PUG_CLAW_AGENTS_DIR: "/tmp/custom-agents",
      },
      async () => {
        const config = await resolveConfig({ home: PUG_CLAW_HOME });
        expect(config.agentsDir).toBe("/tmp/custom-agents");
        // Other paths still default relative to home
        expect(config.skillsDir).toBe(resolve(PUG_CLAW_HOME, "skills"));
        expect(config.internalDir).toBe(resolve(PUG_CLAW_HOME, "internal"));
        expect(config.codeDir).toBe(resolve(PUG_CLAW_HOME, "code"));
        expect(config.logsDir).toBe(resolve(PUG_CLAW_HOME, "logs"));
      },
    ),
  );

  test(
    "individual path overrides via CLI",
    withEnv(cleanEnv, async () => {
      const config = await resolveConfig({
        home: PUG_CLAW_HOME,
        agentsDir: "/tmp/cli-agents",
        internalDir: "/tmp/cli-internal",
        codeDir: "/tmp/cli-code",
        logsDir: "/tmp/cli-logs",
      });
      expect(config.agentsDir).toBe("/tmp/cli-agents");
      expect(config.internalDir).toBe("/tmp/cli-internal");
      expect(config.codeDir).toBe("/tmp/cli-code");
      expect(config.logsDir).toBe("/tmp/cli-logs");
    }),
  );

  test(
    "individual path overrides via env for internal, code, and logs",
    withEnv(
      {
        ...cleanEnv,
        PUG_CLAW_INTERNAL_DIR: "custom-internal",
        PUG_CLAW_CODE_DIR: "/tmp/custom-code",
        PUG_CLAW_LOGS_DIR: "custom-logs",
      },
      async () => {
        const config = await resolveConfig({ home: PUG_CLAW_HOME });
        expect(config.internalDir).toBe(
          resolve(PUG_CLAW_HOME, "custom-internal"),
        );
        expect(config.codeDir).toBe("/tmp/custom-code");
        expect(config.logsDir).toBe(resolve(PUG_CLAW_HOME, "custom-logs"));
      },
    ),
  );

  test(
    "config file path overrides work for internal, code, and logs",
    withEnv(cleanEnv, async () => {
      const tmpDir = makeTmpDir();
      writeFileSync(
        resolve(tmpDir, "config.json"),
        JSON.stringify({
          default_agent: "test-agent",
          default_driver: "claude",
          paths: {
            internal_dir: "runtime",
            code_dir: "projects",
            logs_dir: "var/logs",
          },
        }),
      );
      try {
        const config = await resolveConfig({ home: tmpDir });
        expect(config.internalDir).toBe(resolve(tmpDir, "runtime"));
        expect(config.codeDir).toBe(resolve(tmpDir, "projects"));
        expect(config.logsDir).toBe(resolve(tmpDir, "var/logs"));
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }),
  );

  test(
    "throws when home dir does not exist",
    withEnv(cleanEnv, async () => {
      await expect(
        resolveConfig({ home: "/tmp/nonexistent-pug-claw-xyz" }),
      ).rejects.toThrow("pug-claw init");
    }),
  );

  test(
    "throws when config.json missing from home dir",
    withEnv(cleanEnv, async () => {
      // Use a dir that exists but has no config.json
      const emptyDir = resolve(FIXTURES, "agents");
      await expect(resolveConfig({ home: emptyDir })).rejects.toThrow(
        "pug-claw init",
      );
    }),
  );

  test(
    "invalid config.json throws Zod error",
    withEnv(cleanEnv, async () => {
      const tmpDir = makeTmpDir();
      await Bun.write(
        resolve(tmpDir, "config.json"),
        JSON.stringify({ paths: { agents_dir: 123 } }),
      );
      try {
        await expect(resolveConfig({ home: tmpDir })).rejects.toThrow();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }),
  );

  test(
    "discord section parsed into DiscordIdentity",
    withEnv(cleanEnv, async () => {
      const config = await resolveConfig({ home: PUG_CLAW_HOME });
      expect(config.discord).toEqual({
        guildId: "123456789",
        ownerId: "987654321",
      });
    }),
  );

  test(
    "bot config fields validated",
    withEnv(cleanEnv, async () => {
      const config = await resolveConfig({ home: PUG_CLAW_HOME });
      expect(config.drivers.pi).toEqual({
        defaultModel: "openrouter/minimax/minimax-m2.5",
      });
      expect(config.channels["chan-1"]).toEqual({
        agent: "custom",
        driver: "pi",
      });
    }),
  );

  test(
    "config paths relative to home dir",
    withEnv(cleanEnv, async () => {
      const config = await resolveConfig({ home: PUG_CLAW_HOME });
      expect(config.agentsDir).toBe(resolve(PUG_CLAW_HOME, "agents"));
      expect(config.skillsDir).toBe(resolve(PUG_CLAW_HOME, "skills"));
      expect(config.internalDir).toBe(resolve(PUG_CLAW_HOME, "internal"));
      expect(config.dataDir).toBe(resolve(PUG_CLAW_HOME, "data"));
      expect(config.codeDir).toBe(resolve(PUG_CLAW_HOME, "code"));
      expect(config.logsDir).toBe(resolve(PUG_CLAW_HOME, "logs"));
    }),
  );
});

describe("resolveConfig secrets", () => {
  test(
    "EnvSecretsProvider returns env vars",
    withEnv(cleanEnv, async () => {
      const config = await resolveConfig({ home: PUG_CLAW_HOME });
      // Should read from process.env
      process.env.TEST_KEY_XYZ = "test-value";
      expect(config.secrets.get("TEST_KEY_XYZ")).toBe("test-value");
      delete process.env.TEST_KEY_XYZ;
    }),
  );

  test(
    "SecretsProvider.require throws on missing key",
    withEnv(cleanEnv, async () => {
      const config = await resolveConfig({ home: PUG_CLAW_HOME });
      expect(() =>
        config.secrets.require("DEFINITELY_MISSING_KEY_XYZ"),
      ).toThrow('Required secret "DEFINITELY_MISSING_KEY_XYZ" is not set');
    }),
  );

  test(
    "DotenvSecretsProvider loads .env file",
    withEnv(cleanEnv, async () => {
      const tmpDir = makeTmpDir();
      await Bun.write(
        resolve(tmpDir, "config.json"),
        JSON.stringify({ secrets: { provider: "dotenv" } }),
      );
      await Bun.write(
        resolve(tmpDir, ".env"),
        'DOTENV_TEST=hello\nDOTENV_QUOTED="world"\n',
      );
      try {
        const config = await resolveConfig({ home: tmpDir });
        expect(config.secrets.get("DOTENV_TEST")).toBe("hello");
        expect(config.secrets.get("DOTENV_QUOTED")).toBe("world");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }),
  );

  test(
    "DotenvSecretsProvider supports absolute dotenv_path",
    withEnv(cleanEnv, async () => {
      const tmpDir = makeTmpDir();
      const secretsDir = resolve(tmpDir, "elsewhere");
      mkdirSync(secretsDir, { recursive: true });
      await Bun.write(
        resolve(tmpDir, "config.json"),
        JSON.stringify({
          secrets: {
            provider: "dotenv",
            dotenv_path: resolve(secretsDir, "my.env"),
          },
        }),
      );
      await Bun.write(
        resolve(secretsDir, "my.env"),
        "ABSOLUTE_PATH_TEST=works\n",
      );
      try {
        const config = await resolveConfig({ home: tmpDir });
        expect(config.secrets.get("ABSOLUTE_PATH_TEST")).toBe("works");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }),
  );

  test(
    "DotenvSecretsProvider injects vars into process.env",
    withEnv({ ...cleanEnv, DOTENV_INJECTED_TEST: undefined }, async () => {
      const tmpDir = makeTmpDir();
      await Bun.write(
        resolve(tmpDir, "config.json"),
        JSON.stringify({ secrets: { provider: "dotenv" } }),
      );
      await Bun.write(
        resolve(tmpDir, ".env"),
        "DOTENV_INJECTED_TEST=injected-value\n",
      );
      try {
        await resolveConfig({ home: tmpDir });
        expect(process.env.DOTENV_INJECTED_TEST).toBe("injected-value");
      } finally {
        delete process.env.DOTENV_INJECTED_TEST;
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }),
  );

  test(
    "DotenvSecretsProvider does not overwrite existing process.env",
    withEnv({ ...cleanEnv, DOTENV_EXISTING_TEST: "original" }, async () => {
      const tmpDir = makeTmpDir();
      await Bun.write(
        resolve(tmpDir, "config.json"),
        JSON.stringify({ secrets: { provider: "dotenv" } }),
      );
      await Bun.write(
        resolve(tmpDir, ".env"),
        "DOTENV_EXISTING_TEST=from-file\n",
      );
      try {
        await resolveConfig({ home: tmpDir });
        expect(process.env.DOTENV_EXISTING_TEST).toBe("original");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }),
  );

  test(
    "DotenvSecretsProvider env wins over dotenv file",
    withEnv({ ...cleanEnv, DOTENV_CONFLICT: "from-env" }, async () => {
      const tmpDir = makeTmpDir();
      await Bun.write(
        resolve(tmpDir, "config.json"),
        JSON.stringify({ secrets: { provider: "dotenv" } }),
      );
      await Bun.write(resolve(tmpDir, ".env"), "DOTENV_CONFLICT=from-file\n");
      try {
        const config = await resolveConfig({ home: tmpDir });
        expect(config.secrets.get("DOTENV_CONFLICT")).toBe("from-env");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }),
  );
});

describe("config fallback", () => {
  test(
    "writes config.last-good.json on successful load",
    withEnv(cleanEnv, async () => {
      const tmpDir = makeTmpDir();
      const validConfig = JSON.stringify({ default_agent: "good" });
      writeFileSync(resolve(tmpDir, "config.json"), validConfig);
      try {
        const config = await resolveConfig({ home: tmpDir });
        expect(config.defaultAgent).toBe("good");
        const lastGood = resolve(tmpDir, "config.last-good.json");
        expect(existsSync(lastGood)).toBe(true);
        expect(readFileSync(lastGood, "utf-8")).toBe(validConfig);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }),
  );

  test(
    "falls back to config.last-good.json when config.json is corrupt",
    withEnv(cleanEnv, async () => {
      const tmpDir = makeTmpDir();
      writeFileSync(resolve(tmpDir, "config.json"), "{ bad json }}}");
      writeFileSync(
        resolve(tmpDir, "config.last-good.json"),
        JSON.stringify({ default_agent: "fallback-agent" }),
      );
      try {
        const config = await resolveConfig({ home: tmpDir });
        expect(config.defaultAgent).toBe("fallback-agent");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }),
  );

  test(
    "throws original error when both config.json and fallback fail",
    withEnv(cleanEnv, async () => {
      const tmpDir = makeTmpDir();
      writeFileSync(resolve(tmpDir, "config.json"), "{ bad json }}}");
      writeFileSync(resolve(tmpDir, "config.last-good.json"), "{ also bad }}}");
      try {
        await expect(resolveConfig({ home: tmpDir })).rejects.toThrow();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }),
  );

  test(
    "throws when config.json missing and no fallback exists",
    withEnv(cleanEnv, async () => {
      const tmpDir = makeTmpDir();
      // No config.json and no fallback
      try {
        await expect(resolveConfig({ home: tmpDir })).rejects.toThrow(
          "config.json not found",
        );
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }),
  );
});

describe("getChannelConfig", () => {
  test(
    "returns config for a known channel",
    withEnv(cleanEnv, async () => {
      const config = await resolveConfig({ home: PUG_CLAW_HOME });
      const chan = getChannelConfig(config, "chan-1");
      expect(chan.agent).toBe("custom");
      expect(chan.driver).toBe("pi");
    }),
  );

  test(
    "returns empty object for unknown channel",
    withEnv(cleanEnv, async () => {
      const config = await resolveConfig({ home: PUG_CLAW_HOME });
      const chan = getChannelConfig(config, "unknown");
      expect(chan).toEqual({});
    }),
  );
});
