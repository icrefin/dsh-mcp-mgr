/**
 * dsh-mcp-mgr: global MCP server manager for DeepSeek Harness.
 *
 * One profile-scoped registry (`<profile>/.dsh/dshmm/mcp-servers.json`) holds
 * every server definition. Each workspace selects from that registry through
 * the `use` list in its own `.dsh/dshmm/mcp.json`, and may still declare
 * inline servers of its own. A selected global server mounts once for the
 * whole profile; inline servers mount per workspace. A Typert Remote
 * (`mcpMgr`) serves state and write-back to the web UI.
 * @module dsh-mcp-mgr
 */

import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// The mcp-client plugin object; dynamically mounted one instance per server.
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { existsSync, realpathSync } from 'node:fs'
import Schema from '@deepseek-ai/schemastery'
import { collectWorkspaces, hasManagerFile } from './discovery.ts'
import {
  draftToEntry,
  entrySummary,
  mapEntry,
  mcpJsonPath,
  parseEntrySnippet,
  SERVER_NAME_PATTERN,
  validateDraft,
  type ParsedServer,
  type WorkspaceDocument,
} from './parse.ts'
import { profileServerNames, scanProfileEntries, type LoaderEntryView } from './profile.ts'
import {
  atomicWriteJson,
  GLOBAL_SCOPE,
  readJsonObject,
  readRegistry,
  readWorkspaceDocument,
  registryFilePath,
  resolveProfileRoot,
  writeRegistry,
} from './registry.ts'
import { McpSync } from './sync.ts'
import { createFileWatcher } from './watch.ts'
import { readLocalVersion } from './version.ts'
import type {
  McpApplyResult,
  McpGlobalServerDraft,
  McpGlobalServerView,
  McpJsonImportResult,
  McpManagerSnapshot,
  McpServerDraft,
  McpServerState,
  McpWorkspaceView,
} from './types.ts'

export type * from './types.ts'
export { parseMcpJson, parseWorkspaceDocument, parseRegistryDocument, mcpJsonPath, expandEnv } from './parse.ts'
export { McpSync } from './sync.ts'
export type { McpInstance, InstanceFactory } from './sync.ts'
export { GLOBAL_SCOPE, registryFilePath, resolveProfileRoot } from './registry.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-mgr'

/** Services required before the manager starts mounting MCP clients. */
export const inject = ['tools']

/** The manager's Remote namespace. */
export const REMOTE_NAMESPACE = 'mcpMgr'

/** Plugin configuration supplied through cordis.yml. */
export interface Config {
  /** Master switch for workspace discovery. */
  enabled: boolean
  /** Periodic rescan interval covering workspaces added at runtime. */
  rescanIntervalMs: number
  /** Registry file to use; '' resolves `<profile>/.dsh/dshmm/mcp-servers.json`. */
  registryPath: string
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  rescanIntervalMs: Schema.number().min(1000).max(3600_000).default(10_000),
  registryPath: Schema.string().default(''),
})

/** mcp-client plugin object passed to `ctx.plugin` per server. */
const MCP_CLIENT_PLUGIN = {
  name: mcpClient.name,
  inject: mcpClient.inject,
  apply: mcpClient.apply,
}

/**
 * The manager service: owns the global registry, per-workspace selection, the
 * mount sync, and the Remote surface.
 * `workspaceRegistry` is deliberately NOT injected — it is a web-only service
 * that appears asynchronously; discovery re-probes on every rescan.
 */
