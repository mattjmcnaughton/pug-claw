import { hostname } from "node:os";
import { VERSION } from "../constants.ts";
import {
  BACKUP_FORMAT_VERSION,
  BackupManifestSchema,
  type BackupManifest,
  type CreateBackupManifestOptions,
} from "./types.ts";

export function createBackupManifest(
  options: CreateBackupManifestOptions,
): BackupManifest {
  return {
    format_version: BACKUP_FORMAT_VERSION,
    pug_claw_version: options.pugClawVersion ?? VERSION,
    created_at: options.createdAt ?? new Date().toISOString(),
    hostname: options.hostname ?? hostname(),
    sections: {
      home: { included: options.sections.home },
      internal: { included: options.sections.internal },
      data: { included: options.sections.data },
      code: { included: options.sections.code },
      logs: { included: options.sections.logs },
    },
  };
}

export function parseBackupManifest(input: unknown): BackupManifest {
  const manifest = BackupManifestSchema.parse(input);
  if (manifest.format_version !== BACKUP_FORMAT_VERSION) {
    throw new Error(
      `Unsupported backup format version "${manifest.format_version}"`,
    );
  }
  return manifest;
}
