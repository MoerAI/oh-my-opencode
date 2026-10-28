import { existsSync, lstatSync, realpathSync } from "node:fs"
import { basename, dirname, join, relative, isAbsolute, sep } from "node:path"

import { ALLOWED_EXTENSIONS } from "./constants"
import { resolveFileWritePath } from "../../shared/resolve-file-write-path"

function isInside(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function isPlanningName(path: string): boolean {
  const name = basename(path)
  if (name === ".omo") return true
  if (name.toLowerCase() !== ".omo") return false
  // lstat distinguishes a separate case-sensitive symlink from a native case alias.
  const canonicalPath = join(dirname(path), ".omo")
  if (!existsSync(path) || !existsSync(canonicalPath)) return false
  const entry = lstatSync(path)
  const canonical = lstatSync(canonicalPath)
  return entry.dev === canonical.dev && entry.ino === canonical.ino
}

/** Return the authorized physical content path or final entry that execution must use. */
export function resolveAllowedFile(filePath: string, workspaceRoot: string, mode: "content" | "entry" = "content"): string | undefined {
  try {
    const input = filePath.replace(/\\/g, sep)
    const planning = [...input.matchAll(/(?:^|[/\\])\.omo(?=[/\\]|$)/gi)].reverse().find(match =>
      isPlanningName(resolveFileWritePath(input.slice(0, match.index + match[0].length), workspaceRoot, false)),
    )
    if (planning === undefined) return undefined
    const prefix = input.slice(0, planning.index + planning[0].length)
    const realRoot = realpathSync.native(workspaceRoot)
    const planningRoot = resolveFileWritePath(prefix, workspaceRoot)
    // The user chooses the physical layout (.omo -> docs/plans); it must only stay strictly inside the project.
    if (!isInside(planningRoot, realRoot)) return undefined
    const destination = resolveFileWritePath(filePath, workspaceRoot, mode === "content")
    if (!isInside(destination, planningRoot)) return undefined
    return ALLOWED_EXTENSIONS.some(ext =>
      input.toLowerCase().endsWith(ext) && destination.toLowerCase().endsWith(ext),
    ) ? destination : undefined
  } catch {
    // Includes dangling links, loops, non-directory ancestors and inaccessible paths.
    return undefined
  }
}

export function isAllowedFile(filePath: string, workspaceRoot: string): boolean {
  return resolveAllowedFile(filePath, workspaceRoot) !== undefined
}