export class McpMgrGateway extends TypertRemoteService {
  private readonly sync: McpSync
  private readonly fileWatcher = createFileWatcher(
    (handler, ms) => setTimeout(handler, ms),
    handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  )
  private readonly rescanTimer: ReturnType<typeof setInterval>
  private readonly workspaceSet = new Set<string>()
  /** Parsed workspace documents, refreshed every rescan. */
  private readonly workspaceDocs = new Map<string, WorkspaceDocument>()
  /** Registry view from the last rescan. */
  private registryEntries: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {}
  private registryServers: readonly ParsedServer[] = []
  private registryErrors: readonly string[] = []
  /** Workspaces selecting each registry name, from the last rescan. */
  private selectedBy = new Map<string, string[]>()
  private profileServers: readonly McpServerState[] = []
  private rescanning = false
  /** Strict mode: only {@link activeWorkspace}'s servers are mounted. */
  private strictMode = false
  /** Strict-mode target the UI last reported; '' = none. */
  private activeWorkspace = ''
  /** Serialized rescan chain so Remote-triggered passes apply in order. */
  private rescanChain: Promise<void> = Promise.resolve()
  /** Per-file lock for read-modify-write Remote mutations. */
  private readonly mutationChains = new Map<string, Promise<void>>()
  /** This package's installed version; '' when unreadable. */
  private readonly packageVersion: string = readLocalVersion()
  /** Profile directory owning the registry. */
  readonly profileRoot: string
  /** Absolute path of the global registry file. */
  readonly registryPath: string

  constructor(ctx: Context, config: Config) {
    super(ctx, 'mcpMgr')
    this.profileRoot = resolveProfileRoot(ctx)
    this.registryPath = config.registryPath.length > 0 ? config.registryPath : registryFilePath(this.profileRoot)
    this.sync = new McpSync(
      {
        create: async config => {
          const fiber = await ctx.plugin(MCP_CLIENT_PLUGIN, config)
          // Activation awaits the initial connect + tool discovery: tools
          // registered under the server namespace prove real connectivity,
          // while a failed connect activates with no tools. The probe must
          // never reject create — a rejected create would leak the already
          // activated fiber (its serverName stays held) and the next mount
          // of the same name would fail as a duplicate. Any probe failure is
          // surfaced on the row so a silent "registered" is explainable.
          let connected = false
          let probeError: string | undefined
          const tools = (ctx as { get?: (name: string) => unknown }).get?.('tools')
          if (tools === undefined) {
            probeError = 'tools service not accessible'
          } else {
            try {
              connected = serverHasTools(ctx, config.serverName)
            } catch (error) {
              probeError = String(error instanceof Error ? error.message : error)
            }
          }
          if (probeError !== undefined) {
            ctx.logger.warn(`mcp-mgr: connectivity probe failed for ${config.serverName}: ${probeError}`)
          }
          return { fiber, connected, ...(probeError === undefined ? {} : { probeError }) }
        },
        dispose: fiber => (fiber as { dispose(): Promise<void> }).dispose(),
      },
      { onChange: () => this.emitChange() },
    )
    this.rescanTimer = setInterval(() => {
      void this.runRescan()
    }, config.rescanIntervalMs)
    ctx.effect(() => async () => {
      this.fileWatcher.dispose()
      clearInterval(this.rescanTimer)
      await this.sync.dispose()
    }, 'mcp-mgr: cleanup')
    void this.runRescan()
  }

  /**
   * The installed package version, for the panel's version chip.
   *
   * Read once at construction from this package's own manifest; `''` when the
   * layout is unrecognised, which the chip renders as no version at all.
   */
  @Remote('version')
  version(): string {
    return this.packageVersion
  }

