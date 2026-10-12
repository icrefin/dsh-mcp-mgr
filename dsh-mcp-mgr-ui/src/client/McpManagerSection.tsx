/**
 * MCP manager panel page: the global server registry (add / edit / delete
 * through a form or a JSON entry) and the per-workspace selection that decides
 * which of those servers each workspace mounts.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, SegmentedTabs, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  McpApplyResult,
  McpGlobalServerDraft,
  McpGlobalServerView,
  McpJsonImportResult,
  McpManagerSnapshot,
  McpServerState,
  McpServerStatus,
  McpWorkspaceView,
} from 'dsh-mcp-mgr/types'
import { McpServerEditor } from './McpServerEditor.tsx'
import type { McpLocaleKey } from './locales.ts'
import css from './McpManagerSection.module.css'

/**
 * The author credit the style contract prints inside the version chip, to the
 * right of the version itself (`STYLES.md`: `"v" + version + " Author: …"`).
 */
const AUTHOR_CREDIT = 'Author: icrefin [icrefinai@gmail.com]'

/** One workspace row the selection UI may target. */
export interface WorkspaceOption {
  readonly path: string
  readonly title: string
}

/** Registration-side Remote face used by the panel. */
export interface McpManagerInjected {
  /** Read a current manager snapshot. */
  snapshot: () => Promise<McpManagerSnapshot>
  /** Create or replace one global server from the structured form. */
  saveGlobalServer: (draft: McpGlobalServerDraft) => Promise<McpApplyResult>
  /** Create or replace one global server from a raw JSON entry. */
  saveGlobalServerJson: (name: string, text: string) => Promise<McpApplyResult>
  /** Delete one global server. */
  removeGlobalServer: (name: string) => Promise<McpApplyResult>
  /** Enable or disable one global server. */
  setGlobalServerEnabled: (name: string, enabled: boolean) => Promise<McpApplyResult>
  /** Bulk-import a JSON snippet into the global registry. */
  importJson: (text: string) => Promise<McpJsonImportResult>
  /** Replace one workspace's selection of global servers. */
  setWorkspaceSelection: (workspace: string, use: readonly string[]) => Promise<McpApplyResult>
  /** Move one workspace-local server into the global registry. */
  importLocalServer: (workspace: string, name: string) => Promise<McpApplyResult>
  /** Enable or disable one workspace-local server. */
  setServerEnabled: (workspace: string, name: string, enabled: boolean) => Promise<McpApplyResult>
  /** Delete one workspace-local server. */
  removeServer: (workspace: string, name: string) => Promise<McpApplyResult>
  /** This plugin's installed version, for the chip beside the title. */
  version: () => Promise<string>
  /** Registered workspaces, for titles and the empty state. */
  listWorkspaces: () => readonly WorkspaceOption[]
}

/** Full component props assembled by the main panel slot renderer. */
export type McpManagerSectionProps =
  PropsRuntime<'main'>
  & PropsLocale<'mcpMgr'>
  & InjectFace<McpManagerInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: McpManagerSnapshot }

/** The two views of the manager: what exists, and who uses it. */
type PanelTab = 'global' | 'workspaces'

/** Badge label key for one display status (raw status + connectivity derivation). */
const DISPLAY_KEYS = {
  connected: 'connected',
  registered: 'active',
  connecting: 'connecting',
  active: 'active',
  error: 'errorStatus',
  conflict: 'conflict',
  removing: 'removing',
  configured: 'configured',
  disabled: 'disabled',
} satisfies Record<DisplayStatus, McpLocaleKey>

/** Display status: an 'active' row reports real connectivity when probed. */
type DisplayStatus = 'connected' | 'registered' | McpServerStatus

function displayStatus(row: { readonly status: McpServerStatus; readonly connected?: boolean | undefined }): DisplayStatus {
  return row.status === 'active'
    ? (row.connected === true ? 'connected' : 'registered')
    : row.status
}

/** One status badge with its tooltip. */
function StatusBadge({ row, t }: { row: McpServerState | McpGlobalServerView; t: (key: McpLocaleKey) => string }): ReactNode {
  const status = displayStatus(row)
  return (
    <>
      <span
        className={css.statusBadge}
        data-status={status}
        title={
          status === 'connected' ? t('connectedHint')
            : status === 'registered' ? t('activeHint')
            : undefined
        }
      >
        {t(DISPLAY_KEYS[status])}
      </span>
      {row.error !== undefined
        ? <span className={css.errorText} title={row.error}>{row.error}</span>
        : status === 'registered' && row.probeError !== undefined
          ? <span className={css.errorText} title={row.probeError}>{row.probeError}</span>
          : null}
    </>
  )
}

