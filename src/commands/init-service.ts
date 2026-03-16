import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { userInfo } from "node:os";
import * as p from "@clack/prompts";
import { EnvVars, Paths } from "../constants.ts";

export async function runInitService(): Promise<void> {
  p.intro("pug-claw init-service");

  const detectedUser = userInfo().username;
  const detectedBun = process.execPath;
  const mainScript = resolve(import.meta.dir, "../main.ts");

  const user = await p.text({
    message: "Service user?",
    initialValue: detectedUser,
    validate: (val) => {
      if (!val?.trim()) return "User cannot be empty";
    },
  });

  if (p.isCancel(user)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const home = await p.text({
    message: "pug-claw home directory?",
    initialValue: Paths.DEFAULT_HOME,
    validate: (val) => {
      if (!val?.trim()) return "Path cannot be empty";
    },
  });

  if (p.isCancel(home)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const workingDir = await p.text({
    message: "Working directory?",
    initialValue: resolve(import.meta.dir, "../.."),
    validate: (val) => {
      if (!val?.trim()) return "Path cannot be empty";
    },
  });

  if (p.isCancel(workingDir)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const bunPath = await p.text({
    message: "Path to bun?",
    initialValue: detectedBun,
    validate: (val) => {
      if (!val?.trim()) return "Path cannot be empty";
    },
  });

  if (p.isCancel(bunPath)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const outputPath = await p.text({
    message: "Write service file to?",
    initialValue: "/tmp/pug-claw.service",
    validate: (val) => {
      if (!val?.trim()) return "Path cannot be empty";
    },
  });

  if (p.isCancel(outputPath)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const unit = `[Unit]
Description=pug-claw AI bot framework
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${workingDir}
ExecStart=${bunPath} ${mainScript} start
Restart=on-failure
RestartSec=5
Environment=${EnvVars.HOME}=${home}
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
`;

  writeFileSync(outputPath, unit);

  p.note(
    [
      `Service file written to: ${outputPath}`,
      "",
      "To install and start the service:",
      "",
      `  sudo cp ${outputPath} /etc/systemd/system/pug-claw.service`,
      "  sudo systemctl daemon-reload",
      "  sudo systemctl enable pug-claw",
      "  sudo systemctl start pug-claw",
      "  sudo systemctl status pug-claw",
    ].join("\n"),
    "Next steps",
  );

  p.outro("Done!");
}
