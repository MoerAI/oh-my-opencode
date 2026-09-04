import { basename, dirname, join, resolve } from "node:path"
import { detectConfigFile, getOpenCodeConfigDiscoveryDirs, readJsoncFile } from "../shared"

type ConfigCandidate = {
  readonly filePath: string
  readonly targetConfigPath: string
}

function detectedFile(basePath: string): string | undefined {
  const result = detectConfigFile(basePath)
  return result.format === "none" ? undefined : result.path
}

function ancestorDirectories(directory: string): string[] {
  const directories: string[] = []
  let current = resolve(directory)
  while (true) {
    directories.push(current)
    const parent = dirname(current)
    if (parent === current) return directories.reverse()
    current = parent
  }
}

function userTargetPath(configDir: string): string {
  const profileName = basename(dirname(configDir)) === "profiles"
    ? basename(configDir)
    : undefined
  return profileName === undefined
    ? "~/.omo/omo.jsonc"
    : `~/.omo/omo.jsonc under profiles.${profileName}.categories`
}

function configCandidates(projectDirectory: string): ConfigCandidate[] {
  const candidates: ConfigCandidate[] = []
  const seen = new Set<string>()
  const add = (filePath: string | undefined, targetConfigPath: string): void => {
    if (filePath === undefined || seen.has(filePath)) return
    seen.add(filePath)
    candidates.push({ filePath, targetConfigPath })
  }

  for (const configDir of getOpenCodeConfigDiscoveryDirs()) {
    add(detectedFile(join(configDir, "opencode")), userTargetPath(configDir))
  }

  const explicitConfig = process.env.OPENCODE_CONFIG?.trim()
  if (explicitConfig) add(resolve(explicitConfig), "~/.omo/omo.jsonc")

  const ancestors = ancestorDirectories(projectDirectory)
  for (const directory of ancestors) {
    add(detectedFile(join(directory, "opencode")), join(directory, ".omo", "omo.jsonc"))
  }
  for (const directory of ancestors) {
    add(detectedFile(join(directory, ".opencode", "opencode")), join(directory, ".omo", "omo.jsonc"))
  }

  return candidates
}

export function getMisplacedCategoryConfigDiagnostics(projectDirectory: string): string[] {
  const diagnostics: string[] = []
  for (const candidate of configCandidates(projectDirectory)) {
    const config = readJsoncFile<unknown>(candidate.filePath)
    if (typeof config !== "object" || config === null || Array.isArray(config) || !("categories" in config)) {
      continue
    }
    diagnostics.push(
      `OMO ignores "categories" in ${candidate.filePath}; move it to ${candidate.targetConfigPath}.`,
    )
  }
  return diagnostics
}
