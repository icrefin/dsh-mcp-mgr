/**
 * mcp.json / registry parsing and mapping to mcp-client configs.
 *
 * Format is the Claude/Codex `mcpServers` object; each entry maps to one
 * mcp-client plugin config. Invalid entries are reported per-server so one
 * broken row never blocks the rest.
 *
 * A workspace file additionally carries `use`: the names of global-registry
 * servers that workspace wants mounted. A missing `use` keeps every inline
 * entry working exactly as before.
 * @module dsh-mcp-mgr/parse
 */

import { join } from 'node:path'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'

/** One successfully mapped server. */
export interface ParsedServer {
  readonly name: string
  /** Whether the entry is enabled (`enabled: false` disables; absent/other = enabled). */
  readonly enabled: boolean
  readonly config: McpClientConfig
}

/** One rejected server entry with the reason. */
export interface ParseError {
  readonly name: string
  readonly message: string
}

export interface ParseResult {
  readonly servers: readonly ParsedServer[]
  readonly errors: readonly ParseError[]
}

/** One workspace document: the global selection plus legacy inline servers. */
export interface WorkspaceDocument {
  /** Global registry names this workspace selects (deduplicated, in file order). */
  readonly use: readonly string[]
  /** Inline `mcpServers` entries, mapped to mcp-client configs. */
  readonly servers: readonly ParsedServer[]
  readonly errors: readonly ParseError[]
}

/** One global registry document. */
export interface RegistryDocument {
  /**
   * Valid *and* invalid raw entries keyed by name: an entry that fails
   * validation is still returned so the UI can show and repair it.
   */
  readonly entries: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  /** Entries that mapped to a mcp-client config (mountable). */
  readonly servers: readonly ParsedServer[]
  readonly errors: readonly ParseError[]
}

/** mcp-client serverName budget. */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
/** Whole-string `${VAR}` env expansion. */
const ENV_REF_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/

/** Path of the manager file inside a workspace. */
export function mcpJsonPath(workspacePath: string): string {
  return join(workspacePath, '.dsh', 'dshmm', 'mcp.json')
}

/**
 * Expand `${VAR}` references in one env value.
 * @param value - raw env value.
 * @param source - entry name for error messages.
 * @returns the expanded value or the reason it cannot expand.
 */
export function expandEnv(value: string, source: string): { ok: true; value: string } | { ok: false; message: string } {
  const match = ENV_REF_PATTERN.exec(value)
  if (match === null) return { ok: true, value }
  const name = match[1] as string
  const resolved = process.env[name]
  if (resolved === undefined) {
    return { ok: false, message: `${source}: env ${JSON.stringify(name)} is not set` }
  }
  return { ok: true, value: resolved }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Map one raw `mcpServers` entry onto a mcp-client config.
 * @param name - entry key (the serverName).
 * @param rawEntry - the raw entry value.
 * @param defaultCwd - cwd used when the entry declares none.
 * @returns the mapped server, or the reason the entry is rejected.
 */
export function mapEntry(
  name: string,
  rawEntry: unknown,
  defaultCwd: string,
): { ok: true; server: ParsedServer } | { ok: false; message: string } {
  if (!SERVER_NAME_PATTERN.test(name)) {
    return { ok: false, message: `serverName must match ${String(SERVER_NAME_PATTERN)}` }
  }
  if (!isRecord(rawEntry)) return { ok: false, message: 'entry must be an object' }
  const enabled = rawEntry.enabled !== false
  // Missing type is the documented HTTP shorthand; reject unknown types
  // instead of silently treating a typo as stdio.
  const rawType = rawEntry.type
  if (rawType !== undefined && rawType !== 'stdio' && rawType !== 'http') {
    return { ok: false, message: '"type" must be either "stdio" or "http"' }
  }
  const transport = rawType === 'stdio' ? 'stdio' : 'streamable-http'
  if (transport === 'stdio') {
    const command = asString(rawEntry.command)
    if (command === undefined || command.length === 0) {
      return { ok: false, message: 'stdio servers require a "command"' }
    }
    const args: string[] = []
    if (rawEntry.args !== undefined) {
      if (!Array.isArray(rawEntry.args) || rawEntry.args.some(arg => typeof arg !== 'string')) {
        return { ok: false, message: '"args" must be an array of strings' }
      }
      args.push(...(rawEntry.args as string[]))
    }
    const env: Record<string, string> = {}
    if (rawEntry.env !== undefined) {
      if (!isRecord(rawEntry.env) || Object.values(rawEntry.env).some(value => typeof value !== 'string')) {
        return { ok: false, message: '"env" must be an object of strings' }
      }
      for (const [key, value] of Object.entries(rawEntry.env)) {
        const expanded = expandEnv(value as string, name)
        if (!expanded.ok) return { ok: false, message: expanded.message }
        env[key] = expanded.value
      }
    }
    return {
      ok: true,
      server: {
        name,
        enabled,
        config: {
          transport: 'stdio',
          serverName: name,
          command,
          args,
          env,
          cwd: asString(rawEntry.cwd) ?? defaultCwd,
          toolCallTimeoutMs: 60_000,
          failOnStartupError: false,
        },
      },
    }
  }
  const url = asString(rawEntry.url)
  if (url === undefined || url.length === 0) {
    return { ok: false, message: 'http servers require a "url"' }
  }
  const headers: Record<string, string> = {}
  if (rawEntry.headers !== undefined) {
    if (!isRecord(rawEntry.headers) || Object.values(rawEntry.headers).some(value => typeof value !== 'string')) {
      return { ok: false, message: '"headers" must be an object of strings' }
    }
    Object.assign(headers, rawEntry.headers)
  }
  return {
    ok: true,
    server: {
      name,
      enabled,
      config: {
        transport: 'streamable-http',
        serverName: name,
        url,
        headers,
        toolCallTimeoutMs: 60_000,
        failOnStartupError: false,
      },
    },
  }
}

/** Map every entry of one `mcpServers` record, collecting per-entry errors. */
function mapServers(
  record: unknown,
  defaultCwd: string,
  errors: ParseError[],
): ParsedServer[] {
  if (record === undefined) return []
  if (!isRecord(record)) {
    errors.push({ name: '(document)', message: 'expected an object with an "mcpServers" object' })
    return []
  }
  const servers: ParsedServer[] = []
  for (const [name, rawEntry] of Object.entries(record)) {
    const mapped = mapEntry(name, rawEntry, defaultCwd)
    if (mapped.ok) servers.push(mapped.server)
    else errors.push({ name, message: mapped.message })
  }
  return servers
}

function parseJson(text: string): { ok: true; document: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, document: JSON.parse(text) as unknown }
  } catch (error) {
    return { ok: false, message: `invalid JSON: ${String(error instanceof Error ? error.message : error)}` }
  }
}

