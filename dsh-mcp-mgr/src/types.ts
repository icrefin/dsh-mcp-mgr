/**
 * Public payload types of the dsh-mcp-mgr Remote surface and internal state.
 * @module dsh-mcp-mgr/types
 */

/** Where one MCP server registration comes from. */
export type McpServerSource = 'global' | 'workspace' | 'profile'

/** Model-visible lifecycle status of one dynamically registered MCP server. */
export type McpServerStatus =
  | 'connecting'
  | 'active'
  | 'error'
  | 'conflict'
  | 'removing'
  | 'configured'
  | 'disabled'

/** One live or declared MCP server row. */
export interface McpServerState {
  /** Stable instance key: `@global#<name>` for global rows, `<workspacePath>#<serverName>` for workspace rows, `profile#<entryId>` for profile rows. */
  readonly key: string
  /** Registration origin: the global registry, a workspace mcp.json, or a profile-level config entry. */
  readonly source: McpServerSource
  /** serverName namespace. */
  readonly name: string
  readonly transport: 'stdio' | 'streamable-http'
  /** Workspace rows only: false when the mcp.json entry is disabled (`enabled: false`). */
  readonly enabled?: boolean | undefined
  readonly status: McpServerStatus
  /** Human-readable failure text when status is error/conflict. */
  readonly error?: string | undefined
  /**
   * Whether real connectivity was probed at mount (the server's tools are
   * registered). Absent for profile rows.
   */
  readonly connected?: boolean | undefined
  /** Why the connectivity probe could not run/complete. */
  readonly probeError?: string | undefined
  /** Workspace source only: directory that contributed this row. */
  readonly workspace?: string | undefined
  /** Profile source only: config file declaring the entry. */
  readonly sourceFile?: string | undefined
}

/** One global-registry entry merged with its live state. */
export interface McpGlobalServerView {
  readonly name: string
  readonly transport: 'stdio' | 'streamable-http'
  /** Registry-level switch: a disabled entry stays listed but never mounts. */
  readonly enabled: boolean
  /** One-line command/URL summary for the table. */
  readonly detail: string
  /**
   * The stored entry as pretty-printed JSON. The Remote boundary carries no
   * unconstrained values, so the JSON editor round-trips text.
   */
  readonly entryJson: string
  /** Workspaces whose mcp.json selects this server. */
  readonly usedBy: readonly string[]
  readonly status: McpServerStatus
  readonly error?: string | undefined
  readonly connected?: boolean | undefined
  readonly probeError?: string | undefined
}

/** One workspace: which global servers it selects, plus its own inline servers. */
export interface McpWorkspaceView {
  readonly path: string
  /** Global server names this workspace's `use` list selects. */
  readonly use: readonly string[]
  /** Selected names with no registry entry behind them. */
  readonly missing: readonly string[]
  /** Inline `mcpServers` entries declared by this workspace's own file. */
  readonly locals: readonly McpServerState[]
  /** Read/validation problems found in this workspace's file. */
  readonly errors: readonly string[]
}

/** Full manager projection served to the UI. */
export interface McpManagerSnapshot {
  /** Absolute path of the global registry file. */
  readonly registryPath: string
  readonly global: readonly McpGlobalServerView[]
  readonly workspaces: readonly McpWorkspaceView[]
  /** Read-only rows declared by the cordis config tree. */
  readonly profile: readonly McpServerState[]
  /** Workspace directories currently being discovered. */
  readonly watchedWorkspaces: readonly string[]
  /** Strict mode: only the active workspace's servers are mounted. */
  readonly strictMode: boolean
  /** Strict-mode target: the workspace the UI last reported ('' when none). */
  readonly activeWorkspace: string
}

/** One global-registry upsert through the structured form. */
export interface McpGlobalServerDraft {
  /** serverName namespace; must match `[A-Za-z0-9_-]{1,32}`. */
  readonly name: string
  readonly transport: 'stdio' | 'streamable-http'
  /** stdio transport: executable. */
  readonly command?: string | undefined
  /** stdio transport: arguments. */
  readonly args?: readonly string[] | undefined
  /** stdio transport: extra env merged over the scrubbed ambient env. */
  readonly env?: Readonly<Record<string, string>> | undefined
  /** http transport: MCP endpoint URL. */
  readonly url?: string | undefined
  /** http transport: extra headers. */
  readonly headers?: Readonly<Record<string, string>> | undefined
  /** Child working directory; defaults to the first workspace that selects it. */
  readonly cwd?: string | undefined
  /** Registry switch; false keeps the entry listed but unmounted. */
  readonly enabled?: boolean | undefined
}

