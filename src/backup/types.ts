import { z } from "zod";

export const BACKUP_FORMAT_VERSION = "1";
export const BACKUP_ARCHIVE_ROOT = "pug-claw-backup";
export const MANIFEST_FILE_NAME = "manifest.json";

export const BackupIncludeDirKeys = {
  DATA_DIR: "data_dir",
  CODE_DIR: "code_dir",
  LOGS_DIR: "logs_dir",
} as const;

export type BackupIncludeDirKey =
  (typeof BackupIncludeDirKeys)[keyof typeof BackupIncludeDirKeys];

export const BackupCliIncludeNames = {
  DATA: "data",
  CODE: "code",
  LOGS: "logs",
} as const;

export type BackupCliIncludeName =
  (typeof BackupCliIncludeNames)[keyof typeof BackupCliIncludeNames];

export const BackupIncludeDirKeySchema = z.enum([
  BackupIncludeDirKeys.DATA_DIR,
  BackupIncludeDirKeys.CODE_DIR,
  BackupIncludeDirKeys.LOGS_DIR,
]);

export const BackupManifestSchema = z
  .object({
    format_version: z.string().min(1),
    pug_claw_version: z.string().min(1),
    created_at: z.string().datetime(),
    hostname: z.string().min(1),
    sections: z
      .object({
        home: z.object({ included: z.boolean() }).strict(),
        internal: z.object({ included: z.boolean() }).strict(),
        data: z.object({ included: z.boolean() }).strict(),
        code: z.object({ included: z.boolean() }).strict(),
        logs: z.object({ included: z.boolean() }).strict(),
      })
      .strict(),
  })
  .strict();

export type BackupManifest = z.infer<typeof BackupManifestSchema>;

export interface BackupSectionsSummary {
  home: boolean;
  internal: boolean;
  data: boolean;
  code: boolean;
  logs: boolean;
}

export interface CreateBackupManifestOptions {
  createdAt?: string | undefined;
  hostname?: string | undefined;
  pugClawVersion?: string | undefined;
  sections: BackupSectionsSummary;
}

export interface ExportBackupOptions {
  includeDirs?: BackupIncludeDirKey[] | undefined;
  outputPath?: string | undefined;
  outputDir?: string | undefined;
}

export interface ExportBackupResult {
  outputPath: string;
  sizeBytes: number;
  sections: BackupSectionsSummary;
}

export interface BackupDryRunSection {
  included: boolean;
  name: "home" | "internal" | "data" | "code" | "logs";
  path: string;
  sizeBytes: number;
}

export interface BackupDryRunResult {
  sections: BackupDryRunSection[];
  totalSizeBytes: number;
}