/**
 * Parse one mcp.json document.
 * @param text - raw file content.
 * @param workspacePath - workspace root; the default server cwd.
 * @returns mapped servers plus per-entry errors.
 */
export function parseMcpJson(text: string, workspacePath: string): ParseResult {
  const parsed = parseJson(text)
  if (!parsed.ok) {
    return { servers: [], errors: [{ name: '(document)', message: parsed.message }] }
  }
  const document = parsed.document
  if (!isRecord(document) || !isRecord(document.mcpServers)) {
    return {
      servers: [],
      errors: [{ name: '(document)', message: 'expected an object with an "mcpServers" object' }],
    }
  }
  const errors: ParseError[] = []
  return { servers: mapServers(document.mcpServers, workspacePath, errors), errors }
}

/**
 * Parse one workspace file: the `use` selection plus any inline servers.
 * A file without `mcpServers` is valid (selection-only).
 * @param text - raw file content.
 * @param workspacePath - workspace root; the default inline-server cwd.
 */
export function parseWorkspaceDocument(text: string, workspacePath: string): WorkspaceDocument {
  const parsed = parseJson(text)
  if (!parsed.ok) {
    return { use: [], servers: [], errors: [{ name: '(document)', message: parsed.message }] }
  }
  const document = parsed.document
  if (!isRecord(document)) {
    return { use: [], servers: [], errors: [{ name: '(document)', message: 'expected a JSON object' }] }
  }
  const errors: ParseError[] = []
  const use: string[] = []
  if (document.use !== undefined) {
    if (!Array.isArray(document.use)) {
      errors.push({ name: 'use', message: '"use" must be an array of server names' })
    } else {
      for (const raw of document.use) {
        if (typeof raw !== 'string' || !SERVER_NAME_PATTERN.test(raw)) {
          errors.push({ name: 'use', message: `invalid server name ${JSON.stringify(raw)}` })
          continue
        }
        if (!use.includes(raw)) use.push(raw)
      }
    }
  }
  if (document.mcpServers !== undefined && !isRecord(document.mcpServers)) {
    errors.push({ name: '(document)', message: '"mcpServers" must be an object' })
  }
  return {
    use,
    servers: mapServers(document.mcpServers, workspacePath, errors),
    errors,
  }
}

/**
 * Parse the global registry document. Every name-valid raw entry is returned
 * — including entries that fail validation — so the UI can show and repair
 * them; only valid ones appear in `servers` (and therefore mount).
 * @param text - raw registry file content.
 * @param defaultCwd - cwd used by entries that declare none.
 */
