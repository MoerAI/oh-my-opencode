import { existsSync, lstatSync, realpathSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import {
  getOpenCodeConfigDirs,
  getOpenCodeConfigDiscoveryDirs,
} from "../shared"

export type MisplacedCategoryDiagnosticOptions = {
  readonly accountHomeDirectory?: string
  readonly disableProjectConfig?: boolean
  readonly homeDirectory?: string
  readonly maxProjectDepth?: number
  readonly worktreeDirectory?: string
}

export type ConfigCandidate = {
  readonly filePath: string
  readonly priority: number
  readonly targetConfigPath: string
}

type ConfigDiscoveryOptions = Required<
  Pick<
    MisplacedCategoryDiagnosticOptions,
    "accountHomeDirectory" | "disableProjectConfig" | "homeDirectory" | "maxProjectDepth"
  >
> & Pick<MisplacedCategoryDiagnosticOptions, "worktreeDirectory">

function pathKey(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/")
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function canonicalPath(filePath: string): string {
  const absolutePath = resolve(filePath)
  try {
    return realpathSync(absolutePath)
  } catch {
    return absolutePath
  }
}

function ancestorDirectories(
  directory: string,
  boundaryDirectories: readonly string[],
  maxDepth: number,
): string[] {
  const directories: string[] = []
  const lexicalBoundaryKeys = new Set(
    boundaryDirectories.map((path) => pathKey(resolve(path))),
  )
  const canonicalBoundaryKeys = new Set(
    boundaryDirectories.map((path) => pathKey(canonicalPath(path))),
  )
  let current = resolve(directory)
  for (let depth = 0; depth < maxDepth; depth += 1) {
    directories.push(current)
    if (
      lexicalBoundaryKeys.has(pathKey(current)) ||
      canonicalBoundaryKeys.has(pathKey(canonicalPath(current)))
    ) {
      break
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return directories.reverse()
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

function activeOmoConfigPath(configDirectory: string): string {
  const jsoncPath = join(configDirectory, "omo.jsonc")
  if (existsSync(jsoncPath)) return jsoncPath
  const jsonPath = join(configDirectory, "omo.json")
  return existsSync(jsonPath) ? jsonPath : jsoncPath
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

export function userOmoTargetPath(homeDirectory: string): string {
  const filename = basename(activeOmoConfigPath(join(homeDirectory, ".omo")))
  return `~/.omo/${filename}`
}

export function targetPath(basePath: string, profileName: string | undefined): string {
  return profileName === undefined
    ? basePath
    : `${basePath} under profiles.${profileName}."[opencode]".categories`
}

function existingOpenCodeConfigFiles(configDirectory: string): string[] {
  return ["opencode.json", "opencode.jsonc"]
    .map((filename) => join(configDirectory, filename))
    .filter((filePath) => existsSync(filePath))
}

export function getMisplacedCategoryConfigCandidates(
  projectDirectory: string,
  options: ConfigDiscoveryOptions,
  profileName: string | undefined,
): ConfigCandidate[] {
  const candidates = new Map<string, ConfigCandidate>()
  const add = (filePath: string, targetConfigPath: string, priority: number): void => {
    const key = pathKey(canonicalPath(filePath))
    const existing = candidates.get(key)
    if (existing !== undefined && existing.priority >= priority) return
    candidates.set(key, { filePath, priority, targetConfigPath })
  }
  const userTarget = targetPath(userOmoTargetPath(options.homeDirectory), profileName)

  for (const configDirectory of getOpenCodeConfigDiscoveryDirs()) {
    for (const filePath of existingOpenCodeConfigFiles(configDirectory)) {
      add(filePath, userTarget, 0)
    }
  }
  const defaultCliConfigDirectory = getOpenCodeConfigDirs({ binary: "opencode" }).at(-1)
  const legacyConfig = defaultCliConfigDirectory === undefined
    ? undefined
    : join(defaultCliConfigDirectory, "config.json")
  if (legacyConfig !== undefined && existsSync(legacyConfig)) {
    add(legacyConfig, userTarget, 0)
  }
  const homeOpenCodeDirectory = join(options.homeDirectory, ".opencode")
  for (const filePath of existingOpenCodeConfigFiles(homeOpenCodeDirectory)) {
    add(filePath, userTarget, 0)
  }
  const explicitConfig = process.env.OPENCODE_CONFIG?.trim()
  if (explicitConfig && existsSync(resolve(explicitConfig))) {
    add(resolve(explicitConfig), userTarget, 0)
  }
  if (options.disableProjectConfig) return [...candidates.values()]

  const homeKeys = new Set(
    [options.homeDirectory, options.accountHomeDirectory]
      .map((path) => pathKey(canonicalPath(path))),
  )
  const boundaries = [
    options.homeDirectory,
    options.accountHomeDirectory,
    ...(options.worktreeDirectory === undefined ? [] : [options.worktreeDirectory]),
  ]
  const ancestors = ancestorDirectories(
    projectDirectory,
    boundaries,
    options.maxProjectDepth,
  )
  for (const directory of ancestors) {
    const target = homeKeys.has(pathKey(canonicalPath(directory)))
      ? userTarget
      : projectOmoTargetPath(directory)
    for (const filePath of existingOpenCodeConfigFiles(directory)) {
      add(filePath, target, 1)
    }
    for (const filePath of existingOpenCodeConfigFiles(join(directory, ".opencode"))) {
      add(filePath, target, 1)
    }
  }
  return [...candidates.values()]
}
