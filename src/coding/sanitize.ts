const NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

export function sanitizeName(name: string): string {
  if (!NAME_REGEX.test(name)) {
    throw new Error(
      `Invalid name "${name}": must match ^[a-z0-9][a-z0-9_-]*$ (lowercase alphanumeric, hyphens, underscores; must start with alphanumeric)`,
    );
  }
  return name;
}

const SHELL_METACHAR_REGEX = /[;&|`$(){}!<>*?[\]#~\n\r\0]/;

export function sanitizePath(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(
      `Invalid path "${path}": must be an absolute path (starting with /)`,
    );
  }
  if (path.includes("..")) {
    throw new Error(
      `Invalid path "${path}": path traversal (..) is not allowed`,
    );
  }
  if (SHELL_METACHAR_REGEX.test(path)) {
    throw new Error(`Invalid path "${path}": contains shell metacharacters`);
  }
  return path;
}

const GIT_URL_PATTERNS = [
  /^https:\/\/[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}\/[a-zA-Z0-9._/-]+(?:\.git)?$/,
  /^git@[a-zA-Z0-9._-]+:[a-zA-Z0-9._/-]+(?:\.git)?$/,
  /^ssh:\/\/[a-zA-Z0-9._@-]+\/[a-zA-Z0-9._/-]+(?:\.git)?$/,
];

export function validateGitUrl(url: string): string {
  const matches = GIT_URL_PATTERNS.some((pattern) => pattern.test(url));
  if (!matches) {
    throw new Error(
      `Invalid git URL "${url}": must be an HTTPS, SSH, or git@ URL`,
    );
  }
  return url;
}
