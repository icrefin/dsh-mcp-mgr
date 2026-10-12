/**
 * The `mcpMgr` Remote descriptors.
 *
 * One table drives both published artifacts: `typert.host.ts` wraps it as the
 * host `TYPERT` manifest (what `dsh-typert-loader` registers), and
 * `typert.remote-client.ts` wraps it as the `TYPERT_REMOTE` contribution the
 * browser half mounts with `ctx.remote.$mount`. Because the descriptors are
 * shared, the two faces cannot disagree about a wire name or a codec — the
 * failure mode the dsh pipeline guards against by regenerating both from one
 * FaceModel.
 *
 * Remote hardening rules this table follows, all enforced by the runtime:
 * - every parameter and result codec is `mode: 'strict'` with a `typeSymbol`
 *   and a `create()` factory (`dsh-typert-loader` rejects anything else);
 * - every parameter carries a unique `wire` name and is `source: 'json'`;
 * - the invocation id is `<package>#<namespace>/<method>` and the namespace
 *   equals the Cordis service key, so the client reads it back as
 *   `ctx.get('remote.mcpMgr')`.
 *
 * The schemas below are a hand transcription of the pair the generator emitted
 * for this package, and they are transcribed one for one: the `.readonly()` on
 * every field, the `z.union([z.undefined(), …]).readonly().optional()` spelling
 * of an optional field, and the literal order inside each union are reproduced
 * exactly. A mismatch here silently strips fields at the boundary, which looks
 * like a host bug rather than a descriptor bug.
 *
 * @module dsh-mcp-mgr/typert.descriptors
 */

