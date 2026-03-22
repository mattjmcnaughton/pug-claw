import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { Paths } from "../constants.ts";
import type { ResolvedConfig } from "../resources.ts";
import { createBackupManifest } from "./manifest.ts";
import {
  BACKUP_ARCHIVE_ROOT,
  BackupIncludeDirKeys,
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

function toOutputPath(outputPath?: string): string {
  if (outputPath) {
    return resolve(outputPath);
  }

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return resolve(`pug-claw-backup-${timestamp}.tar.gz`);
}

function getIncludedOptionalDirs(
  config: ResolvedConfig,
  includeDirs: BackupIncludeDirKey[] = [],
): Set<BackupIncludeDirKey> {
  return new Set([...config.backupIncludeDirs, ...includeDirs]);
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

export async function exportBackup(
  config: ResolvedConfig,
  options: ExportBackupOptions = {},
): Promise<ExportBackupResult> {
  const outputPath = toOutputPath(options.outputPath);
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
