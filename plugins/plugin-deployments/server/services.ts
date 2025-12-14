interface DeploymentInfo {
  modified: Date;
  name: string;
  path: string;
  size: number;
  type: "file" | "directory";
}

let appsDir = "./apps";

/**
 * Set the apps directory for deployments
 */
export function setAppsDir(dir: string): void {
  appsDir = dir;
}

/**
 * List deployments in the apps directory
 */
export async function listDeployments(path = ""): Promise<DeploymentInfo[]> {
  const fullPath = `${appsDir}/${path}`.replace(/\/+/g, "/");
  const entries: DeploymentInfo[] = [];

  try {
    const glob = new Bun.Glob("*");
    for await (const entry of glob.scan({ cwd: fullPath, onlyFiles: false })) {
      const entryPath = `${fullPath}/${entry}`;
      const file = Bun.file(entryPath);
      const stat = await file.exists();

      if (stat) {
        entries.push({
          modified: new Date(),
          name: entry,
          path: path ? `${path}/${entry}` : entry,
          size: file.size,
          type: "file",
        });
      } else {
        // It's a directory
        entries.push({
          modified: new Date(),
          name: entry,
          path: path ? `${path}/${entry}` : entry,
          size: 0,
          type: "directory",
        });
      }
    }
  } catch (error) {
    console.error(`Error listing deployments: ${error}`);
  }

  return entries.sort((a, b) => {
    // Directories first, then alphabetically
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Get file for download
 */
export function getDeploymentFile(path: string) {
  const fullPath = `${appsDir}/${path}`.replace(/\/+/g, "/");
  return Bun.file(fullPath);
}
