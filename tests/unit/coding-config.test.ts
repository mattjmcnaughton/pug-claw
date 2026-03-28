import { describe, expect, test } from "bun:test";
import { CodingDefaults } from "../../src/constants.ts";
import {
  CodingConfigSchema,
  parseCodingConfig,
  substituteEnvVars,
  substituteEnvVarsInConfig,
} from "../../src/coding/config.ts";

// Helper to build "${VAR}" strings without triggering Biome's noTemplateCurlyInString
function envRef(name: string): string {
  return "$" + "{" + name + "}";
}

function envFrom(
  vars: Record<string, string>,
): (key: string) => string | undefined {
  return (key) => vars[key];
}

describe("CodingConfigSchema", () => {
  test("parses valid config with all fields", () => {
    const result = CodingConfigSchema.parse({
      vm_host: "coding-vm.tail1234.ts.net",
      ssh_user: "pug-claw",
      default_agent: "codex",
      repos: { "pug-claw": "/home/pug-claw/repos/pug-claw" },
      poll_interval_seconds: 10,
      task_timeout_minutes: 60,
    });
    expect(result.vm_host).toBe("coding-vm.tail1234.ts.net");
    expect(result.ssh_user).toBe("pug-claw");
    expect(result.default_agent).toBe("codex");
    expect(result.repos).toEqual({
      "pug-claw": "/home/pug-claw/repos/pug-claw",
    });
    expect(result.poll_interval_seconds).toBe(10);
    expect(result.task_timeout_minutes).toBe(60);
  });

  test("parses minimal config with only required fields", () => {
    const result = CodingConfigSchema.parse({
      vm_host: "my-vm",
      ssh_user: "user",
    });
    expect(result.vm_host).toBe("my-vm");
    expect(result.ssh_user).toBe("user");
    expect(result.default_agent).toBeUndefined();
    expect(result.repos).toBeUndefined();
  });

  test("rejects config missing vm_host", () => {
    expect(() => CodingConfigSchema.parse({ ssh_user: "user" })).toThrow();
  });

  test("rejects config missing ssh_user", () => {
    expect(() => CodingConfigSchema.parse({ vm_host: "host" })).toThrow();
  });

  test("rejects empty vm_host", () => {
    expect(() =>
      CodingConfigSchema.parse({ vm_host: "", ssh_user: "user" }),
    ).toThrow();
  });

  test("rejects empty ssh_user", () => {
    expect(() =>
      CodingConfigSchema.parse({ vm_host: "host", ssh_user: "" }),
    ).toThrow();
  });

  test("rejects negative poll_interval_seconds", () => {
    expect(() =>
      CodingConfigSchema.parse({
        vm_host: "host",
        ssh_user: "user",
        poll_interval_seconds: -1,
      }),
    ).toThrow();
  });

  test("rejects zero poll_interval_seconds", () => {
    expect(() =>
      CodingConfigSchema.parse({
        vm_host: "host",
        ssh_user: "user",
        poll_interval_seconds: 0,
      }),
    ).toThrow();
  });

  test("rejects non-integer poll_interval_seconds", () => {
    expect(() =>
      CodingConfigSchema.parse({
        vm_host: "host",
        ssh_user: "user",
        poll_interval_seconds: 1.5,
      }),
    ).toThrow();
  });

  test("rejects negative task_timeout_minutes", () => {
    expect(() =>
      CodingConfigSchema.parse({
        vm_host: "host",
        ssh_user: "user",
        task_timeout_minutes: -1,
      }),
    ).toThrow();
  });

  test("rejects unknown fields (strict mode)", () => {
    expect(() =>
      CodingConfigSchema.parse({
        vm_host: "host",
        ssh_user: "user",
        bogus_field: "oops",
      }),
    ).toThrow();
  });
});