/** Short display form of a directory path. */
function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.length === 0 ? path : (parts[parts.length - 1] as string)
}

/** Whether two selections carry the same names, regardless of order. */
function sameSelection(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every(name => right.includes(name))
}

/**
 * The section: global registry first, then the workspaces that choose from it.
 */
export function McpManagerSection({
  snapshot, saveGlobalServer, saveGlobalServerJson, removeGlobalServer, setGlobalServerEnabled,
  importJson, setWorkspaceSelection, importLocalServer, setServerEnabled, removeServer,
  version, listWorkspaces, t,
}: McpManagerSectionProps): ReactNode {
  const [request, setRequest] = useState(0)
  const [tab, setTab] = useState<PanelTab>('global')
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ name: string; entryJson: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  /**
   * Selection shown ahead of the snapshot that confirms it, per workspace path.
   * A toggle must not wait for the reload: falling back to the previous snapshot
   * mid-refresh would flip the checkbox back and then forward again.
   */
  const [pendingUse, setPendingUse] = useState<ReadonlyMap<string, readonly string[]>>(() => new Map())

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => snapshot()).then(
      (value) => {
        if (!current) return
        setState({ status: 'ready', snapshot: value })
        setErrorDetail(null)
        setRefreshing(false)
        // Retire only the overrides this snapshot agrees with, so a toggle made
        // while the reload was in flight keeps its optimistic value.
        setPendingUse((previous) => {
          if (previous.size === 0) return previous
          const next = new Map(previous)
          for (const workspace of value.workspaces) {
            const pending = next.get(workspace.path)
            if (pending !== undefined && sameSelection(pending, workspace.use)) next.delete(workspace.path)
          }
          return next
        })
      },
      (error) => {
        if (!current) return
        setState({ status: 'error' })
        setErrorDetail(String(error instanceof Error ? error.message : error))
        setRefreshing(false)
      },
    )
    return () => { current = false }
  }, [snapshot, request])

  const view = state.status === 'ready' ? state.snapshot : undefined
  const workspaces = view?.workspaces ?? []
  const global = view?.global ?? []

  /** Workspace titles by path (the snapshot only carries paths). */
  const titles = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of listWorkspaces()) map.set(item.path, item.title)
    return map
  }, [listWorkspaces, state])

  /** Installed plugin version beside the title; '' until the host answers. */
  const [localVersion, setLocalVersion] = useState('')

  useEffect(() => {
    let current = true
    void version().then(
      (value) => { if (current) setLocalVersion(value) },
      () => { if (current) setLocalVersion('') },
    )
    return () => { current = false }
  }, [version])

  /**
   * Re-read the snapshot while keeping the one on screen. Replacing it with a
   * loading view unmounts the content inside the panel's scroll container, which
   * clamps the scroll position to the top.
   */
  const reload = (): void => {
    setRefreshing(true)
    setRequest(value => value + 1)
  }

  /** Run one mutation, then reload and report. */
  const mutate = async (
    key: string,
    run: () => Promise<McpApplyResult>,
    success: string,
  ): Promise<boolean> => {
    setBusy(key)
    setNotice(null)
    let result: McpApplyResult
    try {
      result = await run()
    } catch (error) {
      setBusy(null)
      setNotice(`${t('applyFailed')}: ${String(error instanceof Error ? error.message : error)}`)
      return false
    }
    setBusy(null)
    if (!result.ok) {
      setNotice(`${t('applyFailed')}: ${result.error}`)
      return false
    }
    setNotice(success)
    reload()
    return true
  }

  const onToggleSelection = async (workspace: McpWorkspaceView, name: string, selected: boolean): Promise<void> => {
    const current = pendingUse.get(workspace.path) ?? workspace.use
    const next = selected
      ? [...current, name]
      : current.filter(entry => entry !== name)
    setPendingUse(previous => new Map(previous).set(workspace.path, next))
    const applied = await mutate(
      `use:${workspace.path}:${name}`,
      () => setWorkspaceSelection(workspace.path, next),
      t('selectionSaved'),
    )
    if (!applied) {
      setPendingUse((previous) => {
        const reverted = new Map(previous)
        reverted.delete(workspace.path)
        return reverted
      })
    }
  }

  const onCloseEditor = (noticeText?: string): void => {
    setEditor(null)
    setAdding(false)
    if (noticeText !== undefined) {
      setNotice(noticeText)
      reload()
    }
  }

  return (
    <section className={css.page} aria-busy={state.status === 'loading' || refreshing}>
      {notice !== null ? <Toast text={notice} onDone={() => { setNotice(null) }} /> : null}
      <header className={css.pageHead}>
        <div>
          <h1 className={css.pageTitle}>
            {t('panel')}
            {localVersion !== '' ? <span className={css.pluginVersion}>{`v${localVersion} ${AUTHOR_CREDIT}`}</span> : null}
          </h1>
          <p className={css.pageIntro}>{t('intro')}</p>
        </div>
        <div className={css.toolbar}>
          <Button variant="outline" size="sm" onClick={reload}>{t('refresh')}</Button>
        </div>
      </header>

      <SegmentedTabs
        className={css.tabs}
        label={t('tabsLabel')}
        value={tab}
        onChange={setTab}
        items={[
          { value: 'global', label: t('globalHeading'), id: 'mcpMgr-tab-global', panelId: 'mcpMgr-panel-global' },
          { value: 'workspaces', label: t('workspacesHeading'), id: 'mcpMgr-tab-workspaces', panelId: 'mcpMgr-panel-workspaces' },
        ]}
      />

      <div className={css.body}>
        {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
        {state.status === 'error' ? (
          <div className={css.failure}>
            <p className={css.errorLine} role="alert">{t('error')}</p>
            {errorDetail !== null ? <p className={css.errorText} role="alert">{errorDetail}</p> : null}
            <Button variant="outline" size="sm" onClick={reload}>{t('retry')}</Button>
          </div>
        ) : null}

        {view !== undefined ? (
          <>
            <div
              role="tabpanel"
              id="mcpMgr-panel-global"
              aria-labelledby="mcpMgr-tab-global"
              className={css.panel}
              hidden={tab !== 'global'}
            >
              <div className={css.panelHead}>
                {view.registryPath.length > 0 ? (
                  <p className={`${css.hint} ${css.panelHint}`} title={view.registryPath}>{t('registryStored')} {view.registryPath}</p>
                ) : null}
                <Button variant="primary" size="sm" onClick={() => { setAdding(true) }}>{t('add')}</Button>
              </div>
              {global.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
              {global.length > 0 ? (
                <table className={css.table}>
                  <thead>
                    <tr>
                      <th>{t('nameColumn')}</th>
                      <th>{t('typeColumn')}</th>
                      <th>{t('detailColumn')}</th>
                      <th>{t('status')}</th>
                      <th>{t('usedByColumn')}</th>
                      <th>{t('action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {global.map(row => (
                      <tr key={row.name} data-enabled={row.enabled}>
                        <td className={css.nowrapCell} title={row.name}>{row.name}</td>
                        <td className={css.nowrapCell}>{row.transport}</td>
                        <td className={css.detailCell} title={row.detail}>{row.detail}</td>
                        <td className={css.nowrapCell}><StatusBadge row={row} t={t} /></td>
                        <td className={css.usedByCell}>
                          {row.usedBy.length === 0
                            ? <span className={css.muted}>{t('unused')}</span>
                            : row.usedBy.map(path => (
                              <span className={css.usedByChip} key={path} title={path}>
                                {titles.get(path) ?? shortPath(path)}
                              </span>
                            ))}
                        </td>
                        <td className={css.nowrapCell}>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => { setEditor({ name: row.name, entryJson: row.entryJson }) }}
                          >
                            {t('edit')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy === `global:${row.name}`}
                            onClick={() => {
                              void mutate(
                                `global:${row.name}`,
                                () => setGlobalServerEnabled(row.name, !row.enabled),
                                row.enabled ? t('disabled') : t('enabled'),
                              )
                            }}
                          >
                            {row.enabled ? t('disable') : t('enable')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={css.danger}
                            disabled={busy === `global:${row.name}`}
                            onClick={() => {
                              void mutate(`global:${row.name}`, () => removeGlobalServer(row.name), t('removed'))
                            }}
                          >
                            {t('remove')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {view.profile.length > 0 ? (
                <>
                  <h3 className={css.heading}>{t('profileHeading')}</h3>
                  <table className={css.table}>
                    <thead>
                      <tr>
                        <th>{t('nameColumn')}</th>
                        <th>{t('typeColumn')}</th>
                        <th>{t('status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.profile.map(row => (
                        <tr key={row.key}>
                          <td className={css.nowrapCell} title={row.name}>{row.name}</td>
                          <td className={css.nowrapCell}>{row.transport}</td>
                          <td className={css.nowrapCell}>
                            <StatusBadge row={row} t={t} />
                            {row.sourceFile !== undefined
                              ? <span className={css.hint} title={row.sourceFile}> {shortPath(row.sourceFile)}</span>
                              : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}
            </div>

            <div
              role="tabpanel"
              id="mcpMgr-panel-workspaces"
              aria-labelledby="mcpMgr-tab-workspaces"
              className={css.panel}
              hidden={tab !== 'workspaces'}
            >
              {workspaces.length === 0 ? <p className={css.status}>{t('noWorkspaces')}</p> : null}
              {workspaces.map(workspace => {
                const open = expanded.has(workspace.path)
                const use = pendingUse.get(workspace.path) ?? workspace.use
                const selected = new Set(use)
                return (
                  <div className={css.workspace} key={workspace.path}>
                    <button
                      type="button"
                      className={css.workspaceHead}
                      aria-expanded={open}
                      onClick={() => {
                        setExpanded((previous) => {
                          const next = new Set(previous)
                          if (next.has(workspace.path)) next.delete(workspace.path)
                          else next.add(workspace.path)
                          return next
                        })
                      }}
                    >
                      <span className={css.chevron} data-open={open}>▸</span>
                      <span className={css.workspaceTitle}>{titles.get(workspace.path) ?? shortPath(workspace.path)}</span>
                      <span className={css.workspaceCount}>
                        {use.length}/{global.length}
                      </span>
                      <span className={css.workspacePath} title={workspace.path}>{workspace.path}</span>
                    </button>
                    {open ? (
                      <div className={css.workspaceBody}>
                        {global.length === 0 ? <p className={css.hint}>{t('empty')}</p> : null}
                        {global.map(row => (
                          <label className={css.pick} key={row.name}>
                            <input
                              type="checkbox"
                              checked={selected.has(row.name)}
                              disabled={busy === `use:${workspace.path}:${row.name}`}
                              onChange={(event) => {
                                void onToggleSelection(workspace, row.name, event.target.checked)
                              }}
                            />
                            <span className={css.pickName}>{row.name}</span>
                            <span className={css.pickMeta}>{row.transport}</span>
                            {row.enabled ? null : <span className={css.pickMeta}>{t('disabled')}</span>}
                          </label>
                        ))}
                        {workspace.missing.length > 0 ? (
                          <p className={css.warning}>
                            {t('missingRefs')}: {workspace.missing.join(', ')}
                          </p>
                        ) : null}
                        {workspace.errors.length > 0 ? (
                          <p className={css.warning}>{workspace.errors.join('; ')}</p>
                        ) : null}
                        <h4 className={css.subHeading}>{t('localsHeading')}</h4>
                        {workspace.locals.length === 0 ? <p className={css.hint}>{t('kvEmpty')}</p> : null}
                        {workspace.locals.map(local => (
                          <div className={css.localRow} key={local.key}>
                            <span className={css.localName} title={local.name}>{local.name}</span>
                            <span className={css.localBadge}>{t('localBadge')}</span>
                            <StatusBadge row={local} t={t} />
                            <span className={css.localActions}>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy === `local:${local.key}`}
                                onClick={() => {
                                  void mutate(
                                    `local:${local.key}`,
                                    () => setServerEnabled(workspace.path, local.name, local.enabled === false),
                                    local.enabled === false ? t('enabled') : t('disabled'),
                                  )
                                }}
                              >
                                {local.enabled === false ? t('enable') : t('disable')}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy === `local:${local.key}`}
                                onClick={() => {
                                  void mutate(
                                    `local:${local.key}`,
                                    () => importLocalServer(workspace.path, local.name),
                                    t('movedToGlobal'),
                                  )
                                }}
                              >
                                {t('moveToGlobal')}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className={css.danger}
                                disabled={busy === `local:${local.key}`}
                                onClick={() => {
                                  void mutate(
                                    `local:${local.key}`,
                                    () => removeServer(workspace.path, local.name),
                                    t('removed'),
                                  )
                                }}
                              >
                                {t('remove')}
                              </Button>
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </>
        ) : null}
      </div>

      {adding || editor !== null ? (
        <McpServerEditor
          {...(editor === null ? {} : { initial: editor })}
          submit={saveGlobalServer}
          submitJson={saveGlobalServerJson}
          importJson={importJson}
          t={t}
          onClose={() => { onCloseEditor() }}
          onSaved={(text) => { onCloseEditor(text) }}
        />
      ) : null}
    </section>
  )
}