  /** Full current projection for the UI. */
  @Remote('snapshot')
  snapshot(): McpManagerSnapshot {
    const live = new Map(this.sync.snapshot().map(row => [row.key, row]))
    const global: McpGlobalServerView[] = []
    const names = new Set([...Object.keys(this.registryEntries), ...this.registryServers.map(server => server.name)])
    for (const name of [...names].sort((left, right) => left.localeCompare(right))) {
      const entry = this.registryEntries[name] ?? {}
      const enabled = entry.enabled !== false
      const mapped = mapEntry(name, entry, this.profileRoot)
      const liveRow = live.get(`${GLOBAL_SCOPE}#${name}`)
      global.push({
        name,
        transport: mapped.ok
          ? mapped.server.config.transport
          : (entry.url !== undefined ? 'streamable-http' : 'stdio'),
        enabled,
        detail: entrySummary(entry),
        entryJson: `${JSON.stringify(entry, null, 2)}\n`,
        usedBy: [...(this.selectedBy.get(name) ?? [])].sort(),
        status: liveRow?.status ?? (enabled ? 'configured' : 'disabled'),
        ...(liveRow?.error === undefined ? {} : { error: liveRow.error }),
        ...(liveRow?.connected === undefined ? {} : { connected: liveRow.connected }),
        ...(liveRow?.probeError === undefined ? {} : { probeError: liveRow.probeError }),
      })
    }
    const workspaces: McpWorkspaceView[] = [...this.workspaceSet]
      .sort((left, right) => left.localeCompare(right))
      .map(path => {
        const document = this.workspaceDocs.get(path)
        const use = document?.use ?? []
        return {
          path,
          use,
          missing: use.filter(entryName => this.registryEntries[entryName] === undefined),
          locals: [...live.values()]
            .filter(row => row.source === 'workspace' && row.workspace === path)
            .sort((left, right) => left.name.localeCompare(right.name)),
          errors: (document?.errors ?? []).map(error => `${error.name}: ${error.message}`),
        }
      })
    return {
      registryPath: this.registryPath,
      global,
      workspaces,
      profile: this.profileServers,
      watchedWorkspaces: [...this.workspaceSet].sort((left, right) => left.localeCompare(right)),
      strictMode: this.strictMode,
      activeWorkspace: this.activeWorkspace,
    }
  }

  /**
   * Turn strict mode on/off and resync. Strict: only the active workspace's
   * servers stay mounted. Non-strict: every workspace's servers mount (union).
   * @param enabled - strict mode flag.
   * @returns the post-resync snapshot.
   */
  @Remote('setStrictMode')
  async setStrictMode(enabled: boolean): Promise<McpManagerSnapshot> {
    this.strictMode = enabled
    await this.runRescan()
    return this.snapshot()
  }

  /**
   * Report the UI's currently selected workspace ('' = none). Only strict
   * mode reacts; non-strict keeps the union untouched.
   * @param path - canonical workspace path, or '' for no selection.
   * @returns the post-resync snapshot.
   */
  @Remote('setActiveWorkspace')
  async setActiveWorkspace(path: string): Promise<McpManagerSnapshot> {
    const activeWorkspace = path === '' ? '' : this.resolveRegisteredWorkspace(path)
    if (activeWorkspace === undefined) throw new Error(`workspace is not registered: ${path}`)
    this.activeWorkspace = activeWorkspace
    if (this.strictMode) await this.runRescan()
    return this.snapshot()
  }

  /**
   * Create or replace one global registry entry from the structured form.
   * Resolves only after the resync settles, so a caller's follow-up snapshot
   * already reflects the mounted state.
   */
  @Remote('saveGlobalServer')
  async saveGlobalServer(draft: McpGlobalServerDraft): Promise<McpApplyResult> {
    const invalid = validateDraft({
      name: draft.name,
      transport: draft.transport,
      ...(draft.command === undefined ? {} : { command: draft.command }),
      ...(draft.args === undefined ? {} : { args: draft.args }),
      ...(draft.env === undefined ? {} : { env: draft.env }),
      ...(draft.url === undefined ? {} : { url: draft.url }),
      ...(draft.headers === undefined ? {} : { headers: draft.headers }),
    })
    if (invalid !== undefined) return { ok: false, error: invalid }
    const entry: Record<string, unknown> = draftToEntry(draft)
    if (draft.cwd !== undefined && draft.cwd.length > 0 && draft.transport === 'stdio') entry.cwd = draft.cwd
    if (draft.enabled === false) entry.enabled = false
    return this.upsertGlobalEntry(draft.name, entry)
  }