import type { InvocationDescriptor, TypertCodec, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'

/** npm package that owns the Remote methods. */
export const PACKAGE_NAME = 'dsh-mcp-mgr'

/** Wire namespace and Cordis service key of the management gateway. */
export const REMOTE_NAMESPACE = 'mcpMgr'

/** One business parameter of a Remote method. */
interface ParamSpec {
  /** Source-level parameter name (also the wire key). */
  readonly name: string
  /** Published type identity of the codec. */
  readonly type: string
  /** Boundary schema. */
  readonly schema: z.ZodType
}

/** One Remote method. */
interface MethodSpec {
  readonly method: string
  readonly params: readonly ParamSpec[]
  readonly result: { readonly type: string; readonly schema: z.ZodType }
}

/** Wrap a schema as the strict codec the runtime requires. */
function codec(typeSymbol: string, schema: z.ZodType): TypertCodec {
  return { mode: 'strict', typeSymbol, create: () => schema }
}

/**
 * Shortcut: a parameter whose schema is an ad-hoc primitive. The generated
 * type symbol is `<package>#<namespace>/<method>:<name>`, not the `<package>`
 * form `typed` uses.
 */
function param(method: string, name: string, schema: z.ZodType): ParamSpec {
  return { name, type: `${PACKAGE_NAME}#${REMOTE_NAMESPACE}/${method}:${name}`, schema }
}

/** Shortcut: a parameter whose schema is a published named type. */
function typed(name: string, type: string, schema: z.ZodType): ParamSpec {
  return { name, type: `${PACKAGE_NAME}/types#${type}`, schema }
}

/** Shortcut: a published named result type. */
const metric = (type: string, schema: z.ZodType) => ({ type: `${PACKAGE_NAME}/types#${type}`, schema })

/* ----------------------------------------------------------------- wire */
/*
 * The boundary schemas, rebuilt here rather than imported: the runtime needs a
 * real zod schema per codec, and these are the shapes the generator emitted.
 * They stay private to this module — `types.ts` remains the TypeScript
 * contract, and `McpX = z.infer<typeof X>` equality is what keeps the two in
 * step.
 */

/** `McpServerState` as the snapshot carries it. */
export const McpServerState = z.object({
  key: z.string().readonly(),
  source: z.union([z.literal('global'), z.literal('workspace'), z.literal('profile')]).readonly(),
  name: z.string().readonly(),
  transport: z.union([z.literal('stdio'), z.literal('streamable-http')]).readonly(),
  enabled: z.union([z.undefined(), z.literal(false), z.literal(true)]).readonly().optional(),
  status: z
    .union([
      z.literal('connecting'),
      z.literal('active'),
      z.literal('error'),
      z.literal('conflict'),
      z.literal('removing'),
      z.literal('configured'),
      z.literal('disabled'),
    ])
    .readonly(),
  error: z.union([z.undefined(), z.string()]).readonly().optional(),
  connected: z.union([z.undefined(), z.literal(false), z.literal(true)]).readonly().optional(),
  probeError: z.union([z.undefined(), z.string()]).readonly().optional(),
  workspace: z.union([z.undefined(), z.string()]).readonly().optional(),
  sourceFile: z.union([z.undefined(), z.string()]).readonly().optional(),
})

/** One global-registry row. */
export const McpGlobalServerView = z.object({
  name: z.string().readonly(),
  transport: z.union([z.literal('stdio'), z.literal('streamable-http')]).readonly(),
  enabled: z.boolean().readonly(),
  detail: z.string().readonly(),
  entryJson: z.string().readonly(),
  usedBy: z.array(z.string()).readonly(),
  status: z
    .union([
      z.literal('connecting'),
      z.literal('active'),
      z.literal('error'),
      z.literal('conflict'),
      z.literal('removing'),
      z.literal('configured'),
      z.literal('disabled'),
    ])
    .readonly(),
  error: z.union([z.undefined(), z.string()]).readonly().optional(),
  connected: z.union([z.undefined(), z.literal(false), z.literal(true)]).readonly().optional(),
  probeError: z.union([z.undefined(), z.string()]).readonly().optional(),
})

/** One workspace row. */
export const McpWorkspaceView = z.object({
  path: z.string().readonly(),
  use: z.array(z.string()).readonly(),
  missing: z.array(z.string()).readonly(),
  locals: z.array(McpServerState).readonly(),
  errors: z.array(z.string()).readonly(),
})

/** The full manager projection. */
export const McpManagerSnapshot = z.object({
  registryPath: z.string().readonly(),
  global: z.array(McpGlobalServerView).readonly(),
  workspaces: z.array(McpWorkspaceView).readonly(),
  profile: z.array(McpServerState).readonly(),
  watchedWorkspaces: z.array(z.string()).readonly(),
  strictMode: z.boolean().readonly(),
  activeWorkspace: z.string().readonly(),
})

/** Every mutation's answer. */
export const McpApplyResult = z.union([
  z.object({ ok: z.literal(true).readonly() }),
  z.object({ ok: z.literal(false).readonly(), error: z.string().readonly() }),
])

/** One bulk-import report. */
export const McpJsonImportResult = z.object({
  ok: z.boolean().readonly(),
  added: z.array(z.string()).readonly(),
  updated: z.array(z.string()).readonly(),
  errors: z
    .array(z.object({ name: z.string().readonly(), message: z.string().readonly() }))
    .readonly(),
})

/** A global-registry upsert through the structured form. */
export const McpGlobalServerDraft = z.object({
  name: z.string().readonly(),
  transport: z.union([z.literal('stdio'), z.literal('streamable-http')]).readonly(),
  command: z.union([z.undefined(), z.string()]).readonly().optional(),
  args: z.union([z.undefined(), z.array(z.string())]).readonly().optional(),
  env: z.union([z.undefined(), z.record(z.string(), z.string()).readonly()]).readonly().optional(),
  url: z.union([z.undefined(), z.string()]).readonly().optional(),
  headers: z.union([z.undefined(), z.record(z.string(), z.string()).readonly()]).readonly().optional(),
  cwd: z.union([z.undefined(), z.string()]).readonly().optional(),
  enabled: z.union([z.undefined(), z.literal(false), z.literal(true)]).readonly().optional(),
})

/** One workspace-local server entry. */
export const McpServerDraft = z.object({
  workspace: z.string().readonly(),
  name: z.string().readonly(),
  transport: z.union([z.literal('stdio'), z.literal('streamable-http')]).readonly(),
  command: z.union([z.undefined(), z.string()]).readonly().optional(),
  args: z.union([z.undefined(), z.array(z.string())]).readonly().optional(),
  env: z.union([z.undefined(), z.record(z.string(), z.string()).readonly()]).readonly().optional(),
  url: z.union([z.undefined(), z.string()]).readonly().optional(),
  headers: z.union([z.undefined(), z.record(z.string(), z.string()).readonly()]).readonly().optional(),
  cwd: z.union([z.undefined(), z.string()]).readonly().optional(),
})

/*
 * The schema-derived shapes, exported so `types.ts` can assert that its
 * interfaces still describe them. The runtime types come from these; the
 * interfaces are what the two halves compile against, and the assertions in
 * `types.ts` are what keeps the pair from drifting.
 */
export type McpServerStateInferred = z.infer<typeof McpServerState>
export type McpGlobalServerViewInferred = z.infer<typeof McpGlobalServerView>
export type McpWorkspaceViewInferred = z.infer<typeof McpWorkspaceView>
export type McpManagerSnapshotInferred = z.infer<typeof McpManagerSnapshot>
export type McpApplyResultInferred = z.infer<typeof McpApplyResult>
export type McpJsonImportResultInferred = z.infer<typeof McpJsonImportResult>
export type McpGlobalServerDraftInferred = z.infer<typeof McpGlobalServerDraft>
export type McpServerDraftInferred = z.infer<typeof McpServerDraft>

/** The shared `McpApplyResult` codec, referenced by every mutation. */
const APPLY_RESULT = metric('McpApplyResult', McpApplyResult)

/** The shared `McpManagerSnapshot` codec, referenced by every state read. */
const SNAPSHOT = metric('McpManagerSnapshot', McpManagerSnapshot)

/**
 * Every method the panel can call, in the order the host class declares them.
 *
 * `snapshot` reads the whole management view; `setStrictMode` /
 * `setActiveWorkspace` write gateway state and answer the refreshed snapshot;
 * `importJson` answers its own bulk-import report; every remaining write
 * answers the shared `McpApplyResult`.
 *
 * `version` replaced the old `versionInfo`: it answers just this package's
 * installed version for the title chip, where `versionInfo` also carried the
 * result of an npm self-update check this plugin no longer performs.
 *
 * Two deliberate departures from the generated pair, neither of which is
 * wire-visible:
 * - the generated files listed methods alphabetically by invocation id (an
 *   artifact of the generator's sort); this table lists them in host
 *   declaration order. Nothing indexes the array — the runtime looks
 *   descriptors up by `id` — so only the set matters.
 * - the generated descriptors carried a `sourceLocation`. It is diagnostic
 *   only (`InvocationDescriptor.sourceLocation` is optional and documented as
 *   "used only for diagnostics"), and a hand-written table has no generator
 *   position to record.
 */
const METHODS: readonly MethodSpec[] = [
  /* ---- core ---- */
  // An ad-hoc primitive result, so its symbol follows the generator's
  // `<package>#<namespace>/<method>` spelling for unnamed shapes (the same
  // form a primitive parameter uses, without the trailing `:<name>`).
  { method: 'version', params: [], result: { type: `${PACKAGE_NAME}#${REMOTE_NAMESPACE}/version`, schema: z.string() } },
  { method: 'snapshot', params: [], result: SNAPSHOT },

  /* ---- gateway state ---- */
  {
    method: 'setStrictMode',
    params: [param('setStrictMode', 'enabled', z.boolean())],
    result: SNAPSHOT,
  },
  {
    method: 'setActiveWorkspace',
    params: [param('setActiveWorkspace', 'path', z.string())],
    result: SNAPSHOT,
  },

  /* ---- global registry ---- */
  {
    method: 'saveGlobalServer',
    params: [typed('draft', 'McpGlobalServerDraft', McpGlobalServerDraft)],
    result: APPLY_RESULT,
  },
  {
    method: 'saveGlobalServerJson',
    params: [param('saveGlobalServerJson', 'name', z.string()), param('saveGlobalServerJson', 'text', z.string())],
    result: APPLY_RESULT,
  },
  {
    method: 'removeGlobalServer',
    params: [param('removeGlobalServer', 'name', z.string())],
    result: APPLY_RESULT,
  },
  {
    method: 'setGlobalServerEnabled',
    params: [param('setGlobalServerEnabled', 'name', z.string()), param('setGlobalServerEnabled', 'enabled', z.boolean())],
    result: APPLY_RESULT,
  },
  {
    method: 'importJson',
    params: [param('importJson', 'text', z.string())],
    result: metric('McpJsonImportResult', McpJsonImportResult),
  },

  /* ---- workspace selection ---- */
  {
    method: 'setWorkspaceSelection',
    params: [param('setWorkspaceSelection', 'workspace', z.string()), param('setWorkspaceSelection', 'use', z.array(z.string()))],
    result: APPLY_RESULT,
  },
  {
    method: 'importLocalServer',
    params: [param('importLocalServer', 'workspace', z.string()), param('importLocalServer', 'serverName', z.string())],
    result: APPLY_RESULT,
  },

  /* ---- workspace-local servers ---- */
  { method: 'apply', params: [typed('draft', 'McpServerDraft', McpServerDraft)], result: APPLY_RESULT },
  {
    method: 'removeServer',
    params: [param('removeServer', 'workspace', z.string()), param('removeServer', 'serverName', z.string())],
    result: APPLY_RESULT,
  },
  {
    method: 'setServerEnabled',
    params: [
      param('setServerEnabled', 'workspace', z.string()),
      param('setServerEnabled', 'serverName', z.string()),
      param('setServerEnabled', 'enabled', z.boolean()),
    ],
    result: APPLY_RESULT,
  },
]

/** Build the wire descriptor for one method spec. */
function descriptorOf(spec: MethodSpec): InvocationDescriptor {
  return {
    id: `${PACKAGE_NAME}#${REMOTE_NAMESPACE}/${spec.method}`,
    service: REMOTE_NAMESPACE,
    namespace: REMOTE_NAMESPACE,
    method: spec.method,
    invocation: { kind: 'direct' },
    parameters: spec.params.map((entry) => ({
      name: entry.name,
      wire: entry.name,
      source: 'json' as const,
      codec: codec(entry.type, entry.schema),
    })),
    result: codec(spec.result.type, spec.result.schema),
  }
}

/** Every invocation descriptor, host and client face alike. */
export const DESCRIPTORS: readonly InvocationDescriptor[] = METHODS.map(descriptorOf)

/** The contribution the browser half mounts. */
export const REMOTE_CONTRIBUTION: TypertRemoteContribution = {
  package: PACKAGE_NAME,
  descriptors: DESCRIPTORS,
}

/**
 * Shape of the host-face manifest `dsh-typert-loader` validates and hands to
 * `ctx.typert.register`. The service/event/object inventories stay empty: this
 * package contributes Remote methods, not a Cordis catalog.
 */
export interface TypertHostManifest {
  readonly package: string
  readonly face: 'host'
  readonly schemas: readonly unknown[]
  readonly invocations: readonly InvocationDescriptor[]
  readonly model: {
    readonly services: readonly unknown[]
    readonly events: readonly unknown[]
    readonly objects: readonly unknown[]
  }
}

/** The host manifest. */
export const HOST_MANIFEST: TypertHostManifest = {
  package: PACKAGE_NAME,
  face: 'host',
  schemas: [],
  invocations: DESCRIPTORS,
  model: { services: [], events: [], objects: [] },
}
