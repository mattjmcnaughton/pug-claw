#!/usr/bin/env bun
import {
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { EnvVars, Paths } from "../../src/constants.ts";
import { ensureResolvedHomeLayout } from "../../src/layout.ts";
import { logger } from "../../src/logger.ts";
import { expandTilde, resolveConfig, toError } from "../../src/resources.ts";

export interface PlannedMove {
  from: string;
  to: string;
  action: "move" | "skip_missing" | "create_dir";
}

export interface MigrateHomeLayoutOptions {
  dryRun?: boolean;
  force?: boolean;
  homeDir?: string;
}

export interface MigrateHomeLayoutResult {
  homeDir: string;
  performed: boolean;
  moves: PlannedMove[];
}

function resolveTargetHome(homeDir?: string): string {
  const rawHome = homeDir ?? process.env[EnvVars.HOME] ?? Paths.DEFAULT_HOME;
  return resolve(expandTilde(rawHome));
}

function moveAcrossFilesystems(fromPath: string, toPath: string): void {
  cpSync(fromPath, toPath, { recursive: true });
  const stats = statSync(fromPath);
  if (stats.isDirectory()) {
    rmSync(fromPath, { recursive: true, force: true });
    return;
  }
  rmSync(fromPath, { force: true });
}

function movePath(fromPath: string, toPath: string, force: boolean): void {
  if (!existsSync(fromPath)) {
    return;
  }

  if (existsSync(toPath)) {
    if (!force) {
      throw new Error(
        `Refusing to overwrite existing destination: ${toPath}. Re-run with --force if you want to replace it.`,
      );
    }
    rmSync(toPath, { recursive: true, force: true });
  }

  mkdirSync(dirname(toPath), { recursive: true });

  try {
    renameSync(fromPath, toPath);
  } catch (err) {
    const error = toError(err) as NodeJS.ErrnoException;
    if (error.code !== "EXDEV") {
      throw error;
    }
    moveAcrossFilesystems(fromPath, toPath);
  }
}

export async function migrateHomeLayout(
  options: MigrateHomeLayoutOptions = {},
): Promise<MigrateHomeLayoutResult> {
  const homeDir = resolveTargetHome(options.homeDir);
  const config = await resolveConfig({ home: homeDir });
  const moves: PlannedMove[] = [];
  const plannedMoves = [
    {
      from: resolve(config.homeDir, Paths.DATA_DIR, Paths.RUNTIME_DB_FILE),
      to: resolve(config.internalDir, Paths.RUNTIME_DB_FILE),
    },
    {
      from: resolve(
        config.homeDir,
        Paths.DATA_DIR,
        `${Paths.RUNTIME_DB_FILE}-wal`,
      ),
      to: resolve(config.internalDir, `${Paths.RUNTIME_DB_FILE}-wal`),
    },
    {
      from: resolve(
        config.homeDir,
        Paths.DATA_DIR,
        `${Paths.RUNTIME_DB_FILE}-shm`,
      ),
      to: resolve(config.internalDir, `${Paths.RUNTIME_DB_FILE}-shm`),
    },
    {
      from: resolve(config.homeDir, Paths.DATA_DIR, Paths.LOCKS_DIR),
      to: resolve(config.internalDir, Paths.LOCKS_DIR),
    },
    {
      from: resolve(config.homeDir, Paths.PLUGINS_DIR),
      to: resolve(config.internalDir, Paths.PLUGINS_DIR),
    },
  ];

  for (const planned of plannedMoves) {
    moves.push({
      from: planned.from,
      to: planned.to,
      action: existsSync(planned.from) ? "move" : "skip_missing",
    });
  }

  const requiredDirs = [
    config.internalDir,
    config.dataDir,
    config.codeDir,
    resolve(config.logsDir, Paths.SYSTEM_LOG_DIR),
    resolve(config.logsDir, Paths.SCHEDULES_LOG_DIR),
  ];

  for (const dir of requiredDirs) {
    moves.push({ from: dir, to: dir, action: "create_dir" });
  }

  if (options.dryRun) {
    return {
      homeDir,
      performed: false,
      moves,
    };
  }

  mkdirSync(config.internalDir, { recursive: true });

  for (const planned of plannedMoves) {
    movePath(planned.from, planned.to, options.force ?? false);
  }

  ensureResolvedHomeLayout(config);

  return {
    homeDir,
    performed: true,
    moves,
  };
}

function formatMove(move: PlannedMove): string {
  if (move.action === "create_dir") {
    return `mkdir ${move.to}`;
  }
  if (move.action === "skip_missing") {
    return `skip  ${move.from}`;
  }
  return `move  ${move.from} -> ${move.to}`;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const force = args.has("--force");
  const homeIndex = process.argv.indexOf("--home");
  const homeDir = homeIndex >= 0 ? process.argv[homeIndex + 1] : undefined;

  if (homeIndex >= 0 && !homeDir) {
    throw new Error("Missing value for --home");
  }

  const result = await migrateHomeLayout({
    dryRun,
    force,
    homeDir,
  });

  console.log(`Home: ${result.homeDir}`);
  console.log(dryRun ? "Mode: dry-run" : "Mode: apply");
  for (const move of result.moves) {
    console.log(formatMove(move));
  }
  console.log(dryRun ? "No changes made." : "Migration complete.");
}

if (import.meta.main) {
  main().catch((err) => {
    const error = toError(err);
    logger.error({ err: error }, "one_off_home_layout_migration_failed");
    console.error(`Migration failed: ${error.message}`);
    process.exit(1);
  });
}
