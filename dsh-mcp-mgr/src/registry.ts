/**
 * Global MCP server registry: one profile-scoped JSON file holding every
 * server definition, shared by all workspaces, which then select from it.
 *
 * The file lives at `<profile>/.dsh/dshmm/mcp-servers.json` and uses the same
 * `mcpServers` entry schema as a workspace file, so definitions move between
 * the two without translation and stay hand-editable.
 * @module dsh-mcp-mgr/registry
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRegistryDocument, parseWorkspaceDocument, type RegistryDocument, type WorkspaceDocument } from './parse.ts'

/** Synthetic owner key of the single instance mounted per global server. */
export const GLOBAL_SCOPE = '@global'

/** Registry location inside a profile directory. */
const REGISTRY_RELATIVE = join('.dsh', 'dshmm', 'mcp-servers.json')

/** Whether a directory looks like a dsh profile root. */
function looksLikeProfileRoot(dir: string): boolean {
  return existsSync(join(dir, 'package.json'))
    && (existsSync(join(dir, 'cordis.yml')) || existsSync(join(dir, 'cordis.patch.yml')))
}

/** Nearest profile root at or above `start`. */
function findProfileRootUpwards(start: string): string | undefined {
  let current = start
  for (let depth = 0; depth < 8; depth += 1) {
    if (looksLikeProfileRoot(current)) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
  return undefined
}

/**
 * Resolve the profile directory that owns the registry: the loader's config
 * anchor when it sits inside a profile, otherwise the profile this package is
 * installed into (walking up from this module).
 * @param ctx - host plugin context (`baseUrl` carries the config anchor).
 */
export function resolveProfileRoot(ctx: unknown): string {
  const baseUrl = (ctx as { baseUrl?: unknown }).baseUrl
  if (typeof baseUrl === 'string' && baseUrl.length > 0) {
    try {
      const root = findProfileRootUpwards(fileURLToPath(baseUrl))
      if (root !== undefined) return root
    } catch {
      // baseUrl is not a file URL — fall back to the installed package path.
    }
  }
  return findProfileRootUpwards(dirname(fileURLToPath(import.meta.url))) ?? process.cwd()
}

/** Absolute path of the registry file for one profile. */
export function registryFilePath(profileRoot: string): string {
  return join(profileRoot, REGISTRY_RELATIVE)
}

/** Read + parse the registry; a missing file reads as an empty registry. */
export function readRegistry(path: string, defaultCwd: string): RegistryDocument {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { entries: {}, servers: [], errors: [] }
    }
    throw error
  }
  return parseRegistryDocument(text, defaultCwd)
}

/** Serialize registry entries into the on-disk document (names sorted). */
export function serializeRegistry(entries: Readonly<Record<string, unknown>>): string {
  const mcpServers: Record<string, unknown> = {}
  for (const name of Object.keys(entries).sort((left, right) => left.localeCompare(right))) {
    mcpServers[name] = entries[name]
  }
  return `${JSON.stringify({ version: 1, mcpServers }, null, 2)}\n`
}

/** Atomically replace the registry file with the given entries. */
export function writeRegistry(path: string, entries: Readonly<Record<string, unknown>>): void {
  const mcpServers: Record<string, unknown> = {}
  for (const name of Object.keys(entries).sort((left, right) => left.localeCompare(right))) {
    mcpServers[name] = entries[name]
  }
  atomicWriteJson(path, { version: 1, mcpServers })
}

/** Read + parse one workspace file; a missing file reads as an empty document. */
export function readWorkspaceDocument(path: string, workspacePath: string): WorkspaceDocument {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { use: [], servers: [], errors: [] }
    return {
      use: [],
      servers: [],
      errors: [{ name: '(document)', message: String(error instanceof Error ? error.message : error) }],
    }
  }
  return parseWorkspaceDocument(text, workspacePath)
}

export type RawRead =
  | { readonly ok: true; readonly document: Record<string, unknown> }
  | { readonly ok: false; readonly error: string }

/**
 * Read one JSON object for read-modify-write mutation. A missing file is an
 * empty object; unparsable or non-object content is an error the caller
 * reports instead of overwriting the user's file.
 */
export function readJsonObject(path: string): RawRead {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, document: {} }
    return { ok: false, error: `unreadable ${basename(path)}: ${String(error instanceof Error ? error.message : error)}` }
  }
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch (error) {
    return { ok: false, error: `invalid JSON in ${basename(path)}: ${String(error instanceof Error ? error.message : error)}` }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: `${basename(path)} must contain a JSON object` }
  }
  return { ok: true, document: value as Record<string, unknown> }
}

/** Atomic JSON write: same-directory temp file, 0600, then rename over the target. */
export function atomicWriteJson(path: string, document: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${randomUUID()}`)
  try {
    writeFileSync(tmp, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    chmodSync(tmp, 0o600)
    renameSync(tmp, path)
  } finally {
    rmSync(tmp, { force: true })
  }
}
