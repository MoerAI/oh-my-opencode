import { realpathSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import {
  detectConfigFile,
  getOpenCodeConfigDiscoveryDirs,
  parseJsoncSafe,
  readJsoncFile,
} from "../shared"

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

function profileNameFromConfigDir(configDir: string): string | undefined {
  return basename(dirname(configDir)) === "profiles"
    ? basename(configDir)
    : undefined
}

function canonicalPath(filePath: string): string {
  try {
    return realpathSync(filePath)
  } catch {
    return resolve(filePath)
  }
}

function targetPath(profileName: string | undefined): string {
  return profileName === undefined
    ? "~/.omo/omo.jsonc"
    : `~/.omo/omo.jsonc under profiles.${profileName}.opencode.categories`
}

function userTargetPath(configDir: string): string {
  const configuredDir = process.env.OPENCODE_CONFIG_DIR?.trim()
  const lexicalProfileName = configuredDir &&
      canonicalPath(configuredDir) === canonicalPath(configDir)
    ? profileNameFromConfigDir(configuredDir)
    : undefined
  return targetPath(lexicalProfileName ?? profileNameFromConfigDir(configDir))
}

function hasTopLevelCategories(config: unknown): boolean {
  return typeof config === "object" &&
    config !== null &&
    !Array.isArray(config) &&
    "categories" in config
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
    if (!hasTopLevelCategories(config)) continue
    diagnostics.push(
      `OMO ignores "categories" in ${candidate.filePath}; move it to ${candidate.targetConfigPath}.`,
    )
  }

  const inlineContent = process.env.OPENCODE_CONFIG_CONTENT?.trim()
  if (inlineContent) {
    const inlineConfig = parseJsoncSafe<unknown>(inlineContent).data
    if (hasTopLevelCategories(inlineConfig)) {
      const configuredDir = process.env.OPENCODE_CONFIG_DIR?.trim()
      const profileName = configuredDir
        ? profileNameFromConfigDir(configuredDir)
        : undefined
      diagnostics.push(
        `OMO ignores "categories" in OPENCODE_CONFIG_CONTENT; move it to ${targetPath(profileName)}.`,
      )
    }
  }

  return diagnostics
}
