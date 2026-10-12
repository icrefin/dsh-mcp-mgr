#!/usr/bin/env node
/**
 * Verify the built browser bundle the way the page loads it.
 *
 * `lib/client.js` is only meaningful behind the module loader: it calls
 * `window.__ModuleLoader__.load({ id, factory })` and the shell hands the
 * factory a `require` limited to the platform seeds. This script reproduces
 * exactly that — stub the loader, evaluate the bundle, run the factory — and
 * then drives `apply()` against a recording slot registry.
 *
 * It is the check that catches what a typecheck cannot: a bundle whose row id
 * no longer matches the package name (the loader rejects it with "loaded
 * without registering <id>"), a registration that throws inside `apply` (which
 * would blank the GUI), a `sidebar.panellist` row whose id does not match the
 * `main` key it opens (the layout throws instead of switching), or a bundle
 * that still registers into a surface the panel was moved off.
 *
 * Usage: node tools/verify-client.mjs
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bundlePath = join(root, 'lib', 'client.js')
const clientBundle = readFileSync(bundlePath, 'utf8')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }

/* ---- 1. the bundle registers under the package name ------------------- */

let captured
globalThis.window = { __ModuleLoader__: { load: (mod) => { captured = mod } } }
await import(pathToFileURL(bundlePath).href)
check(captured !== undefined, 'lib/client.js did not call window.__ModuleLoader__.load')
check(captured?.id === manifest.name, `the loader row id must be the package name (got ${String(captured?.id)})`)
check(typeof captured?.factory === 'function', 'the loader entry must carry a factory')

const require = createRequire(join(root, 'package.json'))
/**
 * Platform seeds are provided by the shell's module table at runtime, never
 * installed: the bundle may only `require` them. A stub answers every export
 * with an inert component so the factory can be evaluated in Node without
 * pulling a package (and its own peer graph) in.
 */
const platformSeed = new Proxy({}, { get: () => () => null })
const shim = (id) => (id.startsWith('@deepseek-ai/') ? platformSeed : require(id))
const exports = captured.factory(shim)
check(typeof exports.apply === 'function', 'the factory must export apply()')
check(Array.isArray(exports.inject), 'the factory must export an inject list')
check(typeof exports.PANEL_ID === 'string', 'the factory must export the panel id')

/* ---- 2. apply() registers the sidebar seat and the panel it opens ----- */

const registrations = []
const ctx = {
  effect: (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
  get: () => undefined,
  effect_placeholder: undefined,
  workspaces: { list: { getSnapshot: () => ({ items: [] }) } },
  locale: {
    register: () => () => {},
    bind: () => (key) => key,
  },
  remote: { $mount: async () => () => {} },
  slots: {
    inject: (key, callback) => { callback(); return () => {} },
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
}

try {
  await exports.apply(ctx)
} catch (error) {
  failures.push(`apply() threw, which blanks the GUI: ${String(error)}`)
}

const bySlot = (name) => registrations.filter((entry) => entry.options.name === name)
const panelId = exports.PANEL_ID

check(bySlot('sidebar.panellist').length === 1, `expected exactly one sidebar.panellist row, got ${bySlot('sidebar.panellist').length}`)
check(bySlot('main').length === 1, `expected exactly one main panel, got ${bySlot('main').length}`)
check(bySlot('settings.section').length === 0, 'the plugin must not register into Settings any more')

const row = bySlot('sidebar.panellist')[0]?.options
const panel = bySlot('main')[0]?.options
check(row?.id === panelId, `the sidebar row id must equal PANEL_ID (got ${String(row?.id)})`)
check(panel?.key === panelId, `the main key must equal PANEL_ID (got ${String(panel?.key)})`)
check(row?.id === panel?.key, 'the sidebar row and the main panel must share one id, or selectPanel throws')
check(row?.order === 1, `the sidebar row sits directly under Plugins, so its order must be 1 (got ${String(row?.order)})`)
check(row?.label === undefined || typeof row.label === 'function', 'the sidebar label must be a function')
check(typeof panel?.inject === 'function', 'the main panel must inject its face through a factory')

/* ---- 3. the bundle's externals are exactly the platform seeds ---------- */

const externals = [...new Set([...clientBundle.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]))].sort()
// Only what the shell's frozen module table can answer. In particular the
// host package's `/remote` descriptor table must be INLINED: a
// `require("dsh-mcp-mgr/remote")` would ask the table for a row that does not
// exist, and the panel would fail at first mount.
const allowed = [
  '@deepseek-ai/dsh-client-ui-primitives',
  'react',
  'react/jsx-runtime',
].sort()
check(
  externals.join('|') === allowed.join('|'),
  `lib/client.js must require only the platform seeds; it requires ${externals.join(', ')}`,
)

/* ---- 4. the page header clears the window chrome ---------------------- */

check(
  /\[data-platform='darwin'\]\s*\.\w+_pageHead\s*\{[^}]*dsh-frame-top-clearance/.test(clientBundle),
  'the darwin frame clearance must reach .pageHead, or the header sits against the app top boundary',
)

/* ---- 5. the version chip matches the style contract ------------------- */

// STYLES.md fixes the chip beside a page title: the version, then the author
// credit, as one text run in the chip's own 12px/500 label-caption type.
check(
  /_pluginVersion\s*\{[^}]*font-size:\s*12px/.test(clientBundle),
  'the version chip must keep its 12px type',
)
check(clientBundle.includes('Author: icrefin [icrefinai@gmail.com]'), 'the version chip must carry the author credit')

/* ---- report ------------------------------------------------------------ */

if (failures.length > 0) {
  console.error(`verify-client: ${failures.length} failure(s)\n`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('verify-client: PASS')