  /**
   * Create or replace one global registry entry from the JSON editor: the text
   * must be one entry object (the name comes from the editor's Name field).
   */
  @Remote('saveGlobalServerJson')
  async saveGlobalServerJson(name: string, text: string): Promise<McpApplyResult> {
    if (!SERVER_NAME_PATTERN.test(name)) {
      return { ok: false, error: `serverName must match ${String(SERVER_NAME_PATTERN)}` }
    }
    let value: unknown
    try {
      value = JSON.parse(text) as unknown
    } catch (error) {
      return { ok: false, error: `invalid JSON: ${String(error instanceof Error ? error.message : error)}` }
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'the entry must be a JSON object' }
    }
    return this.upsertGlobalEntry(name, value as Record<string, unknown>)
  }

  /** Validate and store one registry entry, then resync. */
  private async upsertGlobalEntry(name: string, entry: Record<string, unknown>): Promise<McpApplyResult> {
    const mapped = mapEntry(name, entry, this.profileRoot)
    if (!mapped.ok) return { ok: false, error: mapped.message }
    const release = await this.acquireMutation(this.registryPath)
    try {
      const current = readRegistry(this.registryPath, this.profileRoot)
      writeRegistry(this.registryPath, { ...current.entries, [name]: entry })
    } catch (error) {
      return { ok: false, error: `write failed: ${String(error instanceof Error ? error.message : error)}` }
    } finally {
      release()
    }
    await this.runRescan()
    return { ok: true }
  }

  /**
   * Delete one global registry entry. Workspace `use` references to it are
   * left in place (they surface as "missing" so the loss is visible).
   */
  @Remote('removeGlobalServer')
  async removeGlobalServer(name: string): Promise<McpApplyResult> {
    if (!SERVER_NAME_PATTERN.test(name)) return { ok: false, error: `invalid serverName: ${name}` }
    const release = await this.acquireMutation(this.registryPath)
    try {
      const current = readRegistry(this.registryPath, this.profileRoot)
      if (current.entries[name] === undefined) {
        return { ok: false, error: `serverName "${name}" is not in the global registry` }
      }
      const entries = { ...current.entries }
      delete entries[name]
      writeRegistry(this.registryPath, entries)
    } catch (error) {
      return { ok: false, error: `write failed: ${String(error instanceof Error ? error.message : error)}` }
    } finally {
      release()
    }
    await this.runRescan()
    return { ok: true }
  }

  /**
   * Enable or disable one global registry entry. Disabling writes
   * `enabled: false`; enabling removes the field (absent = enabled).
   */
  @Remote('setGlobalServerEnabled')
  async setGlobalServerEnabled(name: string, enabled: boolean): Promise<McpApplyResult> {
    if (!SERVER_NAME_PATTERN.test(name)) return { ok: false, error: `invalid serverName: ${name}` }
    const release = await this.acquireMutation(this.registryPath)
    try {
      const current = readRegistry(this.registryPath, this.profileRoot)
      const entry = current.entries[name]
      if (entry === undefined) return { ok: false, error: `serverName "${name}" is not in the global registry` }
      const next: Record<string, unknown> = { ...entry }
      if (enabled) delete next.enabled
      else next.enabled = false
      writeRegistry(this.registryPath, { ...current.entries, [name]: next })
    } catch (error) {
      return { ok: false, error: `write failed: ${String(error instanceof Error ? error.message : error)}` }
    } finally {
      release()
    }
    await this.runRescan()
    return { ok: true }
  }

  /**
   * Import a JSON snippet into the global registry: either a
   * `{ "mcpServers": { ... } }` document or a bare `{ "<name>": { ... } }`
   * map. Valid entries are upserted; invalid ones are reported and skipped.
   */
  @Remote('importJson')
  async importJson(text: string): Promise<McpJsonImportResult> {
    const parsed = parseEntrySnippet(text)
    if (!parsed.ok) return { ok: false, added: [], updated: [], errors: [{ name: '(snippet)', message: parsed.message }] }
    const rejected: { name: string; message: string }[] = []
    const accepted: Record<string, Record<string, unknown>> = {}
    for (const [name, entry] of Object.entries(parsed.entries)) {
      const mapped = mapEntry(name, entry, this.profileRoot)
      if (mapped.ok) accepted[name] = entry
      else rejected.push({ name, message: mapped.message })
    }
    if (Object.keys(accepted).length === 0) {
      return { ok: false, added: [], updated: [], errors: rejected }
    }
    const added: string[] = []
    const updated: string[] = []
    const release = await this.acquireMutation(this.registryPath)
    try {
      const current = readRegistry(this.registryPath, this.profileRoot)
      for (const name of Object.keys(accepted)) {
        if (current.entries[name] === undefined) added.push(name)
        else updated.push(name)
      }
      writeRegistry(this.registryPath, { ...current.entries, ...accepted })
    } catch (error) {
      return {
        ok: false,
        added: [],
        updated: [],
        errors: [...rejected, { name: '(write)', message: String(error instanceof Error ? error.message : error) }],
      }
    } finally {
      release()
    }
    await this.runRescan()
    return { ok: rejected.length === 0, added, updated, errors: rejected }
  }

  /**
   * Replace one workspace's global-server selection (`use`). Inline
   * `mcpServers` entries are left untouched.
   */
  @Remote('setWorkspaceSelection')
  async setWorkspaceSelection(workspace: string, use: readonly string[]): Promise<McpApplyResult> {
    const workspacePath = this.resolveRegisteredWorkspace(workspace)
    if (workspacePath === undefined) return { ok: false, error: `workspace is not registered: ${workspace}` }
    const names: string[] = []
    for (const raw of use) {
      if (!SERVER_NAME_PATTERN.test(raw)) return { ok: false, error: `invalid serverName: ${String(raw)}` }
      if (!names.includes(raw)) names.push(raw)
    }
    const path = mcpJsonPath(workspacePath)
    const release = await this.acquireMutation(path)
    try {
      const current = readJsonObject(path)
      if (!current.ok) return { ok: false, error: current.error }
      const document = current.document
      if (names.length === 0) delete document.use
      else document.use = names
      atomicWriteJson(path, document)
    } catch (error) {
      return { ok: false, error: `write failed: ${String(error instanceof Error ? error.message : error)}` }
    } finally {
      release()
    }
    await this.runRescan()
    return { ok: true }
  }

  /**
   * Move one workspace-local (inline) server into the global registry and
   * replace the inline definition with a `use` reference. Refuses when the
   * registry already holds a different entry under that name.
   */
  @Remote('importLocalServer')
  async importLocalServer(workspace: string, serverName: string): Promise<McpApplyResult> {
    if (!SERVER_NAME_PATTERN.test(serverName)) return { ok: false, error: `invalid serverName: ${serverName}` }
    const workspacePath = this.resolveRegisteredWorkspace(workspace)
    if (workspacePath === undefined) return { ok: false, error: `workspace is not registered: ${workspace}` }
    const path = mcpJsonPath(workspacePath)
    const release = await this.acquireMutation(path)
    try {
      const current = readJsonObject(path)
      if (!current.ok) return { ok: false, error: current.error }
      const document = current.document
      const servers = document.mcpServers
      if (servers === null || typeof servers !== 'object' || Array.isArray(servers)) {
        return { ok: false, error: `no inline server "${serverName}" in ${workspacePath}` }
      }
      const record = servers as Record<string, unknown>
      const entry = record[serverName]
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        return { ok: false, error: `no inline server "${serverName}" in ${workspacePath}` }
      }
      const mapped = mapEntry(serverName, entry, workspacePath)
      if (!mapped.ok) return { ok: false, error: mapped.message }
      const registry = readRegistry(this.registryPath, this.profileRoot)
      const existing = registry.entries[serverName]
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(entry)) {
        return { ok: false, error: `the global registry already defines a different "${serverName}"` }
      }
      // Registry first: a failure here leaves the workspace file untouched.
      writeRegistry(this.registryPath, { ...registry.entries, [serverName]: entry })
      delete record[serverName]
      if (Object.keys(record).length === 0) delete document.mcpServers
      document.use = [...new Set([...(Array.isArray(document.use) ? document.use as string[] : []), serverName])]
      atomicWriteJson(path, document)
    } catch (error) {
      return { ok: false, error: `write failed: ${String(error instanceof Error ? error.message : error)}` }
    } finally {
      release()
    }
    await this.runRescan()
    return { ok: true }
  }

  /**
   * Create one inline server entry in a workspace's mcp.json (file created when
   * absent). Kept for the legacy per-workspace flow; the section's own editor
   * writes the global registry instead.
   */
  @Remote('apply')
  async apply(draft: McpServerDraft): Promise<McpApplyResult> {
    const invalid = validateDraft(draft)
    if (invalid !== undefined) return { ok: false, error: invalid }
    const workspacePath = this.resolveRegisteredWorkspace(draft.workspace)
    if (workspacePath === undefined) return { ok: false, error: `workspace is not registered: ${draft.workspace}` }
    const path = mcpJsonPath(workspacePath)
    const release = await this.acquireMutation(path)
    try {
      const current = readJsonObject(path)
      if (!current.ok) return { ok: false, error: current.error }
      const document = current.document
      const existing = document.mcpServers
      if (existing !== undefined && (existing === null || typeof existing !== 'object' || Array.isArray(existing))) {
        return { ok: false, error: 'mcpServers must be an object' }
      }
      const servers = (existing as Record<string, unknown> | undefined) ?? {}
      if (servers[draft.name] !== undefined) {
        return { ok: false, error: `serverName "${draft.name}" already exists in ${workspacePath}` }
      }
      servers[draft.name] = draftToEntry(draft)
      document.mcpServers = servers
      atomicWriteJson(path, document)
    } catch (error) {
      return { ok: false, error: `write failed: ${String(error instanceof Error ? error.message : error)}` }
    } finally {
      release()
    }
    await this.runRescan()
    return { ok: true }
  }

  /**
   * Remove one inline server entry from a workspace's mcp.json.
   * Named `removeServer`: `remove` collides with the client gateway's
   * RemoteNamespaceService prototype method and fails contribution mounts.
   */
  @Remote('removeServer')
  async removeServer(workspace: string, serverName: string): Promise<McpApplyResult> {
    if (!SERVER_NAME_PATTERN.test(serverName)) {
      return { ok: false, error: `invalid serverName: ${serverName}` }
    }
    const workspacePath = this.resolveRegisteredWorkspace(workspace)
    if (workspacePath === undefined) return { ok: false, error: `workspace is not registered: ${workspace}` }
    const path = mcpJsonPath(workspacePath)
    const release = await this.acquireMutation(path)
    try {
      const current = readJsonObject(path)
      if (!current.ok) return { ok: false, error: current.error }
      const document = current.document
      const servers = document.mcpServers
      if (servers !== null && typeof servers === 'object' && !Array.isArray(servers)) {
        delete (servers as Record<string, unknown>)[serverName]
        if (Object.keys(servers as Record<string, unknown>).length === 0) delete document.mcpServers
      }
      atomicWriteJson(path, document)
    } catch (error) {
      return { ok: false, error: `write failed: ${String(error instanceof Error ? error.message : error)}` }
    } finally {
      release()
    }
    await this.runRescan()
    return { ok: true }
  }

  /**
   * Enable or disable one inline server entry in a workspace's mcp.json.
   * Disabling writes `enabled: false`; enabling removes the field.
   */
  @Remote('setServerEnabled')
  async setServerEnabled(workspace: string, serverName: string, enabled: boolean): Promise<McpApplyResult> {
    if (!SERVER_NAME_PATTERN.test(serverName)) {
      return { ok: false, error: `invalid serverName: ${serverName}` }
    }
    const workspacePath = this.resolveRegisteredWorkspace(workspace)
    if (workspacePath === undefined) return { ok: false, error: `workspace is not registered: ${workspace}` }
    const path = mcpJsonPath(workspacePath)
    const release = await this.acquireMutation(path)
    try {
      const current = readJsonObject(path)
      if (!current.ok) return { ok: false, error: current.error }
      const document = current.document
      const servers = document.mcpServers
      if (servers === null || typeof servers !== 'object' || Array.isArray(servers)) {
        return { ok: false, error: 'mcpServers must be an object' }
      }
      const entry = (servers as Record<string, unknown>)[serverName]
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        return { ok: false, error: `serverName "${serverName}" not found in ${workspacePath}` }
      }
      const entryRecord = entry as Record<string, unknown>
      if (enabled) delete entryRecord.enabled
      else entryRecord.enabled = false
      atomicWriteJson(path, document)
    } catch (error) {
      return { ok: false, error: `write failed: ${String(error instanceof Error ? error.message : error)}` }
    } finally {
      release()
    }
    await this.runRescan()
    return { ok: true }
  }

  private resolveRegisteredWorkspace(input: string): string | undefined {
    let candidate: string
    try {
      candidate = realpathSync(input)
    } catch {
      return undefined
    }
    return collectWorkspaces(this.ctx).some(workspace => workspace.path === candidate) ? candidate : undefined
  }

  /** Serialize read-modify-write operations for one file. */
  private async acquireMutation(path: string): Promise<() => void> {
    const previous = this.mutationChains.get(path)
    let release!: () => void
    const current = new Promise<void>(resolve => { release = resolve })
    this.mutationChains.set(path, current)
    if (previous !== undefined) await previous
    return () => {
      release()
      if (this.mutationChains.get(path) === current) this.mutationChains.delete(path)
    }
  }

  /**
   * Serialize rescan passes: a Remote-triggered pass must apply after any
   * in-flight one settles (a skipped pass would drop the newest selection).
   * @returns resolution after this queued pass settles.
   */
  private runRescan(): Promise<void> {
    const next = this.rescanChain.then(() => this.rescan(), () => this.rescan())
    this.rescanChain = next.catch(() => undefined)
    return next
  }

  /** One full discovery + sync pass. */
  async rescan(): Promise<void> {
    if (this.rescanning) return
    this.rescanning = true
    try {
      const workspaces = collectWorkspaces(this.ctx)
      const next = new Set(workspaces.map(workspace => workspace.path))
      const removed = [...this.workspaceSet].filter(path => !next.has(path))
      for (const path of removed) {
        this.workspaceSet.delete(path)
        this.workspaceDocs.delete(path)
        await this.sync.removeWorkspace(path)
      }
      // Global registry: one read per pass, so a hand edit lands on the next tick.
      try {
        const registry = readRegistry(this.registryPath, this.profileRoot)
        this.registryEntries = registry.entries
        this.registryServers = registry.servers
        this.registryErrors = registry.errors.map(error => `${error.name}: ${error.message}`)
        for (const error of this.registryErrors) {
          this.ctx.logger.warn(`mcp-mgr: registry: ${error}`)
        }
      } catch (error) {
        this.ctx.logger.warn(`mcp-mgr: cannot read ${this.registryPath}: ${String(error instanceof Error ? error.message : error)}`)
        this.registryEntries = {}
        this.registryServers = []
        this.registryErrors = []
      }
      // Workspace documents: selection + inline servers.
      for (const workspace of workspaces) {
        this.workspaceDocs.set(
          workspace.path,
          readWorkspaceDocument(mcpJsonPath(workspace.path), workspace.path),
        )
      }
      const watchFiles = existsSync(this.registryPath) ? [this.registryPath] : []
      for (const workspace of workspaces) {
        if (hasManagerFile(workspace.path)) watchFiles.push(mcpJsonPath(workspace.path))
      }
      this.fileWatcher.setWatchFiles(watchFiles, () => {
        void this.runRescan()
      })
      for (const path of next) this.workspaceSet.add(path)
      // Names live in profile-level mcp-client instances are unmountable:
      // flag rows conflict instead of failing the mount.
      this.sync.setReservedNames(profileServerNames(this.loaderEntries()))
      // Which workspaces select each registry name.
      const selectedBy = new Map<string, string[]>()
      for (const path of [...next].sort((left, right) => left.localeCompare(right))) {
        for (const entryName of this.workspaceDocs.get(path)?.use ?? []) {
          const list = selectedBy.get(entryName)
          if (list === undefined) selectedBy.set(entryName, [path])
          else list.push(path)
        }
      }
      this.selectedBy = selectedBy
      // Global instances: enabled entries somebody selects, mounted once.
      const globalDesired = this.registryServers
        .filter(server => server.enabled && (selectedBy.get(server.name)?.length ?? 0) > 0)
        .filter(server => !this.strictMode
          || (selectedBy.get(server.name) ?? []).includes(this.activeWorkspace))
        .map(server => ({
          name: server.name,
          enabled: true,
          config: withGlobalCwd(server, this.registryEntries[server.name], selectedBy.get(server.name) ?? [], this.profileRoot),
        }))
      await this.sync.syncWorkspace({ workspacePath: GLOBAL_SCOPE, servers: globalDesired })
      // Inline workspace servers: unchanged per-workspace lifecycle.
      for (const path of [...next].sort((left, right) => left.localeCompare(right))) {
        const servers = this.workspaceDocs.get(path)?.servers ?? []
        // Strict mode mounts only the selected workspace; empty desires
        // unmount every other workspace's instances (profile rows stay).
        const desired = this.strictMode && path !== this.activeWorkspace ? [] : servers
        await this.sync.syncWorkspace({ workspacePath: path, servers: desired })
      }
      // A server down at mount reconnects in the background; re-probe so its
      // status flips to connected once the tools actually register.
      this.sync.refreshConnectivity(name => {
        try {
          return serverHasTools(this.ctx, name)
        } catch {
          return false
        }
      })
      this.profileServers = await this.scanProfileEntries()
    } finally {
      this.rescanning = false
    }
  }

  /** Loader entries when the loader service is mounted (web profile). */
  private loaderEntries(): readonly LoaderEntryView[] {
    const loader = (this.ctx as { get?: (name: string) => unknown }).get?.('loader') as
      | { entries(): readonly LoaderEntryView[] }
      | undefined
    return loader?.entries() ?? []
  }

  /**
   * Project profile-level mcp-client registrations (cordis config tree: profile
   * patches, bundles, --patch overlays) as read-only server rows.
   */
  private async scanProfileEntries(): Promise<McpServerState[]> {
    const taken = new Set(this.sync.snapshot().map(server => server.name))
    return scanProfileEntries(this.loaderEntries(), taken)
  }

  private emitChange(): void {
    // The client subscribes through the forwarded-event allowlist; no direct
    // host-side delivery needed today (the UI polls snapshot on demand).
  }
}

