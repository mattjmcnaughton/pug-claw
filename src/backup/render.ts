import type { BackupDryRunResult, ExportBackupResult } from "./types.ts";

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

export function renderBackupExportMessage(result: ExportBackupResult): string {
  return [
    `Backup written to \`${result.outputPath}\`.`,
    `Archive size: ${formatBytes(result.sizeBytes)}`,
    `Included: home=${result.sections.home} internal=${result.sections.internal} data=${result.sections.data} code=${result.sections.code} logs=${result.sections.logs}`,
  ].join("\n");
}

export function renderBackupDryRunMessage(result: BackupDryRunResult): string {
  const lines = ["**Backup dry run**"];

  for (const section of result.sections) {
    lines.push(
      `- \`${section.name}\` — included=${section.included} — ${section.path} — ${formatBytes(section.sizeBytes)}`,
    );
  }

  lines.push(`Total estimated size: ${formatBytes(result.totalSizeBytes)}`);
  return lines.join("\n");
}