export function parseRegistryDocument(text: string, defaultCwd: string): RegistryDocument {
  const parsed = parseJson(text)
  if (!parsed.ok) {
    return { entries: {}, servers: [], errors: [{ name: '(document)', message: parsed.message }] }
  }
  const document = parsed.document
  if (!isRecord(document)) {
    return { entries: {}, servers: [], errors: [{ name: '(document)', message: 'expected a JSON object' }] }
  }
  const record = document.mcpServers !== undefined ? document.mcpServers : document
  if (!isRecord(record)) {
    return { entries: {}, servers: [], errors: [{ name: '(document)', message: 'expected an "mcpServers" object' }] }
  }
  const entries: Record<string, Record<string, unknown>> = {}
  const servers: ParsedServer[] = []
  const errors: ParseError[] = []
  for (const [name, rawEntry] of Object.entries(record)) {
    if (name === 'version') continue
    if (!SERVER_NAME_PATTERN.test(name)) {
      errors.push({ name, message: `serverName must match ${String(SERVER_NAME_PATTERN)}` })
      continue
    }
    if (!isRecord(rawEntry)) {
      errors.push({ name, message: 'entry must be an object' })
      continue
    }
    entries[name] = rawEntry
    const mapped = mapEntry(name, rawEntry, defaultCwd)
    if (mapped.ok) servers.push(mapped.server)
    else errors.push({ name, message: mapped.message })
  }
  return { entries, servers, errors }
}

/**
 * Normalize a pasted JSON snippet into named entries. Accepts a
 * `{ "mcpServers": { ... } }` document or a bare `{ "<name>": { ... } }` map.
 * @param text - the pasted snippet.
 * @returns entries keyed by name, or the reason the snippet is unusable.
 */
export function parseEntrySnippet(text: string): { ok: true; entries: Record<string, Record<string, unknown>> } | { ok: false; message: string } {
  const parsed = parseJson(text)
  if (!parsed.ok) return { ok: false, message: parsed.message }
  const document = parsed.document
  if (!isRecord(document)) return { ok: false, message: 'expected a JSON object' }
  const record = document.mcpServers !== undefined ? document.mcpServers : document
  if (!isRecord(record)) return { ok: false, message: 'expected an "mcpServers" object' }
  const entries: Record<string, Record<string, unknown>> = {}
  for (const [name, rawEntry] of Object.entries(record)) {
    if (name === 'version') continue
    if (!isRecord(rawEntry)) return { ok: false, message: `"${name}" must be an object` }
    entries[name] = rawEntry
  }
  if (Object.keys(entries).length === 0) return { ok: false, message: 'no server entries found' }
  return { ok: true, entries }
}

/** One-line command/URL summary for a table cell. */
export function entrySummary(entry: Readonly<Record<string, unknown>>): string {
  if (entry.type === 'stdio' || (entry.command !== undefined && entry.url === undefined)) {
    const command = typeof entry.command === 'string' ? entry.command : ''
    const args = Array.isArray(entry.args) ? entry.args.filter((arg): arg is string => typeof arg === 'string') : []
    return [command, ...args].filter(part => part.length > 0).join(' ')
  }
  return typeof entry.url === 'string' ? entry.url : ''
}

/** Serialize a server draft back into one mcpServers entry. */
export function draftToEntry(draft: {
  readonly transport: 'stdio' | 'streamable-http'
  readonly command?: string | undefined
  readonly args?: readonly string[] | undefined
  readonly env?: Readonly<Record<string, string>> | undefined
  readonly url?: string | undefined
  readonly headers?: Readonly<Record<string, string>> | undefined
  readonly cwd?: string | undefined
}): Record<string, unknown> {
  if (draft.transport === 'stdio') {
    return {
      type: 'stdio',
      command: draft.command,
      ...(draft.args !== undefined && draft.args.length > 0 ? { args: [...draft.args] } : {}),
      ...(draft.env !== undefined && Object.keys(draft.env).length > 0 ? { env: { ...draft.env } } : {}),
      ...(draft.cwd !== undefined ? { cwd: draft.cwd } : {}),
    }
  }
  return {
    type: 'http',
    url: draft.url,
    ...(draft.headers !== undefined && Object.keys(draft.headers).length > 0 ? { headers: { ...draft.headers } } : {}),
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every(item => typeof item === 'string')
}

/**
 * Validate one server draft against the same rules parseMcpJson enforces,
 * so a form can never write an entry the rescan would reject.
 * @param draft - the candidate entry (name included).
 * @returns the reason the draft is invalid, or undefined when valid.
 */
export function validateDraft(draft: {
  readonly name: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly command?: string | undefined
  readonly args?: readonly string[] | undefined
  readonly env?: Readonly<Record<string, string>> | undefined
  readonly url?: string | undefined
  readonly headers?: Readonly<Record<string, string>> | undefined
}): string | undefined {
  if (!SERVER_NAME_PATTERN.test(draft.name)) {
    return `serverName must match ${String(SERVER_NAME_PATTERN)}`
  }
  if (draft.transport === 'stdio') {
    if (draft.command === undefined || draft.command.trim().length === 0) {
      return 'stdio servers require a "command"'
    }
    if (draft.args !== undefined && (!Array.isArray(draft.args) || draft.args.some(arg => typeof arg !== 'string'))) {
      return '"args" must be an array of strings'
    }
    if (draft.env !== undefined && !isStringRecord(draft.env)) {
      return '"env" must be an object of strings'
    }
    return undefined
  }
  if (draft.url === undefined || draft.url.trim().length === 0) {
    return 'http servers require a "url"'
  }
  if (draft.headers !== undefined && !isStringRecord(draft.headers)) {
    return '"headers" must be an object of strings'
  }
  return undefined
}
