import { readFile } from "node:fs/promises";
import type { StarterTemplate } from "./scaffold-templates.js";

/** Deployment assets are copied explicitly at package build, never from cwd. */
export async function deploymentFiles(template: StarterTemplate): Promise<Record<string, string>> {
  const names = ["Dockerfile", ".dockerignore", "compose.runtime.yaml", "runtime.mjs", "healthcheck.mjs", "runtime-control.mjs", "backup.mjs",
    ...(template === "shielded" ? ["compose.shielded.yaml"] : [])];
  return Object.fromEntries(await Promise.all(names.map(async name =>
    [name, await readFile(new URL(`../templates/runtime/${name}`, import.meta.url), "utf8")])));
}
