import { describe, expect, test } from "bun:test";
import {
  createBackupManifest,
  parseBackupManifest,
} from "../../src/backup/manifest.ts";

describe("backup manifest", () => {
  test("createBackupManifest records section inclusion and metadata", () => {
    const manifest = createBackupManifest({
      hostname: "fixture-host",
      createdAt: "2026-03-22T00:00:00.000Z",
      pugClawVersion: "0.1.0",
      sections: {
        home: true,
        internal: true,
        data: true,
        code: false,
        logs: false,
      },
    });

    expect(manifest.format_version).toBe("1");
    expect(manifest.hostname).toBe("fixture-host");
    expect(manifest.sections.data.included).toBe(true);
    expect(manifest.sections.code.included).toBe(false);
  });

  test("parseBackupManifest rejects unknown format versions", () => {
    expect(() =>
      parseBackupManifest({
        format_version: "99",
        pug_claw_version: "0.1.0",
        created_at: "2026-03-22T00:00:00.000Z",
        hostname: "fixture-host",
        sections: {
          home: { included: true },
          internal: { included: true },
          data: { included: false },
          code: { included: false },
          logs: { included: false },
        },
      }),
    ).toThrow('Unsupported backup format version "99"');
  });
});
