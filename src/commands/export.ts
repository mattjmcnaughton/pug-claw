import { logger } from "../logger.ts";
import {
  ensureResolvedHomeLayout,
  migrateLegacyHomeLayout,
} from "../migration.ts";
import { resolveConfig, toError } from "../resources.ts";
import { exportBackup } from "../backup/export.ts";
import {
  BackupCliIncludeNames,
  BackupIncludeDirKeys,
  type BackupIncludeDirKey,
} from "../backup/types.ts";

function parseIncludeDir(value: string): BackupIncludeDirKey {
  const normalized = value.trim().toLowerCase();
  if (normalized === BackupCliIncludeNames.DATA) {
    return BackupIncludeDirKeys.DATA_DIR;
  }
  if (normalized === BackupCliIncludeNames.CODE) {
    return BackupIncludeDirKeys.CODE_DIR;
  }
  if (normalized === BackupCliIncludeNames.LOGS) {
    return BackupIncludeDirKeys.LOGS_DIR;
  }
  throw new Error(
    `Unknown --include value "${value}". Expected one of: data, code, logs.`,
  );
}

export async function runExportCommand(opts: {
  home?: string;
  include?: string[];
  output?: string;
}): Promise<void> {
  try {
    const config = await resolveConfig({ home: opts.home });
    migrateLegacyHomeLayout(config, logger);
    ensureResolvedHomeLayout(config);

    const result = await exportBackup(config, {
      outputPath: opts.output,
      includeDirs: (opts.include ?? []).map(parseIncludeDir),
    });

    console.log(`Backup written: ${result.outputPath}`);
    console.log(`Archive size: ${result.sizeBytes} bytes`);
    console.log(
      `Included: home=${result.sections.home} internal=${result.sections.internal} data=${result.sections.data} code=${result.sections.code} logs=${result.sections.logs}`,
    );
  } catch (err) {
    const error = toError(err);
    console.error(`Backup export failed: ${error.message}`);
    process.exit(1);
  }
}
