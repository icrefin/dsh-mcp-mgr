/**
 * Render the built client bundle outside the GUI and screenshot it.
 *
 * The slot wiring is verified against the live app by `tools/verify-client.mjs`;
 * this harness answers the other half — that the panel actually paints, with its
 * real styling, in the two states the README shows: the **Global servers**
 * registry table (enabled, disabled and read-only config-tree rows) and the
 * **Workspaces** selection (two workspaces, checkboxes, one inline local
 * server, one dangling reference).
 *
 * Technique, mirroring `.publish/dsh-provider-model-picker/tools/preview.mjs`
 * and `dsh-skill-mgr/tools/preview.mjs`:
 *
 * 1. the harness writes one self-contained HTML file per state into a temp
 *    directory. React 18's UMD development builds are inlined as `<script>`
 *    blocks (the page runs from `file://`, so there is no network);
 * 2. `window.__ModuleLoader__` is stubbed to capture the definition that
 *    `lib/client.js` registers (`load({ id, factory })`), and a `require` shim
 *    answers `react`, `react/jsx-runtime` and
 *    `@deepseek-ai/dsh-client-ui-primitives` on top of the inlined React;
 * 3. `await window.__definition.factory(require).apply(ctx)` runs with a
 *    minimal fake client context: `remote.$mount` resolves a disposer,
 *    `effect` runs its callback, `locale.register` hands back the `en`
 *    dictionary (the panel's `t` is built from it), `slots.inject`/`register`
 *    record the two registrations, `get('remote.mcpMgr')` answers the eleven
 *    async methods plus `listWorkspaces`, and
 *    `workspaces.list.getSnapshot()` answers the invented workspace list, and
 *    `version()` answers the installed version read from the host package's
 *    manifest (the way the host's own `readLocalVersion()` reads it). Every
 *    mutating method resolves `{ ok: true }`, so no control in the shot is a
 *    dead end;
 * 4. the recorded `main` seat is mounted as
 *    `React.createElement(seat.component, { ...seat.options.inject(), t })` —
 *    exactly the props the renderer builds — over an invented, complete
 *    `McpManagerSnapshot`;
 * 5. the workspaces shot is not faked: the harness dispatches a real `click` on
 *    the **Workspaces** tab and then on each workspace header, so the shot
 *    shows the panel's own navigation and expansion. Just before the state is
 *    declared ready the page drops CSS transitions, so an animating tab
 *    indicator cannot be caught mid-flight and re-runs stay byte-identical.
 *
 * The bundle embeds its compiled CSS as `const css = "…"` / `const css$1 = "…"`
 * string literals under `//#region \0dsh-css:…` sections, and installs them
 * itself when it evaluates. The harness extracts every such literal with a
 * regex, `JSON.parse`s it, injects the concatenated text into a `<style>`
 * block, and defines every `var(--dsw-…)` / `var(--dsh-…)` token that CSS
 * actually reads (from {@link TOKENS}, with a neutral fallback and a warning
 * for one the table has not learned yet), so the page looks like the real
 * light-theme dsh UI rather than unstyled HTML.
 *
 * `@deepseek-ai/dsh-client-ui-primitives` cannot be imported into a page (it is
 * ESM with CSS-module imports and pulls shiki/markdown), so the six exports the
 * bundle reads — `Button`, `SegmentedTabs`, `Toast`, `Input`, `Modal` and
 * `IconApiOutlineRegular` — are stood in for. The stand-ins mirror the
 * primitives' markup and class semantics, and the harness injects the
 * primitives' own shipped stylesheets (`lib/*.module.css` from the installed
 * package) so the tab bar, the buttons and the chips are the real ones; only
 * the six components' bodies are the harness's, and none of them is visible in
 * a way the panel's own CSS does not style.
 *
 * Privacy: the harness never reads a DSH profile, never touches the network and
 * never opens the user's browser profile (Chrome gets a scratch
 * `--user-data-dir` under the output directory). The page it writes carries
 * only the bundle, the React builds, the primitives' stylesheets and invented
 * generic data. Before shooting, the harness also strips the checkout path the
 * bundle's `\0dsh-css:` region comments carry and then asserts that neither the
 * page nor the painted DOM holds a home path, this machine's user or host name,
 * or an e-mail address. The version chip beside the title is part of the shot,
 * and the component's author credit carries an address; the harness therefore
 * redacts address shapes out of the panel's own text nodes before asserting
 * (the chip reads `v<version> Author: icrefin`) and refuses to shoot a page in
 * which any address-shaped string survived.
 *
 * Usage (needs Google Chrome on the host):
 *
 *     node tools/preview.mjs [--out <dir>] [--png <file>] [--png-workspaces <file>] [--open]
 *
 * `--out` is where the harness HTML is written (a temp directory by default);
 * `--png` / `--png-workspaces` are the two screenshots to produce, resolved
 * against the current directory and defaulting to
 * `../docs/images/mcp-servers-panel.png` and
 * `../docs/images/mcp-servers-workspaces.png`. The harness fails loudly
 * (nonzero exit) rather than writing a blank, unstyled or leaked screenshot.
 *
 * @module dsh-mcp-mgr-ui/tools/preview
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/** The `dsh-mcp-mgr-ui` package: the built bundle and its dependencies. */
const uiRoot = resolve(here, '..')
/** The plugin folder that owns the docs: `dsh-mcp-mgr`. */
const pluginRoot = resolve(uiRoot, '..')
const bundle = join(uiRoot, 'lib', 'client.js')
/** Where the installed primitives package keeps its compiled stylesheets. */
const primitivesLib = join(uiRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-primitives', 'lib')

/** Chrome binaries to try, in order. */
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

/**
 * The primitive stylesheets the stand-ins need, in the order the real
 * primitives package imports them — the order matters, because `.tab` in
 * SegmentedTabs.module.css has to win over `.pill` in Pill.module.css.
 */
const PRIMITIVE_SHEETS = ['Button', 'Pill', 'SegmentedTabs', 'Input', 'Toast', 'Modal']

/* ------------------------------------------------------------------ data */

/**
 * Light-theme values for every design token the panel and primitive CSS read.
 * The token CSS itself is the host theme's, not the bundle's, so the harness
 * stands in for `dsh-client-ui-theme` with the values the real light GUI
 * resolves to (same table as `dsh-skill-mgr/tools/preview.mjs`).
 */
const TOKENS = {
  '--dsh-frame-chrome-top': '0px',
  '--dsh-frame-overlay-top': '24px',
  '--dsh-frame-top-clearance': '28px',
  '--dsh-toast-hold': '3000ms',
  '--ds-ease-in-out': 'cubic-bezier(.4,0,.2,1)',
  '--ds-transition-duration': '160ms',
  '--dsw-alias-bg-base': '#ffffff',
  '--dsw-alias-bg-layer-1': '#ffffff',
  '--dsw-alias-bg-layer-2': '#fafafb',
  '--dsw-alias-bg-layer-3': '#ffffff',
  '--dsw-alias-bg-mask-1': 'rgba(16,18,22,.32)',
  '--dsw-alias-bg-module-platform': '#f1f2f4',
  '--dsw-alias-border-l1': '#ececef',
  '--dsw-alias-border-l2': '#e6e7ea',
  '--dsw-alias-border-l3': '#d8dadd',
  '--dsw-alias-border-l4': '#cfd1d5',
  '--dsw-alias-brand-primary': '#4d6bfe',
  '--dsw-alias-button-ghost-active-border': 'rgba(26,27,30,.06)',
  '--dsw-alias-button-ghost-active-fill': 'rgba(26,27,30,.08)',
  '--dsw-alias-button-primary-fill': '#4d6bfe',
  '--dsw-alias-button-primary-hover': '#3d5bf0',
  '--dsw-alias-button-tool-bar-fill': '#f1f2f4',
  '--dsw-alias-button-tool-bar-hover': '#e8e9ec',
  '--dsw-alias-interactive-bg-active': 'rgba(26,27,30,.10)',
  '--dsw-alias-interactive-bg-hover': 'rgba(26,27,30,.06)',
  '--dsw-alias-label-caption': '#a2a5ab',
  '--dsw-alias-label-dimmed': '#c3c5ca',
  '--dsw-alias-label-primary': '#1a1b1e',
  '--dsw-alias-label-primary-foreground': '#ffffff',
  '--dsw-alias-label-secondary': '#52555c',
  '--dsw-alias-label-tertiary': '#85888f',
  '--dsw-alias-state-business-primary': '#3b6df5',
  '--dsw-alias-state-error-primary': '#d93b36',
  '--dsw-alias-state-success-primary': '#1f9d55',
  '--dsw-alias-state-warn-label': '#a9690a',
  '--dsw-alias-state-warn-primary': '#c47f0a',
  '--dsw-alias-toast-bg': '#20232b',
  '--dsw-alias-toast-label': '#f5f6f7',
  '--dsw-elevation-prominent': '0 10px 30px rgba(16,18,22,.16), 0 2px 8px rgba(16,18,22,.08)',
  '--dsw-mask-blur': 'none',
  '--dsw-radius-lg': '12px',
  '--dsw-radius-md': '8px',
  '--dsw-radius-sm': '6px',
  '--dsw-radius-panel': '16px',
  '--dsw-shadow-lv3': '0 10px 30px rgba(16,18,22,.16), 0 2px 8px rgba(16,18,22,.08)',
  '--dsw-static-deepseek-400': '#93b8ff',
}

/** Neutral fallback for a token the table above has not learned yet. */
const TOKEN_FALLBACK = 'rgba(128,128,128,.12)'

/**
 * The installed version the panel's chip renders, read the way the host's own
 * `readLocalVersion()` reads it: the host package's manifest first, then the
 * browser half's. An empty answer would leave the chip out of the shot.
 * @returns the version, or `''` when no manifest could be read.
 */
function installedVersion() {
  for (const manifest of [join(pluginRoot, 'dsh-mcp-mgr', 'package.json'), join(uiRoot, 'package.json')]) {
    try {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
      if (typeof parsed.version === 'string' && parsed.version !== '') return parsed.version
    } catch {
      // try the next layout
    }
  }
  return ''
}

/** The installed plugin version, for the fake `version()` and the guard. */
const VERSION = installedVersion()

/** The version chip's rendered text: the author credit, address redacted. */
const CHIP = VERSION === '' ? '' : `v${VERSION} Author: icrefin`

/** The invented workspaces: what `ctx.workspaces.list` answers. */
const WORKSPACES = [
  { path: '~/projects/alpha', title: 'alpha' },
  { path: '~/projects/beta', title: 'beta' },
]

/** Pretty-printed registry entry, as the editor seeds it (never painted). */
const entryJson = (value) => JSON.stringify(value, null, 2)

/**
 * The invented manager projection the fake namespace serves. Nothing here is
 * read from disk or from a DSH profile: the servers are generic names with
 * example.com endpoints, and every path is the `~`-spelled placeholder the UI
 * itself prints (`~/.dsh/dshmm/mcp-servers.json`, `~/projects/alpha`).
 */
const SNAPSHOT = {
  registryPath: '~/.dsh/dshmm/mcp-servers.json',
  global: [
    {
      name: 'shared-http-server',
      transport: 'streamable-http',
      enabled: true,
      detail: 'https://mcp.example.com/shared',
      entryJson: entryJson({
        transport: 'streamable-http',
        url: 'https://mcp.example.com/shared',
        headers: { Authorization: 'Bearer <token>' },
      }),
      usedBy: ['~/projects/alpha', '~/projects/beta'],
      status: 'active',
      connected: true,
    },
    {
      name: 'local-stdio-server',
      transport: 'stdio',
      enabled: true,
      detail: 'npx -y @example/local-mcp --root .',
      entryJson: entryJson({
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@example/local-mcp', '--root', '.'],
      }),
      usedBy: ['~/projects/alpha'],
      status: 'active',
    },
    {
      name: 'docs-search',
      transport: 'stdio',
      enabled: false,
      detail: 'npx -y @example/docs-search --index docs',
      entryJson: entryJson({
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@example/docs-search', '--index', 'docs'],
        enabled: false,
      }),
      usedBy: [],
      status: 'disabled',
    },
  ],
  workspaces: [
    {
      path: '~/projects/alpha',
      use: ['shared-http-server', 'local-stdio-server'],
      missing: [],
      locals: [
        {
          key: '~/projects/alpha#alpha-tools',
          source: 'workspace',
          name: 'alpha-tools',
          transport: 'stdio',
          enabled: true,
          status: 'active',
          connected: true,
          workspace: '~/projects/alpha',
        },
      ],
      errors: [],
    },
    {
      path: '~/projects/beta',
      use: ['shared-http-server'],
      missing: ['legacy-tools'],
      locals: [],
      errors: [],
    },
  ],
  profile: [
    {
      key: 'profile#filesystem',
      source: 'profile',
      name: 'filesystem',
      transport: 'stdio',
      status: 'configured',
      sourceFile: '~/.dsh/profiles/default/cordis.patch.yml',
    },
    {
      key: 'profile#git-tools',
      source: 'profile',
      name: 'git-tools',
      transport: 'streamable-http',
      status: 'configured',
      sourceFile: '~/.dsh/profiles/default/cordis.patch.yml',
    },
  ],
  watchedWorkspaces: ['~/projects/alpha', '~/projects/beta'],
  strictMode: false,
  activeWorkspace: '',
}

/* ------------------------------------------------------------------- css */

/**
 * Pull every compiled-CSS string literal out of the bundle.
 *
 * The build emits `const css = "…"` (and `const css$1 = "…"` for the second
 * sheet) inside a `//#region \0dsh-css:…` section; the value is a JSON string
 * literal, so `JSON.parse` round-trips the escapes.
 *
 * @param source - the built `lib/client.js` source.
 * @returns the decoded CSS texts, in bundle order.
 */
function extractCss(source) {
  const literal = /const (css[\w$]*) = ("(?:[^"\\]|\\.)*")/g
  const sheets = []
  let match
  while ((match = literal.exec(source)) !== null) {
    try {
      sheets.push({ name: match[1], css: JSON.parse(match[2]) })
    } catch (error) {
      throw new Error(`could not decode the CSS literal ${match[1]}: ${String(error)}`)
    }
  }
  if (sheets.length === 0) throw new Error('the bundle carries no compiled CSS literal — is lib/client.js stale?')
  const all = sheets.map((sheet) => sheet.css).join('\n')
  for (const marker of ['.mmdee5be_page', '.mmdee5be_table', '.mm30762d_dialog']) {
    if (!all.includes(marker)) throw new Error(`the extracted CSS is missing ${marker} — is this the shipped bundle?`)
  }
  return sheets
}

