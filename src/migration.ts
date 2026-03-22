import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Paths } from "./constants.ts";
import type { Logger } from "./logger.ts";
import type { ResolvedConfig } from "./resources.ts";

function movePathIfPresent(
  fromPath: string,
  toPath: string,
  logger: Logger,
  eventTag: string,
): void {
  if (!existsSync(fromPath) || existsSync(toPath)) {
    return;
  }

  mkdirSync(dirname(toPath), { recursive: true });
  renameSync(fromPath, toPath);
  logger.info({ from: fromPath, to: toPath }, eventTag);
}

export function ensureResolvedHomeLayout(config: ResolvedConfig): void {
  mkdirSync(config.agentsDir, { recursive: true });
  mkdirSync(config.skillsDir, { recursive: true });
  mkdirSync(config.internalDir, { recursive: true });
  mkdirSync(resolve(config.internalDir, Paths.PLUGINS_DIR), {
    recursive: true,
  });
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.codeDir, { recursive: true });
  mkdirSync(resolve(config.logsDir, Paths.SYSTEM_LOG_DIR), { recursive: true });
  mkdirSync(resolve(config.logsDir, Paths.SCHEDULES_LOG_DIR), {
    recursive: true,
  });
}

export function migrateLegacyHomeLayout(
  config: ResolvedConfig,
  logger: Logger,
): void {
  mkdirSync(config.internalDir, { recursive: true });

  movePathIfPresent(
    resolve(config.homeDir, Paths.DATA_DIR, Paths.RUNTIME_DB_FILE),
    resolve(config.internalDir, Paths.RUNTIME_DB_FILE),
    logger,
    "runtime_db_migrated",
  );
  movePathIfPresent(
    resolve(config.homeDir, Paths.DATA_DIR, `${Paths.RUNTIME_DB_FILE}-wal`),
    resolve(config.internalDir, `${Paths.RUNTIME_DB_FILE}-wal`),
    logger,
    "runtime_db_wal_migrated",
  );
  movePathIfPresent(
    resolve(config.homeDir, Paths.DATA_DIR, `${Paths.RUNTIME_DB_FILE}-shm`),
    resolve(config.internalDir, `${Paths.RUNTIME_DB_FILE}-shm`),
    logger,
    "runtime_db_shm_migrated",
  );
  movePathIfPresent(
    resolve(config.homeDir, Paths.DATA_DIR, Paths.LOCKS_DIR),
    resolve(config.internalDir, Paths.LOCKS_DIR),
    logger,
    "scheduler_locks_migrated",
  );
  movePathIfPresent(
    resolve(config.homeDir, Paths.PLUGINS_DIR),
    resolve(config.internalDir, Paths.PLUGINS_DIR),
    logger,
    "plugins_dir_migrated",
  );
}
