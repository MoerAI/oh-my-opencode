import { existsSync, lstatSync, realpathSync } from "node:fs"
import { homedir, userInfo } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import {
  detectConfigFile,
  getOpenCodeConfigDiscoveryDirs,
  parseJsoncSafe,
  readJsoncFile,
} from "../shared"

type ConfigCandidate = {
  readonly filePath: string
  readonly priority: number
  readonly targetConfigPath: string
}

type DiagnosticOptions = {
  readonly accountHomeDirectory?: string
  readonly homeDirectory?: string
}

const ACCOUNT_HOME_DIRECTORY = userInfo().homedir

function detectedFile(basePath: string): string | undefined {
  const result = detectConfigFile(basePath)
  return result.format === "none" ? undefined : result.path
}

function pathKey(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/")
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function ancestorDirectories(
  directory: string,
  homeDirectories: readonly string[],
): string[] {
  const directories: string[] = []
  const homeKeys = new Set(homeDirectories.map((path) => pathKey(canonicalPath(path))))
  let current = canonicalPath(directory)
  while (true) {
    directories.push(current)
    if (homeKeys.has(pathKey(current))) {
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

function isSymlinkedPath(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink()
  } catch (error) {
    if (
      error instanceof Error &&
      (Reflect.get(error, "code") === "ENOENT" || Reflect.get(error, "code") === "ENOTDIR")
    ) {
      return false
    }
    if (error instanceof Error) return true
    throw error
  }
}

function projectOmoTargetPath(projectDirectory: string): string {
  const configDirectory = join(projectDirectory, ".omo")
  const jsoncPath = join(configDirectory, "omo.jsonc")
  const jsonPath = join(configDirectory, "omo.json")
  if (isSymlinkedPath(configDirectory)) {
    return `${jsoncPath} after replacing the symlinked ${configDirectory} directory`
  }
  if (existsSync(jsoncPath) && !isSymlinkedPath(jsoncPath)) return jsoncPath
  if (existsSync(jsonPath) && !isSymlinkedPath(jsonPath)) return jsonPath
  if (isSymlinkedPath(jsoncPath) && isSymlinkedPath(jsonPath)) {
    return `${jsoncPath} after replacing the symlinked config files in ${configDirectory}`
  }
  return isSymlinkedPath(jsoncPath) ? jsonPath : jsoncPath
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

function configCandidates(
  projectDirectory: string,
  homeDirectory: string,
  accountHomeDirectory: string,
): ConfigCandidate[] {
  const candidates = new Map<string, ConfigCandidate>()
  const add = (
    filePath: string | undefined,
    targetConfigPath: string,
    priority: number,
  ): void => {
    if (filePath === undefined) return
    const key = pathKey(canonicalPath(filePath))
    const existing = candidates.get(key)
    if (existing !== undefined && existing.priority >= priority) return
    candidates.set(key, { filePath, priority, targetConfigPath })
  }

  for (const configDir of getOpenCodeConfigDiscoveryDirs()) {
    add(
      detectedFile(join(configDir, "opencode")),
      userTargetPath(configDir, homeDirectory),
      0,
    )
  }

  const explicitConfig = process.env.OPENCODE_CONFIG?.trim()
  if (explicitConfig) {
    add(resolve(explicitConfig), userOmoTargetPath(homeDirectory), 0)
  }

  const homeKeys = new Set(
    [homeDirectory, accountHomeDirectory].map((path) => pathKey(canonicalPath(path))),
  )
  const ancestors = ancestorDirectories(projectDirectory, [
    homeDirectory,
    accountHomeDirectory,
  ])
  for (const directory of ancestors) {
    const target = homeKeys.has(pathKey(canonicalPath(directory)))
      ? userOmoTargetPath(homeDirectory)
      : projectOmoTargetPath(directory)
    add(
      detectedFile(join(directory, "opencode")),
      target,
      1,
    )
  }
  for (const directory of ancestors) {
    const target = homeKeys.has(pathKey(canonicalPath(directory)))
      ? userOmoTargetPath(homeDirectory)
      : projectOmoTargetPath(directory)
    add(
      detectedFile(join(directory, ".opencode", "opencode")),
      target,
      1,
    )
  }

  return [...candidates.values()]
}

export function getMisplacedCategoryConfigDiagnostics(
  projectDirectory: string,
  options: DiagnosticOptions = {},
): string[] {
  const diagnostics: string[] = []
  const homeDirectory = options.homeDirectory ?? homedir()
  for (
    const candidate of configCandidates(
      projectDirectory,
      homeDirectory,
      options.accountHomeDirectory ?? ACCOUNT_HOME_DIRECTORY,
    )
  ) {
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
        `OMO ignores "categories" in OPENCODE_CONFIG_CONTENT; move it to ${targetPath(userOmoTargetPath(homeDirectory), profileName)}.`,
      )
    }
  }

  return diagnostics
}
