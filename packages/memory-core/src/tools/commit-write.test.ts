import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { GitCommandError, GitMemoryRepo, MemorySecretError } from "../git"
import { installHooks } from "../memfs/hooks"
import { commitMemoryWrite } from "./commit-write"

const AUTHOR = { agentId: "commit-agent", authorName: "Commit Agent", authorEmail: "commit@example.test" }
const tempDirs: string[] = []

async function hookedRepo() {
  const root = await mkdtemp(join(tmpdir(), "memory-commit-write-"))
  tempDirs.push(root)
  const dir = join(root, "memory")
  const repo = new GitMemoryRepo({ dir, agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName })
  installHooks(dir)
  return { dir, repo }
}

function writeMemory(repo: GitMemoryRepo, dir: string, path: string, content: string) {
  return commitMemoryWrite({
    repo,
    lock: async (_domain, operation) => operation(),
    apply: async () => {
      await mkdir(dirname(join(dir, path)), { recursive: true })
      await writeFile(join(dir, path), content)
      return [path]
    },
    reason: `remember ${path}`,
    author: AUTHOR,
    successLabel: "Memory",
  })
}

async function rejected(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation
  } catch (error) {
    if (error instanceof Error) return error
    throw new Error(`Expected Error rejection, received ${String(error)}`)
  }
  throw new Error("Expected operation to reject")
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

setDefaultTimeout(process.platform === "win32" ? 30_000 : 15_000)

describe("commitMemoryWrite", () => {
  it("#given a write the pre-commit hook refuses after the in-process screen let it through #when it commits #then the write is rolled back and the next write commits", async () => {
    // given
    const { dir, repo } = await hookedRepo()
    const head = await repo.head()

    // when
    const error = await rejected(writeMemory(repo, dir, "reference/cli.md", '---\ndescription: CLI notes\n---\n\napiKey: "!op read example"\n'))

    // then
    expect(error).toBeInstanceOf(GitCommandError)
    expect(error).not.toBeInstanceOf(MemorySecretError)
    expect(error.message).toContain("secret-like content (credential_assignment)")
    expect(await repo.head()).toBe(head)
    expect(await repo.status()).toBe("")
    const next = await writeMemory(repo, dir, "reference/plain.md", "---\ndescription: Plain notes\n---\n\nnothing secret here\n")
    expect(next.affectedPaths).toEqual(["reference/plain.md"])
  })
})
