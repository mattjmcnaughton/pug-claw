import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir, userInfo } from "node:os";
import * as p from "@clack/prompts";
import { EnvVars, Paths } from "../constants.ts";
import { expandTilde } from "../resources.ts";

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

  const runMode = await p.select({
    message: "How will pug-claw be launched?",
    options: [
      { value: "bun", label: "bun + script", hint: "bun src/main.ts start" },
      { value: "binary", label: "binary", hint: "pug-claw start" },
    ],
  });

  if (p.isCancel(runMode)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  let execStart: string;
  let workingDir: string;

  if (runMode === "binary") {
    const binaryPath = await p.text({
      message: "Path to pug-claw binary?",
      initialValue: "/usr/local/bin/pug-claw",
      validate: (val) => {
        if (!val?.trim()) return "Path cannot be empty";
      },
    });

    if (p.isCancel(binaryPath)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    const wd = await p.text({
      message: "Working directory?",
      initialValue: "/opt/pug-claw",
      validate: (val) => {
        if (!val?.trim()) return "Path cannot be empty";
      },
    });

    if (p.isCancel(wd)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    execStart = `${binaryPath} start`;
    workingDir = wd;
  } else {
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

    const wd = await p.text({
      message: "Working directory?",
      initialValue: resolve(import.meta.dir, "../.."),
      validate: (val) => {
        if (!val?.trim()) return "Path cannot be empty";
      },
    });

    if (p.isCancel(wd)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    execStart = `${bunPath} ${mainScript} start`;
    workingDir = wd;
  }

  const pathEnv = await p.text({
    message: "PATH for service? (systemd default is minimal)",
    initialValue: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    validate: (val) => {
      if (!val?.trim()) return "PATH cannot be empty";
    },
  });

  if (p.isCancel(pathEnv)) {
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

  // Resolve to absolute path so systemd doesn't need tilde expansion
  const absoluteHome = resolve(expandTilde(home));
  const userHome = homedir();

  const unit = `[Unit]
Description=pug-claw AI bot framework
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${workingDir}
ExecStart=${execStart}
Restart=on-failure
RestartSec=5
Environment=HOME=${userHome}
Environment=PATH=${pathEnv}
Environment=${EnvVars.HOME}=${absoluteHome}
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
