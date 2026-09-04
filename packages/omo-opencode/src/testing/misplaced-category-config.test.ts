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

  test("#given an existing user omo.json #when categories are diagnosed #then its extension is preserved", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "home")
    const configDir = join(root, "opencode")
    mkdirSync(join(homeDirectory, ".omo"), { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(homeDirectory, ".omo", "omo.json"), "{}")
    writeFileSync(join(configDir, "opencode.jsonc"), misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = configDir

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(join(root, "project"), {
      homeDirectory,
    })

    // then
    expect(diagnostics.some((message) => message.includes("~/.omo/omo.json."))).toBe(true)
    expect(diagnostics.some((message) => message.includes("~/.omo/omo.jsonc."))).toBe(false)
  })

  test("#given an existing project omo.json #when categories are diagnosed #then its extension is preserved", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "home")
    const projectDirectory = join(root, "workspace")
    const projectConfigDir = join(projectDirectory, ".omo")
    const targetConfig = join(projectConfigDir, "omo.json")
    mkdirSync(projectConfigDir, { recursive: true })
    writeFileSync(targetConfig, "{}")
    writeFileSync(join(projectDirectory, "opencode.jsonc"), misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = join(root, "user-config")

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      homeDirectory,
    })

    // then
    expect(diagnostics.some((message) => message.includes(targetConfig))).toBe(true)
    expect(diagnostics.some((message) => message.includes(`${targetConfig}c`))).toBe(false)
  })

  test.skipIf(process.platform === "win32")(
    "#given a symlinked project omo.jsonc #when categories are diagnosed #then a loadable sibling is targeted",
    () => {
      // given
      const root = fixtureRoot()
      const homeDirectory = join(root, "home")
      const projectDirectory = join(root, "workspace")
      const projectConfigDir = join(projectDirectory, ".omo")
      const linkedConfig = join(projectConfigDir, "omo.jsonc")
      const targetConfig = join(projectConfigDir, "omo.json")
      const externalConfig = join(root, "external-omo.jsonc")
      mkdirSync(projectConfigDir, { recursive: true })
      writeFileSync(externalConfig, "{}")
      symlinkSync(externalConfig, linkedConfig, "file")
      writeFileSync(join(projectDirectory, "opencode.jsonc"), misplacedConfig())
      process.env.OPENCODE_CONFIG_DIR = join(root, "user-config")

      // when
      const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
        homeDirectory,
      })

      // then
      expect(diagnostics.some((message) => message.includes(targetConfig))).toBe(true)
      expect(diagnostics.some((message) => message.includes(linkedConfig))).toBe(false)
    },
  )

  test("#given a symlinked project .omo directory #when categories are diagnosed #then replacement is explicit", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "home")
    const projectDirectory = join(root, "workspace")
    const actualConfigDir = join(root, "actual-omo")
    const projectConfigDir = join(projectDirectory, ".omo")
    mkdirSync(projectDirectory, { recursive: true })
    mkdirSync(actualConfigDir, { recursive: true })
    writeFileSync(join(actualConfigDir, "omo.json"), "{}")
    symlinkSync(
      actualConfigDir,
      projectConfigDir,
      process.platform === "win32" ? "junction" : "dir",
    )
    writeFileSync(join(projectDirectory, "opencode.jsonc"), misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = join(root, "user-config")

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      homeDirectory,
    })

    // then
    expect(diagnostics.some((message) =>
      message.includes("after replacing the symlinked") &&
      message.includes(".omo directory")
    )).toBe(true)
  })

  test("#given OPENCODE_CONFIG_DIR overlaps project config #when diagnosed #then project scope wins", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "home")
    const projectDirectory = join(root, "workspace")
    const openCodeConfigDir = join(projectDirectory, ".opencode")
    mkdirSync(openCodeConfigDir, { recursive: true })
    writeFileSync(join(openCodeConfigDir, "opencode.jsonc"), misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = openCodeConfigDir

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      homeDirectory,
    })

    // then
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toContain(join(".omo", "omo.jsonc"))
    expect(diagnostics[0]).not.toContain("~/.omo/")
  })

  test("#given a symlinked user .omo at the home boundary #when diagnosed #then user scope stays loadable", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "home")
    const projectDirectory = join(homeDirectory, "project")
    const actualConfigDir = join(root, "actual-user-omo")
    const userConfigDir = join(homeDirectory, ".omo")
    mkdirSync(projectDirectory, { recursive: true })
    mkdirSync(actualConfigDir, { recursive: true })
    writeFileSync(join(actualConfigDir, "omo.json"), "{}")
    symlinkSync(
      actualConfigDir,
      userConfigDir,
      process.platform === "win32" ? "junction" : "dir",
    )
    writeFileSync(join(homeDirectory, "opencode.jsonc"), misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = join(root, "user-config")

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      homeDirectory,
    })

    // then
    expect(diagnostics.some((message) => message.includes("~/.omo/omo.json."))).toBe(true)
    expect(diagnostics.some((message) => message.includes("after replacing"))).toBe(false)
  })

  test("#given HOME differs from the account home #when diagnosed #then either boundary stops discovery", () => {
    // given
    const root = fixtureRoot()
    const homeDirectory = join(root, "configured-home")
    const accountHomeDirectory = join(root, "account-home")
    const projectDirectory = join(accountHomeDirectory, "project")
    const accountHomeConfig = join(accountHomeDirectory, "opencode.jsonc")
    const aboveBoundaryConfig = join(root, "opencode.jsonc")
    mkdirSync(projectDirectory, { recursive: true })
    writeFileSync(accountHomeConfig, misplacedConfig())
    writeFileSync(aboveBoundaryConfig, misplacedConfig())
    process.env.OPENCODE_CONFIG_DIR = join(root, "user-config")

    // when
    const diagnostics = getMisplacedCategoryConfigDiagnostics(projectDirectory, {
      accountHomeDirectory,
      homeDirectory,
    })

    // then
    expect(diagnostics.some((message) => message.includes(accountHomeConfig))).toBe(true)
    expect(diagnostics.some((message) => message.includes(aboveBoundaryConfig))).toBe(false)
    expect(diagnostics.some((message) => message.includes("~/.omo/omo.jsonc."))).toBe(true)
  })
})
