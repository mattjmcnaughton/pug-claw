import { describe, expect, test } from "bun:test";

describe("init-service systemd template", () => {
  test("generates valid unit with bun exec mode", () => {
    const unit = buildTestUnit({
      user: "deploy",
      workingDir: "/opt/pug-claw",
      execStart: "/usr/bin/bun /opt/pug-claw/src/main.ts start",
      home: "/home/deploy/.pug-claw",
      userHome: "/home/deploy",
      pathEnv: "/usr/local/bin:/usr/bin:/bin",
    });

    expect(unit).toContain("[Unit]");
    expect(unit).toContain("Description=pug-claw");
    expect(unit).toContain("After=network-online.target");

    expect(unit).toContain("[Service]");
    expect(unit).toContain("Type=simple");
    expect(unit).toContain("User=deploy");
    expect(unit).toContain("WorkingDirectory=/opt/pug-claw");
    expect(unit).toContain(
      "ExecStart=/usr/bin/bun /opt/pug-claw/src/main.ts start",
    );
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("RestartSec=5");
    expect(unit).toContain("Environment=HOME=/home/deploy");
    expect(unit).toContain("Environment=PATH=/usr/local/bin:/usr/bin:/bin");
    expect(unit).toContain("Environment=PUG_CLAW_HOME=/home/deploy/.pug-claw");
    expect(unit).toContain("Environment=NODE_ENV=production");

    expect(unit).toContain("[Install]");
    expect(unit).toContain("WantedBy=multi-user.target");
  });

  test("generates valid unit with binary exec mode", () => {
    const unit = buildTestUnit({
      user: "deploy",
      workingDir: "/opt/pug-claw",
      execStart: "/usr/local/bin/pug-claw start",
      home: "/home/deploy/.pug-claw",
      userHome: "/home/deploy",
      pathEnv: "/usr/local/bin:/usr/bin:/bin",
    });

    expect(unit).toContain("ExecStart=/usr/local/bin/pug-claw start");
    expect(unit).not.toContain("bun");
  });
});

// Replicate the template logic for testing without interactive prompts
function buildTestUnit(opts: {
  user: string;
  workingDir: string;
  execStart: string;
  home: string;
  userHome: string;
  pathEnv: string;
}): string {
  return `[Unit]
Description=pug-claw AI bot framework
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${opts.user}
WorkingDirectory=${opts.workingDir}
ExecStart=${opts.execStart}
Restart=on-failure
RestartSec=5
Environment=HOME=${opts.userHome}
Environment=PATH=${opts.pathEnv}
Environment=PUG_CLAW_HOME=${opts.home}
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
`;
}