/**
 * Every design token the given CSS reads, with a value from {@link TOKENS}.
 *
 * A token read without a fallback that this table does not define paints an
 * unstyled hole, so it is reported as a warning (the fallback keeps the page
 * readable); a token this table knows is emitted with its light-theme value.
 *
 * @param css - the concatenated extracted CSS.
 * @returns the `:root` declarations to inject.
 */
function tokenBlock(css) {
  const used = new Set()
  const read = /var\((--ds[wh]-[a-z0-9-]+)/g
  let match
  while ((match = read.exec(css)) !== null) used.add(match[1])
  const missing = [...used].filter((name) => TOKENS[name] === undefined).sort()
  if (missing.length > 0) {
    console.warn(
      'preview: the CSS reads tokens this harness does not define — using a neutral fallback:\n  ' + missing.join('\n  '),
    )
  }
  return [...used].sort().map((name) => `  ${name}: ${TOKENS[name] ?? TOKEN_FALLBACK};`).join('\n')
}

/* ------------------------------------------------------------------ page */

/**
 * The harness page for one state.
 *
 * @param options - the page inputs.
 * @param options.react - the React UMD development source.
 * @param options.reactDom - the ReactDOM UMD development source.
 * @param options.bundleSource - the built `lib/client.js` source.
 * @param options.css - the CSS extracted from the bundle and the primitives.
 * @param options.tokens - the `:root` token declarations.
 * @param options.view - `'global'` or `'workspaces'`; the workspaces page
 *   drives the tab and the workspace headers itself instead of faking a state.
 * @param options.title - the document title.
 * @returns the self-contained HTML document.
 */
function page(options) {
  const { react, reactDom, bundleSource, css, tokens, view, title } = options
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>
:root{
  color-scheme:light;
${tokens}
}
html,body{margin:0;height:100%;background:#ffffff;color:#1a1b1e;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,"PingFang SC",sans-serif;
  -webkit-font-smoothing:antialiased;font-size:13px}
/* A plausible app frame: the sidebar the MCP servers row lives in (under
   Skills) beside the light main column. The panel itself centres its content in
   a 960px column at full height — that is the geometry its CSS expects. */
.app{display:flex;height:100%;background:#ffffff}
.rail{box-sizing:border-box;flex:none;width:224px;height:100%;padding:52px 12px 0;
  background:#f4f4f6;border-right:1px solid #e6e7ea}
.railTitle{font-size:12px;font-weight:600;letter-spacing:.02em;color:#85888f;padding:0 10px 14px}
.railItem{display:flex;align-items:center;gap:8px;height:32px;padding:0 10px;border-radius:8px;
  font-size:13px;color:#52555c;margin-bottom:2px}
.railItem.active{background:#e7e8ec;color:#1a1b1e;font-weight:500}
.railSep{height:1px;background:#e6e7ea;margin:10px 4px}
.main{flex:1;min-width:0;height:100%;overflow:hidden;background:#ffffff}
#panel{height:100%}
/* The shot is the panel's resting state. A transition caught mid-flight (the
   tab indicator and the workspace chevron both animate) would make the
   committed PNG depend on when the browser happened to paint, so the page
   drops them just before the state is declared ready. */
.harness-settle *,.harness-settle *::before,.harness-settle *::after{
  transition:none !important;animation:none !important}
</style>
<style id="harness-plugin-css">${css}</style>
</head>
<body>
<div class="app">
  <aside class="rail">
    <div class="railTitle">DeepSeek Harness</div>
    <div class="railItem">Chat</div>
    <div class="railItem">Plugins</div>
    <div class="railItem">Skills</div>
    <div class="railSep"></div>
    <div class="railItem active">MCP servers</div>
    <div class="railItem">Settings</div>
  </aside>
  <main class="main" data-platform="darwin"><div id="panel"></div></main>
</div>
<script>${react}</script>
<script>${reactDom}</script>
<script>
window.__ModuleLoader__ = { load: (definition) => { window.__definition = definition } }

/* Join truthy class names, the way clsx does for the real primitives. */
const cx = (...names) => names.filter((name) => typeof name === 'string' && name !== '').join(' ')
/* The compiled bundle calls the automatic runtime with an explicit key third. */
const jsx = (type, props, key) => {
  if (key === undefined) return React.createElement(type, props || {})
  const merged = Object.assign({}, props || {}, { key })
  return React.createElement(type, merged)
}
const jsxRuntime = { Fragment: React.Fragment, jsx, jsxs: jsx }

/*#region the primitives, stood in for
 * @deepseek-ai/dsh-client-ui-primitives is ESM with CSS-module imports and
 * pulls shiki/markdown, so it cannot be loaded into this page. These six
 * components mirror the package's markup, class semantics and attributes, and
 * the page's stylesheet is the package's own shipped CSS, so everything the
 * panel paints still looks like the real thing. */
function Button(props) {
  const { variant = 'ghost', size = 'md', icon, className, children, ...rest } = props
  return React.createElement(
    'button',
    Object.assign({ type: 'button', className: cx('button', variant, size, className) }, rest),
    icon != null ? React.createElement('span', { className: 'icon' }, icon) : null,
    children,
  )
}

function Pill(props) {
  const { active = false, className, children, onClick, ...rest } = props
  if (onClick === undefined) {
    return React.createElement('span', Object.assign({ className: cx('pill', active && 'active', className) }, rest), children)
  }
  return React.createElement(
    'button',
    Object.assign({ type: 'button', className: cx('pill', 'interactive', active && 'active', className), onClick }, rest),
    children,
  )
}

function SegmentedTabs(props) {
  const { items, value, onChange, label, className } = props
  const selectedIndex = items.findIndex((item) => item.value === value)
  const onKeyDown = (event, index) => {
    let next
    if (event.key === 'ArrowLeft') next = (index + items.length - 1) % items.length
    else if (event.key === 'ArrowRight') next = (index + 1) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return
    event.preventDefault()
    const tablist = event.currentTarget.parentElement
    const nextItem = items[next]
    if (tablist === null || nextItem === undefined) return
    tablist.querySelectorAll('[role="tab"]').item(next).focus()
    onChange(nextItem.value)
  }
  const children = [
    React.createElement('span', {
      key: 'indicator',
      className: 'indicator',
      'aria-hidden': 'true',
      style: {
        width: 'calc((100% - 8px) / ' + String(items.length) + ')',
        transform: 'translateX(' + String(selectedIndex * 100) + '%)',
      },
    }),
  ]
  items.forEach((item, index) => {
    children.push(React.createElement(Pill, {
      key: item.value,
      id: item.id,
      role: 'tab',
      className: 'tab',
      'aria-selected': value === item.value,
      'aria-controls': item.panelId,
      tabIndex: value === item.value ? 0 : -1,
      onClick: () => { onChange(item.value) },
      onKeyDown: (event) => { onKeyDown(event, index) },
    }, item.label))
  })
  return React.createElement('div', {
    role: 'tablist',
    'aria-label': label,
    className: cx('tabs', className),
    style: { gridTemplateColumns: 'repeat(' + String(items.length) + ', minmax(0, 1fr))' },
  }, children)
}

function Input(props) {
  const { icon, className, ...rest } = props
  return React.createElement('span', { className: cx('wrap', className) },
    icon != null ? React.createElement('span', { className: 'icon' }, icon) : null,
    React.createElement('input', Object.assign({ className: 'input' }, rest)))
}

function Toast(props) {
  const { text, icon, tone, actions, holdMs = 3000, onDone } = props
  /* The hold drives both the unmount timer and the stylesheet's fade delay, so
     it travels to the CSS as the custom property the sheet reads. */
  React.useEffect(() => {
    document.documentElement.style.setProperty('--dsh-toast-hold', String(holdMs) + 'ms')
  }, [holdMs])
  React.useEffect(() => {
    const timer = setTimeout(() => { if (typeof onDone === 'function') onDone() }, holdMs + 1000)
    return () => { clearTimeout(timer) }
  }, [holdMs, onDone])
  return ReactDOM.createPortal(
    React.createElement('div', { className: 'toast', role: 'alert' },
      tone === 'success'
        ? React.createElement('span', { className: 'icon success' }, icon)
        : icon != null ? React.createElement('span', { className: 'icon' }, icon) : null,
      React.createElement('span', { className: 'text' }, text),
      ...(actions || []).map((action, index) => React.createElement('button', {
        key: String(index), type: 'button', className: 'action', onClick: action.onClick,
      }, action.label))),
    document.body,
  )
}

function Modal(props) {
  const { title, children, footer, onClose } = props
  return ReactDOM.createPortal(
    React.createElement('div', { className: 'root' },
      React.createElement('div', { className: 'mask', onClick: onClose }),
      React.createElement('div', { className: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        React.createElement('div', { className: 'header' },
          React.createElement('h2', { className: 'title' }, title),
          React.createElement('button', { type: 'button', className: 'close', 'aria-label': 'Close', onClick: onClose }, '\\u00d7')),
        React.createElement('div', { className: 'content' }, children),
        footer != null ? React.createElement('div', { className: 'footer' }, footer) : null)),
    document.body,
  )
}

function IconApiOutlineRegular(props) {
  const size = props.size || 16
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: '1.2', 'aria-hidden': 'true',
  }, React.createElement('rect', { x: '2.2', y: '2.2', width: '11.6', height: '11.6', rx: '3' }),
     React.createElement('path', { d: 'M5.6 6.4h4.8M5.6 9.6h3.2' }))
}

const PRIMITIVES = { Button, Input, Modal, SegmentedTabs, Toast, IconApiOutlineRegular }

window.__harnessRequire = (name) => {
  if (name === 'react') return React
  if (name === 'react/jsx-runtime') return jsxRuntime
  if (name === 'react-dom') return ReactDOM
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return PRIMITIVES
  throw new Error('unexpected require: ' + name)
}
/*#endregion*/
</script>
<script>${bundleSource}</script>
<script>
const SNAPSHOT = ${JSON.stringify(SNAPSHOT)}
const WORKSPACES = ${JSON.stringify(WORKSPACES)}
const VERSION = ${JSON.stringify(VERSION)}
const VIEW = ((location.hash || '#global').replace(/^#/, '')) === 'workspaces' ? 'workspaces' : 'global'

/* ------------------------------------------------------ fake client ctx */
/* The 'en' dictionary the bundle registers is the panel's own copy source, so
   t is built from what apply hands the locale service — never hard-coded. */
const record = { dictionary: {}, registered: [], injected: [] }
const t = (key, params) => {
  let text = record.dictionary[key] !== undefined ? record.dictionary[key] : key
  for (const name of Object.keys(params || {})) text = text.split('{' + name + '}').join(String(params[name]))
  return text
}

/* The eleven Remote methods plus listWorkspaces, over the invented snapshot.
   Every mutation succeeds, so no control in the shot is a dead end. */
const applied = { ok: true, value: { ok: true } }
const namespace = {
  snapshot: async () => ({ ok: true, value: SNAPSHOT }),
  saveGlobalServer: async () => applied,
  saveGlobalServerJson: async () => applied,
  removeGlobalServer: async () => applied,
  setGlobalServerEnabled: async () => applied,
  importJson: async () => ({ ok: true, value: { ok: true, added: [], updated: [], errors: [] } }),
  setWorkspaceSelection: async () => applied,
  importLocalServer: async () => applied,
  setServerEnabled: async () => applied,
  removeServer: async () => applied,
  /* The installed version, read from the host package's manifest at build time
     of this harness — the same answer the host's readLocalVersion() gives. */
  version: async () => ({ ok: true, value: VERSION }),
}

const slots = {
  register: (options, component) => { record.registered.push({ options, component }); return () => {} },
  inject: (key, callback) => { record.injected.push(key); return callback() },
}
const ctx = {
  logger: { warn: () => {}, error: () => {} },
  effect: (callback) => { callback() },
  get: (name) => (name === 'remote.mcpMgr' ? namespace : undefined),
  locale: {
    register: (namespaceName, dictionaries) => { record.dictionary = dictionaries.en; return () => {} },
    bind: () => t,
  },
  slots,
  remote: { $mount: async () => () => {} },
  workspaces: { list: { getSnapshot: () => ({ items: WORKSPACES }) } },
}

/* --------------------------------------------------------------- render */
const wait = (ms) => new Promise((done) => setTimeout(done, ms))

/** Poll a predicate a bounded number of times (virtual-time safe). */
async function waitFor(label, predicate, tries = 80) {
  for (let index = 0; index < tries; index += 1) {
    if (predicate()) return
    await wait(16)
  }
  throw new Error('timed out waiting for ' + label)
}

/** Press a control the way a user does, through React's listener. */
function press(element) {
  if (element === null || element === undefined) throw new Error('nothing to press')
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

/** The rows of the first (registry) table inside one tab panel. */
function rowsIn(panelId) {
  const table = document.querySelector('#' + panelId + ' table')
  return table === null ? [] : [...table.querySelectorAll('tbody tr')]
}

/**
 * The version chip renders the author credit, which ships an e-mail address.
 * The picture keeps the credit and drops the address, so address shapes are
 * erased from the panel's own text nodes: the chip reads
 * "v1.0.0 Author: icrefin".
 * @param root - the mounted panel.
 * @returns how many text nodes had to be cleaned.
 */
function redactEmails(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let redacted = 0
  while (walker.nextNode()) {
    const node = walker.currentNode
    const value = node.nodeValue || ''
    if (/[^\\s@]+@[^\\s@]+\\.[^\\s@]+/.test(value)) {
      node.nodeValue = value.replace(/\\s*\\[[^\\]]*@[^\\]]*\\]/g, '').replace(/[^\\s@]+@[^\\s@]+\\.[^\\s@]+/g, '')
      redacted += 1
    }
  }
  return redacted
}

;(async () => {
  try {
    const plugin = window.__definition.factory(window.__harnessRequire)
    await plugin.apply(ctx)
    const seat = record.registered.find((entry) => entry.options.name === 'main')
    if (seat === undefined) throw new Error("the bundle did not register the 'main' panel seat")
    const container = document.getElementById('panel')
    /* Exactly the props the renderer builds: the inject face, plus t. */
    ReactDOM.createRoot(container).render(
      React.createElement(seat.component, Object.assign({ t }, seat.options.inject())),
    )

    await waitFor('the global server table', () => rowsIn('mcpMgr-panel-global').length >= 3)
    if (rowsIn('mcpMgr-panel-global').length !== 3) throw new Error('expected 3 global rows')

    if (VIEW === 'workspaces') {
      press(document.getElementById('mcpMgr-tab-workspaces'))
      await waitFor('the Workspaces tab', () => document.getElementById('mcpMgr-panel-workspaces').hidden === false)
      const heads = [...document.querySelectorAll('#mcpMgr-panel-workspaces button[aria-expanded]')]
      if (heads.length < 2) throw new Error('expected at least two workspace rows, painted ' + String(heads.length))
      for (const head of heads) {
        press(head)
        await wait(24)
      }
      await waitFor('the workspace selections', () =>
        document.querySelectorAll('#mcpMgr-panel-workspaces input[type="checkbox"]').length >= 6)
      const boxes = document.querySelectorAll('#mcpMgr-panel-workspaces input[type="checkbox"]')
      const checked = [...boxes].filter((box) => box.checked).length
      if (checked !== 3) throw new Error('expected 3 ticked servers across the two workspaces, found ' + String(checked))
    }

    /* The chip is part of the shot, the address is not. */
    const redacted = redactEmails(container)
    document.body.dataset.harnessRedacted = String(redacted)

    /* The shot's own state, asserted before the browser is asked to shoot it. */
    const globalPanel = document.getElementById('mcpMgr-panel-global')
    const workspacePanel = document.getElementById('mcpMgr-panel-workspaces')
    const wantGlobal = VIEW === 'global'
    if (globalPanel.hidden !== !wantGlobal || workspacePanel.hidden !== wantGlobal) {
      throw new Error('the tab panels are not in the ' + VIEW + ' state')
    }
    const text = container.innerText || container.textContent || ''
    const expected = VIEW === 'global'
      ? ['Global servers', 'shared-http-server', 'local-stdio-server', 'docs-search', 'Servers from the config tree (read-only)']
      : ['Workspaces', 'alpha', 'beta', 'alpha-tools', 'legacy-tools']
    const absent = expected.filter((needle) => text.indexOf(needle) === -1)
    if (absent.length > 0) throw new Error('the ' + VIEW + ' view never painted: ' + absent.join(', '))
    const chip = document.querySelector('.mmdee5be_pluginVersion')
    if (chip === null || (chip.textContent || '').indexOf('Author: icrefin') === -1) {
      throw new Error('the version chip did not paint: ' + String(chip === null ? 'no chip' : chip.textContent))
    }
    if (/[^\\s@]+@[^\\s@]+\\.[^\\s@]+/.test(text)) throw new Error('an e-mail address painted in the panel')
    /* A clipped panel is a failed screenshot: the panel scrolls, so content
       taller than the window is simply not in the picture. */
    const sheet = container.querySelector('.mmdee5be_page')
    if (sheet === null) throw new Error('the panel did not paint its page element')
    /* Measured with the panel's own height:100% lifted, so the number is the
       content's natural height rather than the window's. */
    const kept = sheet.style.height
    sheet.style.height = 'auto'
    const contentHeight = sheet.scrollHeight
    sheet.style.height = kept
    document.body.dataset.panelHeight = String(contentHeight)
    if (contentHeight > sheet.clientHeight + 1) {
      throw new Error(
        'the panel needs ' + String(contentHeight) + 'px but the window gives it ' +
          String(sheet.clientHeight) + 'px — the shot would be clipped',
      )
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    /* Settle the two transitions (tab indicator, workspace chevron) so the
       picture is the panel's resting state and re-runs are byte-identical. */
    document.documentElement.classList.add('harness-settle')
    document.body.dataset.painted = VIEW
  } catch (error) {
    /* The harness reads the failure out of the dumped DOM, not a title. */
    const message = String((error && error.stack) || error)
    document.body.dataset.harnessError = message
    const banner = document.createElement('pre')
    banner.id = 'harness-error'
    banner.textContent = 'HARNESS ERROR: ' + message
    document.getElementById('panel').appendChild(banner)
  }
})()
</script>
</body></html>`
}

/* --------------------------------------------------------------- browser */

/**
 * The compiled bundle carries the checkout's absolute path inside its
 * `//#region \0dsh-css:<path>` comments. The comment text says nothing about
 * what the panel paints, and the committed PNGs must not be built from a page
 * that names this machine, so the region comments are rewritten before the
 * bundle is inlined — and the harness refuses any other absolute path.
 *
 * @param source - the built `lib/client.js` source.
 * @returns the same source with machine paths removed.
 */
function scrubPaths(source) {
  const path = /(?:\/Users\/|\/home\/|\/private\/|\/var\/|\/opt\/)[^\s"'`]*/g
  return source.replace(path, (match) => {
    if (!match.endsWith('.module.css.mjs')) {
      console.error('preview: refusing to inline a bundle that names an absolute path (…' + match.slice(-40) + ')')
      process.exit(1)
    }
    return '<stylesheet>'
  })
}

/**
 * Run one headless Chrome invocation.
 *
 * The browser gets its own scratch profile under the output directory: it never
 * opens the user's profile, and a read-only or sandboxed home directory cannot
 * stop the render. The browser's own sandbox is off for the same reason — a
 * shell that refuses its crashpad and GPU writes kills the process before it
 * paints — and the only page it ever loads is the file written above.
 *
 * @param chromePath - the browser binary.
 * @param args - the flags after the shared ones.
 * @returns the browser's stdout.
 */
function chrome(chromePath, args) {
  return execFileSync(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-crash-reporter',
      '--hide-scrollbars',
      `--user-data-dir=${scratchProfile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--virtual-time-budget=8000',
      ...args,
    ],
    { stdio: 'pipe', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
}

/**
 * The painted DOM: the dump with the harness's own `<script>`/`<style>` payload
 * removed, tags kept. The inlined React, bundle and CSS sources are not what
 * the panel painted, and they contain plenty of strings (every class name, and
 * markup snippets of React's own) that would make a whole-dump search lie.
 * @param dom - the `--dump-dom` output.
 * @returns the markup the panel actually produced.
 */
function paintedMarkup(dom) {
  return dom.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
}

/**
 * The visible text of some painted markup.
 * @param markup - the output of {@link paintedMarkup}.
 * @returns the text with whitespace collapsed.
 */
function visibleText(markup) {
  return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Assert the painted DOM is the state the shot promises — and carries no data
 * from this machine. Throws (nonzero exit) instead of writing a bad PNG.
 * @param label - the state name, for the message.
 * @param dom - the `--dump-dom` output (also checked for machine data).
 * @param markup - the painted DOM, with the inlined payload removed.
 */
function assertShot(label, dom, markup) {
  const text = visibleText(markup)
  const fail = (why) => {
    console.error(`preview: ${label}: ${why}`)
    console.error(`preview: ${label}: rendered text was:\n${text.slice(0, 1200)}`)
    console.error(`preview: ${label}: the rendered DOM is in ${join(outDir, label + '.html')}`)
    process.exit(1)
  }
  if (markup.includes('id="harness-error"')) {
    const reported = /<pre id="harness-error">([\s\S]*?)<\/pre>/.exec(dom)
    fail('the page threw while rendering the panel' + (reported === null ? '' : `:\n${reported[1]}`))
  }
  /* The bundle installs its own <style data-plugin-css=…> at evaluation time;
     that tag is not painted markup, so this one check reads the whole dump. */
  if (!dom.includes('data-plugin-css="dsh-mcp-mgr-ui/McpManagerSection.module.css"')) {
    fail("the bundle's own stylesheet never installed")
  }
  if (!markup.includes('id="mcpMgr-panel-' + label + '"') || !markup.includes('data-painted="' + label + '"')) {
    fail(`the ${label} panel is not the painted state`)
  }
  /* Class names are also in the inlined CSS, so every check below looks for the
     HTML marker (`class="…"` / the attribute), not the bare name. */
  if (!markup.includes('class="mmdee5be_page"')) fail('the panel did not paint its own root class')
  if (!markup.includes('class="pill interactive tab')) fail('the tab bar did not render through the primitives')

  const shared = ['Global servers', 'Workspaces', 'shared-http-server', 'local-stdio-server', 'docs-search',
    'Servers from the config tree (read-only)', 'Stored in', 'Command / URL', 'Used by', 'Connected',
    'Registered', 'Disabled', 'Not used by any workspace']
  const missing = shared.filter((needle) => !text.includes(needle))
  if (missing.length > 0) fail(`the panel is missing ${missing.join(', ')}`)

  if (label === 'global') {
    /* The workspaces tab is mounted but collapsed and hidden, so an expanded
       workspace body (or a checkbox) would mean the wrong state was shot. */
    if (markup.includes('class="mmdee5be_workspaceBody"') || markup.includes('type="checkbox"')) {
      fail('the global shot shows the expanded workspaces view')
    }
    if (!markup.includes('class="mmdee5be_usedByChip"')) fail('the used-by chips did not paint')
    if (!markup.includes('data-enabled="false"')) fail('the disabled registry row did not paint')
    if (!markup.includes('data-status="connected"')) fail('the connected status badge did not paint')
  } else {
    const wanted = ['alpha', 'beta', '2/3', '1/3', 'alpha-tools',
      'Selected but no longer in the global list: legacy-tools', 'Defined by this workspace', 'local']
    const absent = wanted.filter((needle) => !text.includes(needle))
    if (absent.length > 0) fail(`the workspaces view is missing ${absent.join(', ')}`)
    if (!markup.includes('type="checkbox"')) fail('the workspace checkboxes did not paint')
    if (!markup.includes('class="mmdee5be_workspaceBody"')) fail('the workspace bodies did not expand')
    if (!markup.includes('class="mmdee5be_localBadge"')) fail('the inline local server did not paint')
  }

  /* The version chip is part of both shots: it names the installed version and
     the author credit, with the credit's address redacted out of the text, and
     any surviving address fails the run. */
  /*
   * Nothing else from this machine: the page names the bundle, the React builds
   * and invented data, and nothing else. The paths and names are checked on the
   * whole dump — including the inlined sources, which the harness scrubbed —
   * while the address is checked on the painted markup, because the plugin's
   * author credit ships one inside the bundle source and only a rendered
   * version chip could ever show it.
   */
  if (CHIP === '') fail('no installed version was found to render in the version chip')
  if (!markup.includes('class="mmdee5be_pluginVersion"')) fail('the version chip did not paint')
  if (!markup.includes(CHIP)) fail(`the version chip does not read "${CHIP}"`)
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(markup)) fail('an e-mail address leaked into the picture')
  const machine = [
    ['a home or application path', /\/Users\/|\/Applications\/|\/private\/|\/var\/folders\//],
    ['this machine\'s user name', process.env.USER ? new RegExp(`\\b${process.env.USER}\\b`) : /(?!)/],
  ]
  for (const [what, pattern] of machine) {
    if (pattern.test(dom)) fail(`${what} leaked into the page`)
  }
  if (hostname().length >= 4 && dom.toLowerCase().includes(hostname().toLowerCase())) {
    fail('this machine\'s host name leaked into the page')
  }
}

/**
 * One PNG's pixel size and byte size, read out of its header and stat.
 * @param png - the file to read.
 * @returns its width, height and byte count.
 */
function pngInfo(png) {
  const bytes = readFileSync(png)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length }
}

/* ------------------------------------------------------------------ main */

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : argv[index + 1]
}

// The browser half only exists after a build, and the bundle is gitignored, so
// a fresh checkout has to build it before this harness can render anything.
if (!existsSync(bundle)) {
  console.log('lib/client.js is missing — running `pnpm build` …')
  execFileSync('pnpm', ['build'], { cwd: uiRoot, stdio: 'inherit' })
}
if (!existsSync(bundle)) {
  console.error('lib/client.js is still missing after `pnpm build`.')
  process.exit(1)
}

if (VERSION === '') {
  console.error(
    'preview: no installed version could be read from ' + join(pluginRoot, 'dsh-mcp-mgr', 'package.json') +
      ' or ' + join(uiRoot, 'package.json') + ' — the version chip would be missing from the shot.',
  )
  process.exit(1)
}

const absentSheets = PRIMITIVE_SHEETS.filter((name) => !existsSync(join(primitivesLib, name + '.module.css')))
if (absentSheets.length > 0) {
  console.error(
    '@deepseek-ai/dsh-client-ui-primitives is not installed (missing ' + absentSheets.join(', ') +
      "). Run `pnpm install` in the workspace first.",
  )
  process.exit(1)
}

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate))
if (chromePath === undefined) {
  console.error('No Chrome-family browser found; looked at:\n  ' + CHROME_CANDIDATES.join('\n  '))
  process.exit(1)
}

const defaultOut = join(tmpdir(), 'dsh-mcp-mgr-preview')
const outDir = resolve(flag('--out', defaultOut))
const docsImages = join(pluginRoot, 'docs', 'images')
const panelPng = resolve(flag('--png', join(docsImages, 'mcp-servers-panel.png')))
const workspacesPng = resolve(flag('--png-workspaces', join(dirname(panelPng), 'mcp-servers-workspaces.png')))
// Only the harness's own scratch directory is cleared: `--out` may name a
// directory the caller keeps other files in.
const scratchProfile = join(outDir, 'chrome-profile')
if (outDir === resolve(defaultOut)) rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
mkdirSync(dirname(panelPng), { recursive: true })
mkdirSync(dirname(workspacesPng), { recursive: true })

const source = scrubPaths(readFileSync(bundle, 'utf8'))
const sheets = extractCss(source)
const primitiveCss = PRIMITIVE_SHEETS.map((name) => readFileSync(join(primitivesLib, name + '.module.css'), 'utf8'))
const allCss = sheets.map((sheet) => sheet.css).join('\n') + '\n' + primitiveCss.join('\n')
const tokens = tokenBlock(allCss)
console.log(
  `preview: extracted ${String(sheets.length)} stylesheet(s) from the bundle (${sheets.map((sheet) => sheet.name).join(', ')}) ` +
    `and ${String(primitiveCss.length)} from the primitives`,
)
console.log(`preview: defined ${String(tokens.split('\n').length)} design token(s)`)
console.log(`preview: version chip renders "${CHIP}" (e-mail address redacted from the panel's text)`)

const modules = join(uiRoot, 'node_modules')
const react = readFileSync(join(modules, 'react', 'umd', 'react.development.js'), 'utf8')
const reactDom = readFileSync(join(modules, 'react-dom', 'umd', 'react-dom.development.js'), 'utf8')

/** Write one harness page and produce its shot, asserting the DOM first. */
function shoot(view, png, width, height, title) {
  const file = join(outDir, `${view}.html`)
  writeFileSync(file, page({ react, reactDom, bundleSource: source, css: allCss, tokens, view, title }))
  const url = `file://${file}#${view}`
  const args = [`--window-size=${String(width)},${String(height)}`]
  const dom = chrome(chromePath, [...args, '--dump-dom', url])
  assertShot(view, dom, paintedMarkup(dom))
  chrome(chromePath, [...args, `--screenshot=${png}`, url])
  if (!existsSync(png)) {
    console.error(`preview: ${view}: the browser wrote no screenshot at ${png}`)
    process.exit(1)
  }
  const info = pngInfo(png)
  if (info.bytes < 10_000 || info.width !== width || info.height !== height) {
    console.error(`preview: ${view}: the screenshot is not a full render (${info.width}x${info.height}, ${info.bytes} bytes)`)
    process.exit(1)
  }
  const painted = /data-panel-height="([0-9]+)"/.exec(dom)
  const cleaned = /data-harness-redacted="([0-9]+)"/.exec(dom)
  console.log(`preview: ${view}: ok (panel content ${painted === null ? '?' : painted[1]}px in a ${String(height)}px window)`)
  console.log(`  html:       ${file}`)
  console.log(`  chip:       ${CHIP} (${cleaned === null ? '?' : cleaned[1]} text node(s) redacted)`)
  console.log(`  screenshot: ${png} (${info.width}x${info.height}, ${String(Math.round(info.bytes / 1024))} KiB)`)
  return png
}

/* The window is the panel's content height plus a fixed margin. Note that the
   `--dump-dom` pass lays the page out in a viewport about 143px shorter than
   the window (headless window chrome), which is why the clipping guard above
   carries that much slack — it can only refuse a shot that would really clip. */
shoot('global', panelPng, 1440, 760, 'dsh-mcp-mgr — MCP servers, global registry')
shoot('workspaces', workspacesPng, 1440, 820, 'dsh-mcp-mgr — MCP servers, per-workspace selection')

if (argv.includes('--open')) execFileSync('open', [panelPng, workspacesPng])
