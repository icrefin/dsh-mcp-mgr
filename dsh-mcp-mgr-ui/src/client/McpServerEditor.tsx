/**
 * Global-server editor: one server, described either through structured form
 * fields or as a raw JSON entry (the JSON tab also accepts a name→entry map /
 * `mcpServers` document to import several servers at once).
 */

import { useState, type ReactNode } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpApplyResult, McpGlobalServerDraft, McpJsonImportResult } from 'dsh-mcp-mgr/types'
import type { McpLocaleKey } from './locales.ts'
import css from './McpServerEditor.module.css'

/** Mirrors the host-side serverName budget. */
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

interface KvRow {
  key: string
  value: string
}

export interface McpServerEditorProps {
  /** Existing entry when editing; absent when adding. */
  initial?: { readonly name: string; readonly entryJson: string } | undefined
  /** Structured create/replace through the Remote. */
  submit: (draft: McpGlobalServerDraft) => Promise<McpApplyResult>
  /** Raw-entry create/replace through the Remote. */
  submitJson: (name: string, text: string) => Promise<McpApplyResult>
  /** Bulk import of a name map / mcpServers document. */
  importJson: (text: string) => Promise<McpJsonImportResult>
  t: (key: McpLocaleKey) => string
  onClose: () => void
  /** Called with the success notice after a write. */
  onSaved: (notice: string) => void
}

/** Split a shell-ish argument line, honouring single/double quotes. */
export function splitArgs(text: string): string[] {
  const out: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null = pattern.exec(text)
  while (match !== null) {
    const value = match[1] ?? match[2] ?? match[3]
    if (value !== undefined && value.length > 0) out.push(value)
    match = pattern.exec(text)
  }
  return out
}

/** Render arguments back into an editable line, quoting embedded spaces. */
export function joinArgs(args: readonly string[]): string {
  return args.map(argument => (/\s/.test(argument) ? `"${argument}"` : argument)).join(' ')
}

/** Drop blank-key rows; a key with an empty value stays (value ''). */
function kvRecord(rows: readonly KvRow[]): Record<string, string> {
  const record: Record<string, string> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (key === '') continue
    record[key] = row.value
  }
  return record
}

function kvRowsFrom(value: unknown): KvRow[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => typeof item === 'string')
    .map(([key, item]) => ({ key, value: item as string }))
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Parsed shape the form fields are prefilled from. */
interface EntryFields {
  name: string
  transport: 'stdio' | 'streamable-http'
  enabled: boolean
  command: string
  args: string
  cwd: string
  url: string
  env: KvRow[]
  headers: KvRow[]
}

/** Project a stored entry onto the form fields (invalid JSON falls back to blank). */
export function fieldsOf(name: string, entryJson: string): EntryFields {
  let entry: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(entryJson) as unknown
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      entry = parsed as Record<string, unknown>
    }
  } catch {
    // A malformed stored entry still edits as a blank form.
  }
  const transport = entry.type === 'stdio' || (entry.url === undefined && entry.command !== undefined)
    ? 'stdio'
    : 'streamable-http'
  const args = Array.isArray(entry.args) ? entry.args.filter((item): item is string => typeof item === 'string') : []
  return {
    name,
    transport,
    enabled: entry.enabled !== false,
    command: asString(entry.command) ?? '',
    args: joinArgs(args),
    cwd: asString(entry.cwd) ?? '',
    url: asString(entry.url) ?? '',
    env: kvRowsFrom(entry.env),
    headers: kvRowsFrom(entry.headers),
  }
}

/** Whether a parsed snippet describes several servers rather than one entry. */
export function isServerMap(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.mcpServers !== undefined) return typeof record.mcpServers === 'object' && record.mcpServers !== null
  const values = Object.values(record)
  return values.length > 0 && values.every(item => item !== null && typeof item === 'object' && !Array.isArray(item))
}

