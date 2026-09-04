import { existsSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
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

type DiagnosticOptions = {
  readonly homeDirectory?: string
}

function detectedFile(basePath: string): string | undefined {
  const result = detectConfigFile(basePath)
  return result.format === "none" ? undefined : result.path
}

function pathKey(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/")
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function isWithin(parent: string, child: string): boolean {
  const relativePath = relative(parent, child)
  return relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

function ancestorDirectories(directory: string, homeDirectory: string): string[] {
  const directories: string[] = []
  const home = canonicalPath(homeDirectory)
  let current = canonicalPath(directory)
  const stopAtHome = isWithin(home, current)
  while (true) {
    directories.push(current)
    if (stopAtHome && pathKey(current) === pathKey(home)) {
      return directories.reverse()
    }
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

function activeOmoConfigPath(configDirectory: string): string {
  const jsoncPath = join(configDirectory, "omo.jsonc")
  if (existsSync(jsoncPath)) return jsoncPath
  const jsonPath = join(configDirectory, "omo.json")
  return existsSync(jsonPath) ? jsonPath : jsoncPath
}

function targetPath(basePath: string, profileName: string | undefined): string {
  return profileName === undefined
    ? basePath
    : `${basePath} under profiles.${profileName}.opencode.categories`
}

function userOmoTargetPath(homeDirectory: string): string {
  const filename = basename(activeOmoConfigPath(join(homeDirectory, ".omo")))
  return `~/.omo/${filename}`
}

function userTargetPath(configDir: string, homeDirectory: string): string {
  const configuredDir = process.env.OPENCODE_CONFIG_DIR?.trim()
  const lexicalProfileName = configuredDir &&
      canonicalPath(configuredDir) === canonicalPath(configDir)
    ? profileNameFromConfigDir(configuredDir)
    : undefined
  return targetPath(
    userOmoTargetPath(homeDirectory),
    lexicalProfileName ?? profileNameFromConfigDir(configDir),
  )
}

function hasTopLevelCategories(config: unknown): boolean {
  return typeof config === "object" &&
    config !== null &&
    !Array.isArray(config) &&
    "categories" in config
}

function configCandidates(projectDirectory: string, homeDirectory: string): ConfigCandidate[] {
  const candidates: ConfigCandidate[] = []
  const seen = new Set<string>()
  const add = (filePath: string | undefined, targetConfigPath: string): void => {
    if (filePath === undefined || seen.has(filePath)) return
    seen.add(filePath)
    candidates.push({ filePath, targetConfigPath })
  }

  for (const configDir of getOpenCodeConfigDiscoveryDirs()) {
    add(detectedFile(join(configDir, "opencode")), userTargetPath(configDir, homeDirectory))
  }

  const explicitConfig = process.env.OPENCODE_CONFIG?.trim()
  if (explicitConfig) add(resolve(explicitConfig), userOmoTargetPath(homeDirectory))

  const ancestors = ancestorDirectories(projectDirectory, homeDirectory)
  for (const directory of ancestors) {
    add(
      detectedFile(join(directory, "opencode")),
      activeOmoConfigPath(join(directory, ".omo")),
    )
  }
  for (const directory of ancestors) {
    add(
      detectedFile(join(directory, ".opencode", "opencode")),
      activeOmoConfigPath(join(directory, ".omo")),
    )
  }

  return candidates
}

export function getMisplacedCategoryConfigDiagnostics(
  projectDirectory: string,
  options: DiagnosticOptions = {},
): string[] {
  const diagnostics: string[] = []
  for (const candidate of configCandidates(projectDirectory, options.homeDirectory ?? homedir())) {
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
        `OMO ignores "categories" in OPENCODE_CONFIG_CONTENT; move it to ${targetPath(userOmoTargetPath(options.homeDirectory ?? homedir()), profileName)}.`,
      )
    }
  }

  return diagnostics
}
