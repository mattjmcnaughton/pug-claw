import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { Paths } from "../constants.ts";
import { expandTilde } from "../resources.ts";
import type { ResolvedConfig } from "../resources.ts";
import { createBackupManifest } from "./manifest.ts";
import {
  BACKUP_ARCHIVE_ROOT,
  BackupIncludeDirKeys,
  type BackupDryRunResult,
  type BackupIncludeDirKey,
  type ExportBackupOptions,
  type ExportBackupResult,
  MANIFEST_FILE_NAME,
} from "./types.ts";

function makeStagingDir(): string {
  return mkdtempSync(resolve(tmpdir(), "pug-claw-backup-"));
}

function copyIfExists(sourcePath: string, targetPath: string): void {
  if (!existsSync(sourcePath)) {
    return;
  }
  cpSync(sourcePath, targetPath, { recursive: true });
}

function escapeSqlitePath(path: string): string {
  return path.replaceAll("'", "''");
}

function copyRuntimeDatabase(config: ResolvedConfig, targetPath: string): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  const sourcePath = resolve(config.internalDir, Paths.RUNTIME_DB_FILE);

  if (!existsSync(sourcePath)) {
    const db = new Database(targetPath, { create: true });
    db.close();
    return;
  }

  const db = new Database(sourcePath, { readonly: true });
  try {
    db.run(`VACUUM INTO '${escapeSqlitePath(targetPath)}'`);
  } finally {
    db.close();
  }
}

function createArchive(stagingParentDir: string, outputPath: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  const proc = Bun.spawnSync([
    "tar",
    "-czf",
    outputPath,
    "-C",
    stagingParentDir,
    BACKUP_ARCHIVE_ROOT,
  ]);

  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.toString() || "tar failed to create archive");
  }
}

function toResolvedCliPath(path: string): string {
  return resolve(expandTilde(path));
}

function toOutputPath(
  config: ResolvedConfig,
  outputPath?: string,
  outputDir?: string,
): string {
  if (outputPath && outputDir) {
    throw new Error('Cannot specify both "outputPath" and "outputDir".');
  }

  if (outputPath) {
    return toResolvedCliPath(outputPath);
  }

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const fileName = `pug-claw-backup-${timestamp}.tar.gz`;

  if (outputDir) {
    return resolve(toResolvedCliPath(outputDir), fileName);
  }

  if (config.backupOutputDir) {
    return resolve(config.backupOutputDir, fileName);
  }

  return resolve(fileName);
}

function getIncludedOptionalDirs(
  config: ResolvedConfig,
  includeDirs: BackupIncludeDirKey[] = [],
): Set<BackupIncludeDirKey> {
  return new Set([...config.backupIncludeDirs, ...includeDirs]);
}

function getPathSize(path: string): number {
  if (!existsSync(path)) {
    return 0;
  }

  const stats = statSync(path);
  if (stats.isFile()) {
    return stats.size;
  }

  return readdirSync(path).reduce((total, entry) => {
    return total + getPathSize(resolve(path, entry));
  }, 0);
}

function buildSections(includedDirs: Set<BackupIncludeDirKey>) {
  return {
    home: true,
    internal: true,
    data: includedDirs.has(BackupIncludeDirKeys.DATA_DIR),
    code: includedDirs.has(BackupIncludeDirKeys.CODE_DIR),
    logs: includedDirs.has(BackupIncludeDirKeys.LOGS_DIR),
  };
}

function stageHome(config: ResolvedConfig, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true });
  copyIfExists(
    resolve(config.homeDir, Paths.CONFIG_FILE),
    resolve(targetDir, Paths.CONFIG_FILE),
  );
  copyIfExists(
    resolve(config.homeDir, Paths.CONFIG_FALLBACK_FILE),
    resolve(targetDir, Paths.CONFIG_FALLBACK_FILE),
  );
  copyIfExists(config.agentsDir, resolve(targetDir, Paths.AGENTS_DIR));
  copyIfExists(config.skillsDir, resolve(targetDir, Paths.SKILLS_DIR));
}

function stageOptionalDir(
  sourcePath: string,
  targetPath: string,
  included: boolean,
): void {
  if (!included) {
    return;
  }

  if (!existsSync(sourcePath)) {
    mkdirSync(targetPath, { recursive: true });
    return;
  }

  cpSync(sourcePath, targetPath, { recursive: true });
}

export function dryRunBackup(
  config: ResolvedConfig,
  options: ExportBackupOptions = {},
): BackupDryRunResult {
  const includedDirs = getIncludedOptionalDirs(config, options.includeDirs);
  const sections = buildSections(includedDirs);
  const sectionDetails = [
    {
      name: "home" as const,
      path: config.homeDir,
      included: true,
      sizeBytes:
        getPathSize(resolve(config.homeDir, Paths.CONFIG_FILE)) +
        getPathSize(resolve(config.homeDir, Paths.CONFIG_FALLBACK_FILE)) +
        getPathSize(config.agentsDir) +
        getPathSize(config.skillsDir),
    },
    {
      name: "internal" as const,
      path: config.internalDir,
      included: true,
      sizeBytes: getPathSize(
        resolve(config.internalDir, Paths.RUNTIME_DB_FILE),
      ),
    },
    {
      name: "data" as const,
      path: config.dataDir,
      included: sections.data,
      sizeBytes: sections.data ? getPathSize(config.dataDir) : 0,
    },
    {
      name: "code" as const,
      path: config.codeDir,
      included: sections.code,
      sizeBytes: sections.code ? getPathSize(config.codeDir) : 0,
    },
    {
      name: "logs" as const,
      path: config.logsDir,
      included: sections.logs,
      sizeBytes: sections.logs ? getPathSize(config.logsDir) : 0,
    },
  ];

  return {
    sections: sectionDetails,
    totalSizeBytes: sectionDetails.reduce((total, section) => {
      return total + section.sizeBytes;
    }, 0),
  };
}

export async function exportBackup(
  config: ResolvedConfig,
  options: ExportBackupOptions = {},
): Promise<ExportBackupResult> {
  const outputPath = toOutputPath(
    config,
    options.outputPath,
    options.outputDir,
  );
  const includedDirs = getIncludedOptionalDirs(config, options.includeDirs);
  const sections = buildSections(includedDirs);
  const stagingParentDir = makeStagingDir();
  const stagingRootDir = resolve(stagingParentDir, BACKUP_ARCHIVE_ROOT);

  try {
    mkdirSync(stagingRootDir, { recursive: true });

    stageHome(config, resolve(stagingRootDir, "home"));
    copyRuntimeDatabase(
      config,
      resolve(stagingRootDir, "internal", Paths.RUNTIME_DB_FILE),
    );
    stageOptionalDir(
      config.dataDir,
      resolve(stagingRootDir, "data"),
      sections.data,
    );
    stageOptionalDir(
      config.codeDir,
      resolve(stagingRootDir, "code"),
      sections.code,
    );
    stageOptionalDir(
      config.logsDir,
      resolve(stagingRootDir, "logs"),
      sections.logs,
    );

    const manifest = createBackupManifest({ sections });
    writeFileSync(
      resolve(stagingRootDir, MANIFEST_FILE_NAME),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    createArchive(stagingParentDir, outputPath);

    return {
      outputPath,
      sizeBytes: statSync(outputPath).size,
      sections,
    };
  } finally {
    rmSync(stagingParentDir, { recursive: true, force: true });
  }
}