/** One key-value input row with add/remove. */
function KvRows({ label, rows, onChange, t }: {
  label: string
  rows: KvRow[]
  onChange: (rows: KvRow[]) => void
  t: (key: McpLocaleKey) => string
}): ReactNode {
  const update = (index: number, patch: Partial<KvRow>): void => {
    onChange(rows.map((row, i) => i === index ? { ...row, ...patch } : row))
  }
  return (
    <div className={css.field}>
      <span>{label}</span>
      {rows.length === 0 ? <p className={css.kvEmpty}>{t('kvEmpty')}</p> : null}
      {rows.map((row, index) => (
        <div className={css.kvRow} key={index}>
          {/* `as string`: the CSS-module index signature is `string | undefined`
              under noUncheckedIndexedAccess, but Input declares `className?: string`. */}
          <Input
            className={css.kvInput as string}
            value={row.key}
            placeholder={t('kvKey')}
            onChange={(event) => { update(index, { key: event.target.value }) }}
          />
          <Input
            className={css.kvInput as string}
            value={row.value}
            placeholder={t('kvValue')}
            onChange={(event) => { update(index, { value: event.target.value }) }}
          />
          <Button variant="ghost" size="sm" onClick={() => { onChange(rows.filter((_, i) => i !== index)) }}>
            {t('removeRow')}
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => { onChange([...rows, { key: '', value: '' }]) }}>
        {t('addRow')}
      </Button>
    </div>
  )
}

/** Modal editor for one global registry entry. */
export function McpServerEditor({
  initial, submit, submitJson, importJson, t, onClose, onSaved,
}: McpServerEditorProps): ReactNode {
  const fields = fieldsOf(initial?.name ?? '', initial?.entryJson ?? '')
  const [mode, setMode] = useState<'form' | 'json'>('form')
  const [name, setName] = useState(fields.name)
  const [transport, setTransport] = useState<'stdio' | 'streamable-http'>(fields.transport)
  const [enabled, setEnabled] = useState(fields.enabled)
  const [command, setCommand] = useState(fields.command)
  const [args, setArgs] = useState(fields.args)
  const [cwd, setCwd] = useState(fields.cwd)
  const [url, setUrl] = useState(fields.url)
  const [envRows, setEnvRows] = useState<KvRow[]>(fields.env)
  const [headerRows, setHeaderRows] = useState<KvRow[]>(fields.headers)
  const [jsonText, setJsonText] = useState(initial?.entryJson ?? '')
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'name' | 'command' | 'url', string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const busy = submitting

  const saveForm = async (): Promise<void> => {
    const trimmedName = name.trim()
    const next: typeof fieldErrors = {}
    if (!NAME_PATTERN.test(trimmedName)) next.name = t('namePatternError')
    if (transport === 'stdio' && command.trim() === '') next.command = t('commandRequired')
    if (transport === 'streamable-http' && url.trim() === '') next.url = t('urlRequired')
    setFieldErrors(next)
    if (Object.keys(next).length > 0) return
    const env = kvRecord(envRows)
    const headers = kvRecord(headerRows)
    const draft: McpGlobalServerDraft = transport === 'stdio'
      ? {
          name: trimmedName,
          transport,
          enabled,
          command: command.trim(),
          ...(args.trim() !== '' ? { args: splitArgs(args) } : {}),
          ...(cwd.trim() !== '' ? { cwd: cwd.trim() } : {}),
          ...(Object.keys(env).length > 0 ? { env } : {}),
        }
      : {
          name: trimmedName,
          transport,
          enabled,
          url: url.trim(),
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        }
    setSubmitting(true)
    setFormError(null)
    try {
      const result = await submit(draft)
      if (!result.ok) {
        setFormError(result.error)
        setSubmitting(false)
        return
      }
      onSaved(t('saved'))
    } catch (error) {
      setFormError(String(error instanceof Error ? error.message : error))
      setSubmitting(false)
    }
  }

  const saveJson = async (): Promise<void> => {
    const text = jsonText.trim()
    setFormError(null)
    let parsed: unknown
    try {
      parsed = JSON.parse(text) as unknown
    } catch (error) {
      setFormError(`JSON: ${String(error instanceof Error ? error.message : error)}`)
      return
    }
    setSubmitting(true)
    try {
      if (isServerMap(parsed)) {
        const result = await importJson(text)
        if (!result.ok && result.errors.length === 0) {
          setFormError(t('applyFailed'))
          setSubmitting(false)
          return
        }
        if (result.errors.length > 0) {
          setFormError(result.errors.map(item => `${item.name}: ${item.message}`).join('; '))
          setSubmitting(false)
          return
        }
        onSaved(`${t('imported')}: ${[...result.added, ...result.updated].join(', ')}`)
        return
      }
      const trimmedName = name.trim()
      if (!NAME_PATTERN.test(trimmedName)) {
        setFieldErrors({ name: t('namePatternError') })
        setSubmitting(false)
        return
      }
      const result = await submitJson(trimmedName, text)
      if (!result.ok) {
        setFormError(result.error)
        setSubmitting(false)
        return
      }
      onSaved(t('saved'))
    } catch (error) {
      setFormError(String(error instanceof Error ? error.message : error))
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={initial === undefined ? t('addTitle') : t('editTitle')}
      closeLabel={t('cancel')}
      className={css.dialog as string}
      contentClassName={css.content as string}
      footer={
        <div className={css.formActions}>
          <Button variant="ghost" disabled={busy} onClick={onClose}>{t('cancel')}</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => { void (mode === 'form' ? saveForm() : saveJson()) }}
          >
            {t('save')}
          </Button>
        </div>
      }
    >
      <div className={css.form}>
        <div className={css.tabs} role="tablist">
          <Button
            variant={mode === 'form' ? 'primary' : 'ghost'}
            size="sm"
            role="tab"
            aria-selected={mode === 'form'}
            onClick={() => { setMode('form') }}
          >
            {t('modeForm')}
          </Button>
          <Button
            variant={mode === 'json' ? 'primary' : 'ghost'}
            size="sm"
            role="tab"
            aria-selected={mode === 'json'}
            onClick={() => { setMode('json') }}
          >
            {t('modeJson')}
          </Button>
        </div>
        <label className={css.field}>
          <span>{t('nameLabel')}</span>
          <Input value={name} placeholder={t('namePlaceholder')} onChange={(event) => { setName(event.target.value) }} />
          {fieldErrors.name !== undefined ? <em className={css.fieldError}>{fieldErrors.name}</em> : null}
        </label>
        {mode === 'form' ? (
          <>
            <label className={css.field}>
              <span>{t('transportLabel')}</span>
              <select value={transport} onChange={(event) => { setTransport(event.target.value as 'stdio' | 'streamable-http') }}>
                <option value="stdio">stdio</option>
                <option value="streamable-http">streamable-http</option>
              </select>
            </label>
            {transport === 'stdio' ? (
              <>
                <label className={css.field}>
                  <span>{t('commandLabel')}</span>
                  <Input value={command} onChange={(event) => { setCommand(event.target.value) }} />
                  {fieldErrors.command !== undefined ? <em className={css.fieldError}>{fieldErrors.command}</em> : null}
                </label>
                <label className={css.field}>
                  <span>{t('argsLabel')}</span>
                  <Input
                    value={args}
                    placeholder={t('argsPlaceholder')}
                    onChange={(event) => { setArgs(event.target.value) }}
                  />
                </label>
                <label className={css.field}>
                  <span>{t('cwdLabel')}</span>
                  <Input
                    value={cwd}
                    placeholder={t('cwdPlaceholder')}
                    onChange={(event) => { setCwd(event.target.value) }}
                  />
                </label>
                <KvRows label={t('envLabel')} rows={envRows} onChange={setEnvRows} t={t} />
              </>
            ) : (
              <>
                <label className={css.field}>
                  <span>{t('urlLabel')}</span>
                  <Input value={url} onChange={(event) => { setUrl(event.target.value) }} />
                  {fieldErrors.url !== undefined ? <em className={css.fieldError}>{fieldErrors.url}</em> : null}
                </label>
                <KvRows label={t('headersLabel')} rows={headerRows} onChange={setHeaderRows} t={t} />
              </>
            )}
            <label className={css.checkRow}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => { setEnabled(event.target.checked) }}
              />
              <span>{t('enabledLabel')}</span>
            </label>
          </>
        ) : (
          <label className={css.field}>
            <span>{t('modeJson')}</span>
            <textarea
              className={css.jsonInput}
              value={jsonText}
              spellCheck={false}
              placeholder={'{\n  "type": "stdio",\n  "command": "npx",\n  "args": ["-y", "@modelcontextprotocol/server-filesystem"]\n}'}
              onChange={(event) => { setJsonText(event.target.value) }}
            />
            <em className={css.hint}>{t('jsonHint')}</em>
          </label>
        )}
        {formError !== null ? <p className={css.formError} role="alert">{formError}</p> : null}
      </div>
    </Modal>
  )
}
