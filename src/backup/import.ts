import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { ensureResolvedHomeLayout } from "../layout.ts";
import {
  loadAndValidateConfig,
  resolveConfig,
  resolveConfigPaths,
  expandTilde,
} from "../resources.ts";
import { EnvVars, Paths } from "../constants.ts";
import { installBuiltins } from "../commands/init.ts";
import { parseBackupManifest } from "./manifest.ts";
import {
  BACKUP_ARCHIVE_ROOT,
  MANIFEST_FILE_NAME,
  type BackupSectionsSummary,
} from "./types.ts";

export interface ImportBackupOptions {
  archivePath: string;
  dryRun?: boolean | undefined;
  force?: boolean | undefined;
  homeDir?: string | undefined;
}

export interface ImportBackupResult {
  dryRun: boolean;
  existingTargets: string[];
  sections: BackupSectionsSummary;
  targetHomeDir: string;
}

function makeExtractDir(): string {
  return mkdtempSync(resolve(tmpdir(), "pug-claw-import-"));
}

function extractArchive(archivePath: string): string {
  const extractDir = makeExtractDir();
  const proc = Bun.spawnSync(["tar", "-xzf", archivePath, "-C", extractDir]);

  if (proc.exitCode !== 0) {
    rmSync(extractDir, { recursive: true, force: true });
    throw new Error(proc.stderr.toString() || "tar failed to extract archive");
  }

  return extractDir;
}

function resolveTargetHomeDir(homeDir?: string): string {
  const rawHome = homeDir ?? process.env[EnvVars.HOME] ?? Paths.DEFAULT_HOME;
  return resolve(expandTilde(rawHome));
}

function getExistingTargets(targets: string[]): string[] {
  return targets.filter((target) => existsSync(target));
}

function ensureNoSchedulerLock(
  targetInternalDir: string,
  targetHomeDir: string,
): void {
  const lockDirs = [
    resolve(targetInternalDir, Paths.LOCKS_DIR, Paths.SCHEDULER_LOCK_DIR),
    resolve(
      targetHomeDir,
      Paths.DATA_DIR,
      Paths.LOCKS_DIR,
      Paths.SCHEDULER_LOCK_DIR,
    ),
  ];

  if (lockDirs.some((lockDir) => existsSync(lockDir))) {
    throw new Error(
      "Import requires pug-claw to be stopped first (scheduler lock detected).",
    );
  }
}

function restorePath(sourcePath: string, targetPath: string): void {
  if (!existsSync(sourcePath)) {
    return;
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath, { recursive: true });
}

export async function importBackup(
  options: ImportBackupOptions,
): Promise<ImportBackupResult> {
  const archivePath = resolve(options.archivePath);
  const targetHomeDir = resolveTargetHomeDir(options.homeDir);
  const extractDir = extractArchive(archivePath);

  try {
    const archiveRoot = resolve(extractDir, BACKUP_ARCHIVE_ROOT);
    const manifest = parseBackupManifest(
      JSON.parse(
        readFileSync(resolve(archiveRoot, MANIFEST_FILE_NAME), "utf-8"),
      ),
    );
    const rawConfig = loadAndValidateConfig(
      resolve(archiveRoot, "home", Paths.CONFIG_FILE),
    );
    const resolvedPaths = resolveConfigPaths(targetHomeDir, rawConfig);

    ensureNoSchedulerLock(resolvedPaths.internalDir, targetHomeDir);

    const sections: BackupSectionsSummary = {
      home: manifest.sections.home.included,
      internal: manifest.sections.internal.included,
      data: manifest.sections.data.included,
      code: manifest.sections.code.included,
      logs: manifest.sections.logs.included,
    };

    const existingTargets = getExistingTargets([
      resolve(targetHomeDir, Paths.CONFIG_FILE),
      resolve(targetHomeDir, Paths.CONFIG_FALLBACK_FILE),
      resolvedPaths.agentsDir,
      resolvedPaths.skillsDir,
      resolvedPaths.internalDir,
      ...(sections.data ? [resolvedPaths.dataDir] : []),
      ...(sections.code ? [resolvedPaths.codeDir] : []),
      ...(sections.logs ? [resolvedPaths.logsDir] : []),
    ]);

    if (options.dryRun) {
      return {
        dryRun: true,
        existingTargets,
        sections,
        targetHomeDir,
      };
    }

    if (existingTargets.length > 0 && !options.force) {
      throw new Error(
        "Import would overwrite existing files. Re-run with --force or use --dry-run to inspect the archive.",
      );
    }

    for (const target of existingTargets) {
      rmSync(target, { recursive: true, force: true });
    }

    restorePath(
      resolve(archiveRoot, "home", Paths.CONFIG_FILE),
      resolve(targetHomeDir, Paths.CONFIG_FILE),
    );
    restorePath(
      resolve(archiveRoot, "home", Paths.CONFIG_FALLBACK_FILE),
      resolve(targetHomeDir, Paths.CONFIG_FALLBACK_FILE),
    );
    restorePath(
      resolve(archiveRoot, "home", Paths.AGENTS_DIR),
      resolvedPaths.agentsDir,
    );
    restorePath(
      resolve(archiveRoot, "home", Paths.SKILLS_DIR),
      resolvedPaths.skillsDir,
    );
    restorePath(resolve(archiveRoot, "internal"), resolvedPaths.internalDir);

    if (sections.data) {
      restorePath(resolve(archiveRoot, "data"), resolvedPaths.dataDir);
    }
    if (sections.code) {
      restorePath(resolve(archiveRoot, "code"), resolvedPaths.codeDir);
    }
    if (sections.logs) {
      restorePath(resolve(archiveRoot, "logs"), resolvedPaths.logsDir);
    }

    const restoredConfig = await resolveConfig({ home: targetHomeDir });
    ensureResolvedHomeLayout(restoredConfig);
    installBuiltins(targetHomeDir);

    return {
      dryRun: false,
      existingTargets,
      sections,
      targetHomeDir,
    };
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
}
