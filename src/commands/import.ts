import * as p from "@clack/prompts";
import { importBackup } from "../backup/import.ts";
import { toError } from "../resources.ts";

export async function runImportCommand(opts: {
  dryRun?: boolean;
  force?: boolean;
  home?: string;
  path: string;
}): Promise<void> {
  try {
    const inspection = await importBackup({
      archivePath: opts.path,
      homeDir: opts.home,
      dryRun: true,
    });

    const summary = [
      `Target home: ${inspection.targetHomeDir}`,
      `Existing targets: ${inspection.existingTargets.length}`,
      `Included sections: home=${inspection.sections.home} internal=${inspection.sections.internal} data=${inspection.sections.data} code=${inspection.sections.code} logs=${inspection.sections.logs}`,
    ].join("\n");

    if (opts.dryRun) {
      console.log(summary);
      return;
    }

    if (inspection.existingTargets.length > 0 && !opts.force) {
      const confirmed = await p.confirm({
        message: `Import will overwrite ${inspection.existingTargets.length} existing target(s). Continue?`,
        initialValue: false,
      });

      if (p.isCancel(confirmed) || !confirmed) {
        p.cancel("Import cancelled.");
        process.exit(0);
      }
    }

    const result = await importBackup({
      archivePath: opts.path,
      homeDir: opts.home,
      force: true,
    });

    console.log(`Backup restored to: ${result.targetHomeDir}`);
    console.log(summary);
  } catch (err) {
    const error = toError(err);
    console.error(`Backup import failed: ${error.message}`);
    process.exit(1);
  }
}
