/**
 * Client-face Typert artifact.
 *
 * The browser half mounts this with `ctx.remote.$mount(TYPERT_REMOTE)`; the
 * client API gateway validates that every parameter carries a strict codec and
 * then installs the namespace service under `remote.mcpMgr`.
 *
 * The `declare module` block below is this package's contribution to the
 * Remote type tables, so consumers read the namespace without a cast:
 * `ctx.get('remote.mcpMgr')` is typed from `TypertRemoteNamespaceMap`.
 *
 * @module dsh-mcp-mgr/typert.remote-client
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  McpApplyResult,
  McpGlobalServerDraft,
  McpJsonImportResult,
  McpManagerSnapshot,
  McpServerDraft,
} from './types.ts'
import { REMOTE_CONTRIBUTION } from './typert.descriptors.ts'

/** Methods of the `mcpMgr` namespace, as the browser half sees them. */
export interface McpMgrNamespace {
  snapshot: () => Promise<RemoteResult<McpManagerSnapshot>>
  setStrictMode: (enabled: boolean) => Promise<RemoteResult<McpManagerSnapshot>>
  setActiveWorkspace: (path: string) => Promise<RemoteResult<McpManagerSnapshot>>
  saveGlobalServer: (draft: McpGlobalServerDraft) => Promise<RemoteResult<McpApplyResult>>
  saveGlobalServerJson: (name: string, text: string) => Promise<RemoteResult<McpApplyResult>>
  removeGlobalServer: (name: string) => Promise<RemoteResult<McpApplyResult>>
  setGlobalServerEnabled: (name: string, enabled: boolean) => Promise<RemoteResult<McpApplyResult>>
  importJson: (text: string) => Promise<RemoteResult<McpJsonImportResult>>
  setWorkspaceSelection: (workspace: string, use: readonly string[]) => Promise<RemoteResult<McpApplyResult>>
  importLocalServer: (workspace: string, serverName: string) => Promise<RemoteResult<McpApplyResult>>
  apply: (draft: McpServerDraft) => Promise<RemoteResult<McpApplyResult>>
  removeServer: (workspace: string, serverName: string) => Promise<RemoteResult<McpApplyResult>>
  setServerEnabled: (workspace: string, serverName: string, enabled: boolean) => Promise<RemoteResult<McpApplyResult>>
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  /** Concrete methods of the `mcpMgr` namespace. */
  interface TypertRemoteNamespace$mcpMgr extends McpMgrNamespace {}
  interface TypertRemoteMap {
    'mcpMgr/snapshot': McpMgrNamespace['snapshot']
    'mcpMgr/setStrictMode': McpMgrNamespace['setStrictMode']
    'mcpMgr/setActiveWorkspace': McpMgrNamespace['setActiveWorkspace']
    'mcpMgr/saveGlobalServer': McpMgrNamespace['saveGlobalServer']
    'mcpMgr/saveGlobalServerJson': McpMgrNamespace['saveGlobalServerJson']
    'mcpMgr/removeGlobalServer': McpMgrNamespace['removeGlobalServer']
    'mcpMgr/setGlobalServerEnabled': McpMgrNamespace['setGlobalServerEnabled']
    'mcpMgr/importJson': McpMgrNamespace['importJson']
    'mcpMgr/setWorkspaceSelection': McpMgrNamespace['setWorkspaceSelection']
    'mcpMgr/importLocalServer': McpMgrNamespace['importLocalServer']
    'mcpMgr/apply': McpMgrNamespace['apply']
    'mcpMgr/removeServer': McpMgrNamespace['removeServer']
    'mcpMgr/setServerEnabled': McpMgrNamespace['setServerEnabled']
  }
  interface TypertRemoteNamespaceMap {
    mcpMgr: TypertRemoteNamespace$mcpMgr
  }
}

/** The contribution the browser half hands to `ctx.remote.$mount`. */
export const TYPERT_REMOTE = REMOTE_CONTRIBUTION

export default TYPERT_REMOTE