/** Outcome of one JSON snippet import (bulk upsert). */
export interface McpJsonImportResult {
  readonly ok: boolean
  /** Names created by this import. */
  readonly added: readonly string[]
  /** Names replaced by this import. */
  readonly updated: readonly string[]
  /** Rejected entries, each with its reason. */
  readonly errors: readonly McpJsonImportError[]
}

/** One rejected entry of a JSON snippet import. */
export interface McpJsonImportError {
  readonly name: string
  readonly message: string
}

/** One workspace-local server entry for create/update through the Remote. */
export interface McpServerDraft {
  /** Workspace directory owning the mcp.json to write. */
  readonly workspace: string
  /** serverName namespace; must match `[A-Za-z0-9_-]{1,32}`. */
  readonly name: string
  readonly transport: 'stdio' | 'streamable-http'
  /** stdio transport: executable. */
  readonly command?: string | undefined
  /** stdio transport: arguments. */
  readonly args?: readonly string[] | undefined
  /** stdio transport: extra env merged over the scrubbed ambient env. */
  readonly env?: Readonly<Record<string, string>> | undefined
  /** http transport: MCP endpoint URL. */
  readonly url?: string | undefined
  /** http transport: extra headers. */
  readonly headers?: Readonly<Record<string, string>> | undefined
  /** Child working directory; defaults to the workspace root. */
  readonly cwd?: string | undefined
}

export type McpApplyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string }

/* ------------------------------------------------------------ drift guard */
/*
 * Each interface above must describe exactly what the boundary codec in
 * `typert.descriptors.ts` accepts. The two are written separately — the
 * interface is what the host and browser halves compile against, the schema is
 * what the runtime validates at the wire — so nothing but this check stops
 * them drifting apart.
 *
 * The check is mutual assignability, in both directions, which is the property
 * that actually matters: a field the schema admits and the interface rejects is
 * data silently dropped at the boundary, and a field the interface promises and
 * the schema rejects is a compile-clean call that fails at runtime. Either way
 * one of the two lines below stops compiling and names the field.
 *
 * `Same<A, B>` is `true` only when both directions hold; `AssertTrue` rejects
 * `false`. The aliases are deliberately unused — this is a compile-time
 * assertion, not a value.
 */
type Same<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false
type AssertTrue<Value extends true> = Value

type _ServerStateMatches = AssertTrue<Same<McpServerState, import('./typert.descriptors.ts').McpServerStateInferred>>
type _GlobalViewMatches = AssertTrue<Same<McpGlobalServerView, import('./typert.descriptors.ts').McpGlobalServerViewInferred>>
type _WorkspaceViewMatches = AssertTrue<Same<McpWorkspaceView, import('./typert.descriptors.ts').McpWorkspaceViewInferred>>
type _SnapshotMatches = AssertTrue<Same<McpManagerSnapshot, import('./typert.descriptors.ts').McpManagerSnapshotInferred>>
type _ApplyResultMatches = AssertTrue<Same<McpApplyResult, import('./typert.descriptors.ts').McpApplyResultInferred>>
type _JsonImportMatches = AssertTrue<Same<McpJsonImportResult, import('./typert.descriptors.ts').McpJsonImportResultInferred>>
type _GlobalDraftMatches = AssertTrue<Same<McpGlobalServerDraft, import('./typert.descriptors.ts').McpGlobalServerDraftInferred>>
type _ServerDraftMatches = AssertTrue<Same<McpServerDraft, import('./typert.descriptors.ts').McpServerDraftInferred>>

/* The aliases exist only to be checked; reference them so the compiler does not
 * report them as unused. */
export type DriftGuards = [
  _ServerStateMatches, _GlobalViewMatches, _WorkspaceViewMatches, _SnapshotMatches,
  _ApplyResultMatches, _JsonImportMatches, _GlobalDraftMatches, _ServerDraftMatches,
]
