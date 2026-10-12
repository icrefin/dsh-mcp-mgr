/**
 * MCP manager panel registered into the Web sidebar: the global server
 * registry plus the per-workspace selection.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { TYPERT_REMOTE } from 'dsh-mcp-mgr/remote'
import type {
  McpApplyResult,
  McpGlobalServerDraft,
  McpJsonImportResult,
  McpManagerSnapshot,
} from 'dsh-mcp-mgr/types'
import { McpManagerSection, type McpManagerInjected } from './McpManagerSection.tsx'
import { McpPanelIcon } from './McpPanelIcon.tsx'
import { en, zh, type McpLocaleKey } from './locales.ts'

export type { McpManagerInjected, McpManagerSectionProps, WorkspaceOption } from './McpManagerSection.tsx'
export type { McpLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP manager copy. */
    mcpMgr: McpLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'mcpMgr'

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'mcpMgr'

/** Services required by the sidebar registration. */
export const inject = ['slots', 'locale', 'remote', 'workspaces']

/** The namespace service this plugin mounts itself — fetched via `ctx.get`, never injected. */
interface McpMgrNamespace {
  snapshot(): Promise<RemoteResult<McpManagerSnapshot>>
  saveGlobalServer(draft: McpGlobalServerDraft): Promise<RemoteResult<McpApplyResult>>
  saveGlobalServerJson(name: string, text: string): Promise<RemoteResult<McpApplyResult>>
  removeGlobalServer(name: string): Promise<RemoteResult<McpApplyResult>>
  setGlobalServerEnabled(name: string, enabled: boolean): Promise<RemoteResult<McpApplyResult>>
  importJson(text: string): Promise<RemoteResult<McpJsonImportResult>>
  setWorkspaceSelection(workspace: string, use: readonly string[]): Promise<RemoteResult<McpApplyResult>>
  importLocalServer(workspace: string, name: string): Promise<RemoteResult<McpApplyResult>>
  setServerEnabled(workspace: string, name: string, enabled: boolean): Promise<RemoteResult<McpApplyResult>>
  removeServer(workspace: string, name: string): Promise<RemoteResult<McpApplyResult>>
  version(): Promise<RemoteResult<string>>
}

/**
 * Mount the mcpMgr Remote contribution and register the management panel with
 * the sidebar entry that opens it.
 *
 * The mount is awaited in `apply` (the api-remotes pattern) so the panel is
 * only registered after the namespace service exists. The namespace is not
 * injected: this plugin provides it itself, and injecting a self-provided
 * service deadlocks the fiber (pending forever). Consumers read it through
 * `ctx.get`, which bypasses the inject guard.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  const disposeMount = await ctx.remote.$mount(TYPERT_REMOTE)
  ctx.effect(() => () => disposeMount(), 'dsh-mcp-mgr-ui: remote mount')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-mcp-mgr-ui: dictionaries')

  const t = ctx.locale.bind(NS)
  const mcpMgr = (): McpMgrNamespace => {
    const namespace = ctx.get('remote.mcpMgr') as McpMgrNamespace | undefined
    if (namespace === undefined) {
      throw new Error('mcpMgr namespace service is not mounted')
    }
    return namespace
  }

  /** Unwrap one Remote result, raising the transport-level failure. */
  const unwrap = <T,>(result: RemoteResult<T>, label: string): T => {
    if (!result.ok) {
      throw new Error(`mcpMgr.${label} failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }

  const injected = (): McpManagerInjected => ({
    snapshot: async () => unwrap(await mcpMgr().snapshot(), 'snapshot'),
    saveGlobalServer: async draft => unwrap(await mcpMgr().saveGlobalServer(draft), 'saveGlobalServer'),
    saveGlobalServerJson: async (name, text) => unwrap(await mcpMgr().saveGlobalServerJson(name, text), 'saveGlobalServerJson'),
    removeGlobalServer: async name => unwrap(await mcpMgr().removeGlobalServer(name), 'removeGlobalServer'),
    setGlobalServerEnabled: async (name, enabled) => unwrap(await mcpMgr().setGlobalServerEnabled(name, enabled), 'setGlobalServerEnabled'),
    importJson: async text => unwrap(await mcpMgr().importJson(text), 'importJson'),
    setWorkspaceSelection: async (workspace, use) => unwrap(await mcpMgr().setWorkspaceSelection(workspace, use), 'setWorkspaceSelection'),
    importLocalServer: async (workspace, name) => unwrap(await mcpMgr().importLocalServer(workspace, name), 'importLocalServer'),
    setServerEnabled: async (workspace, name, enabled) => unwrap(await mcpMgr().setServerEnabled(workspace, name, enabled), 'setServerEnabled'),
    removeServer: async (workspace, name) => unwrap(await mcpMgr().removeServer(workspace, name), 'removeServer'),
    version: async () => unwrap(await mcpMgr().version(), 'version'),
    listWorkspaces: () => ctx.workspaces.list.getSnapshot().items.map(workspace => ({
      path: workspace.path,
      title: workspace.title,
    })),
  })

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: injected,
  }, McpManagerSection))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 1,
    label: () => t('panel'),
    locale: NS,
  }, McpPanelIcon))
}
