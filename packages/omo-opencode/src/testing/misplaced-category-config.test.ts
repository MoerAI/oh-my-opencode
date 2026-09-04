import { afterEach, describe, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getMisplacedCategoryConfigDiagnostics } from "./misplaced-category-config"

const roots: string[] = []
const previousConfigDir = process.env.OPENCODE_CONFIG_DIR
const previousConfigContent = process.env.OPENCODE_CONFIG_CONTENT

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-misplaced-category-"))
  roots.push(root)
  return root
}

function misplacedConfig(): string {
  return `{
    "categories": {
      "deep": { "model": "provider/model" }
    }
  }`
}

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
  else process.env.OPENCODE_CONFIG_DIR = previousConfigDir
  if (previousConfigContent === undefined) delete process.env.OPENCODE_CONFIG_CONTENT
  else process.env.OPENCODE_CONFIG_CONTENT = previousConfigContent
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("misplaced OpenCode category diagnostics", () => {
  test("#given inline config content with categories #when inspected #then its source is diagnosed", () => {
    // given
    const root = fixtureRoot()
    const projectDirectory = join(root, "project")
    process.env.OPENCODE_CONFIG_DIR = join(root, "config")
    process.env.OPENCODE_CONFIG_CONTENT = misplacedConfig()

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory)

    // then
    expect(diagnostics.some((message) => message.includes("OPENCODE_CONFIG_CONTENT"))).toBe(true)
  })

  test("#given a symlinked profile config directory #when inspected #then its lexical profile name is retained", () => {
    // given
    const root = fixtureRoot()
    const projectDirectory = join(root, "project")
    const actualConfigDir = join(root, "actual-config")
    const profileConfigDir = join(root, "profiles", "focused")
    mkdirSync(actualConfigDir, { recursive: true })
    mkdirSync(join(root, "profiles"), { recursive: true })
    writeFileSync(join(actualConfigDir, "opencode.jsonc"), misplacedConfig())
    symlinkSync(actualConfigDir, profileConfigDir, process.platform === "win32" ? "junction" : "dir")
    process.env.OPENCODE_CONFIG_DIR = profileConfigDir

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory)

    // then
    expect(diagnostics.some((message) =>
      message.includes("profiles.focused.opencode.categories")
    )).toBe(true)
  })

  test("#given a named profile #when its categories are diagnosed #then the hint remains OpenCode-scoped", () => {
    // given
    const root = fixtureRoot()
    const projectDirectory = join(root, "project")
    const profileConfigDir = join(root, "profiles", "focused")
    mkdirSync(profileConfigDir, { recursive: true })
    writeFileSync(join(profileConfigDir, "opencode.jsonc"), misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = profileConfigDir

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory)

    // then
    expect(diagnostics.some((message) =>
      message.includes("profiles.focused.opencode.categories")
    )).toBe(true)
    expect(diagnostics.some((message) =>
      message.includes("profiles.focused.categories")
    )).toBe(false)
  })

  test("#given a project below home #when ancestors are inspected #then discovery stops at home", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "home")
    const projectDirectory = join(homeDirectory, "project")
    const homeConfig = join(homeDirectory, "opencode.jsonc")
    const aboveHomeConfig = join(root, "opencode.jsonc")
    mkdirSync(projectDirectory, { recursive: true })
    writeFileSync(homeConfig, misplacedConfig())
    writeFileSync(aboveHomeConfig, misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = join(root, "user-config")

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      homeDirectory,
    })

    // then
    expect(diagnostics.some((message) => message.includes(homeConfig))).toBe(true)
    expect(diagnostics.some((message) => message.includes(aboveHomeConfig))).toBe(false)
  })

  test("#given a project outside home #when ancestors are inspected #then discovery reaches its root", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "unrelated-home")
    const projectDirectory = join(root, "workspace", "project")
    const ancestorConfig = join(root, "opencode.jsonc")
    mkdirSync(projectDirectory, { recursive: true })
    writeFileSync(ancestorConfig, misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = join(root, "user-config")

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      homeDirectory,
    })

    // then
    expect(diagnostics.some((message) => message.includes(ancestorConfig))).toBe(true)
  })
})