describe("substituteEnvVars", () => {
  test("replaces env var reference with value", () => {
    const result = substituteEnvVars(
      envRef("MY_HOST"),
      envFrom({ MY_HOST: "coding-vm" }),
    );
    expect(result).toBe("coding-vm");
  });

  test("replaces multiple env var references in one string", () => {
    const result = substituteEnvVars(
      `${envRef("USER")}@${envRef("HOST")}`,
      envFrom({ USER: "pug", HOST: "vm" }),
    );
    expect(result).toBe("pug@vm");
  });

  test("throws on missing env var", () => {
    expect(() => substituteEnvVars(envRef("MISSING"), envFrom({}))).toThrow(
      'Environment variable "MISSING" is not set',
    );
  });

  test("leaves strings without env var references unchanged", () => {
    const result = substituteEnvVars("plain-string", envFrom({}));
    expect(result).toBe("plain-string");
  });

  test("handles empty string", () => {
    const result = substituteEnvVars("", envFrom({}));
    expect(result).toBe("");
  });

  test("handles env var references at start, middle, and end", () => {
    const lookup = envFrom({ A: "1", B: "2", C: "3" });
    expect(
      substituteEnvVars(
        `${envRef("A")}-mid-${envRef("B")}-end-${envRef("C")}`,
        lookup,
      ),
    ).toBe("1-mid-2-end-3");
  });

  test("does not substitute $VAR (no braces)", () => {
    const result = substituteEnvVars("$MY_HOST", envFrom({ MY_HOST: "vm" }));
    expect(result).toBe("$MY_HOST");
  });

  test("does not substitute empty braces", () => {
    const empty = "$" + "{}";
    const result = substituteEnvVars(empty, envFrom({}));
    expect(result).toBe(empty);
  });

  test("uses injectable envLookup", () => {
    const custom = (key: string) => (key === "X" ? "found" : undefined);
    expect(substituteEnvVars(envRef("X"), custom)).toBe("found");
    expect(() => substituteEnvVars(envRef("Y"), custom)).toThrow();
  });
});

describe("substituteEnvVarsInConfig", () => {
  test("substitutes string values in nested objects", () => {
    const result = substituteEnvVarsInConfig(
      { outer: { inner: envRef("VAL") } },
      envFrom({ VAL: "resolved" }),
    );
    expect(result).toEqual({ outer: { inner: "resolved" } });
  });

  test("leaves non-string values unchanged", () => {
    const result = substituteEnvVarsInConfig(
      { num: 42, bool: true, nul: null },
      envFrom({}),
    );
    expect(result).toEqual({ num: 42, bool: true, nul: null });
  });

  test("substitutes in repos record values", () => {
    const result = substituteEnvVarsInConfig(
      { repos: { app: `/home/${envRef("USER")}/repos/app` } },
      envFrom({ USER: "pug" }),
    );
    expect(result).toEqual({ repos: { app: "/home/pug/repos/app" } });
  });

  test("handles empty object", () => {
    const result = substituteEnvVarsInConfig({}, envFrom({}));
    expect(result).toEqual({});
  });
});

describe("parseCodingConfig", () => {
  test("parses valid config with env var substitution", () => {
    const config = parseCodingConfig(
      {
        vm_host: envRef("VM_HOST"),
        ssh_user: envRef("VM_USER"),
        default_agent: "codex",
      },
      envFrom({ VM_HOST: "coding-vm", VM_USER: "pug" }),
    );
    expect(config.vmHost).toBe("coding-vm");
    expect(config.sshUser).toBe("pug");
    expect(config.defaultAgent).toBe("codex");
  });

  test("applies defaults after substitution", () => {
    const config = parseCodingConfig(
      { vm_host: "host", ssh_user: "user" },
      envFrom({}),
    );
    expect(config.defaultAgent).toBe(CodingDefaults.AGENT);
    expect(config.repos).toEqual({});
    expect(config.pollIntervalSeconds).toBe(
      CodingDefaults.POLL_INTERVAL_SECONDS,
    );
    expect(config.taskTimeoutMinutes).toBe(CodingDefaults.TASK_TIMEOUT_MINUTES);
  });

  test("throws on missing env var in vm_host", () => {
    expect(() =>
      parseCodingConfig(
        { vm_host: envRef("MISSING"), ssh_user: "user" },
        envFrom({}),
      ),
    ).toThrow('Environment variable "MISSING" is not set');
  });

  test("throws Zod error after substitution produces invalid value", () => {
    expect(() =>
      parseCodingConfig(
        { vm_host: envRef("EMPTY"), ssh_user: "user" },
        envFrom({ EMPTY: "" }),
      ),
    ).toThrow();
  });

  test("full round-trip: raw input with env vars -> CodingConfig", () => {
    const config = parseCodingConfig(
      {
        vm_host: envRef("HOST"),
        ssh_user: envRef("USER"),
        default_agent: "claude",
        repos: { app: `/home/${envRef("USER")}/repos/app` },
        poll_interval_seconds: 20,
        task_timeout_minutes: 45,
      },
      envFrom({ HOST: "my-vm.ts.net", USER: "deployer" }),
    );
    expect(config).toEqual({
      vmHost: "my-vm.ts.net",
      sshUser: "deployer",
      defaultAgent: "claude",
      repos: { app: "/home/deployer/repos/app" },
      pollIntervalSeconds: 20,
      taskTimeoutMinutes: 45,
    });
  });
});