/**
 * A global server's child cwd: its own `cwd` when declared, else the first
 * workspace that selects it, else the profile root. A single mounted instance
 * cannot follow every selector, so the choice is deterministic and visible.
 */
function withGlobalCwd(
  server: ParsedServer,
  entry: Readonly<Record<string, unknown>> | undefined,
  selectors: readonly string[],
  profileRoot: string,
): ParsedServer['config'] {
  if (server.config.transport !== 'stdio') return server.config
  if (typeof entry?.cwd === 'string' && entry.cwd.length > 0) return server.config
  const fallback = selectors[0] ?? profileRoot
  return { ...server.config, cwd: fallback }
}

/** Whether the tools registry holds any `mcp__<serverName>__*` tool. */
function serverHasTools(ctx: unknown, serverName: string): boolean {
  // ctx.get, never property access: un-injected service properties throw
  // under Cordis's inject guard, and `tools` is an optional probe here.
  const tools = (ctx as { get?: (name: string) => unknown }).get?.('tools') as
    | { schemas(scope?: string | undefined): readonly { name: string }[] }
    | undefined
  if (tools === undefined) return false
  const prefix = `mcp__${serverName}__`
  // The gateway's own scope view: includes the global layer and every scope
  // on the gateway's chain, so scoped registrations are visible too.
  const names = tools.schemas(scopeOf(ctx))
  return names.some(schema => schema.name.startsWith(prefix))
}

/**
 * Plugin entry: register the gateway service.
 *
 * No default export: the loader's `unwrapExports` picks `exports.default`
 * when present, which would strip `Config` off the module namespace. A
 * namespace-shaped plugin (`name`/`inject`/`apply`/`Config` exports) is the
 * loader's object form.
 */
export function apply(ctx: Context, config: Config): void {
  if (!config.enabled) return
  new McpMgrGateway(ctx, config)
}
