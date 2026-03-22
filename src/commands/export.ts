import { exportBackup } from "../backup/export.ts";
import { renderBackupExportMessage } from "../backup/render.ts";
import { resolveConfig, toError } from "../resources.ts";
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
  outputDir?: string;
}): Promise<void> {
  try {
    const config = await resolveConfig({ home: opts.home });

    const result = await exportBackup(config, {
      outputPath: opts.output,
      outputDir: opts.outputDir,
      includeDirs: (opts.include ?? []).map(parseIncludeDir),
    });

    console.log(renderBackupExportMessage(result));
  } catch (err) {
    const error = toError(err);
    console.error(`Backup export failed: ${error.message}`);
    process.exit(1);
  }
}
