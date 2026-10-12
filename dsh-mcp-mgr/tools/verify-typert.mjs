#!/usr/bin/env node
/**
 * Verify the published Typert artifacts of dsh-mcp-mgr.
 *
 * The Host Gateway and the Client API gateway validate these artifacts at
 * runtime, and both fail *late*: an undeclared argument is a loud
 * `gateway/arguments-invalid`, but a codec that predates a field silently
 * strips it and the method body sees `undefined` with no error anywhere. This
 * script is the cheap gate that catches both before an install:
 *
 * 1. the host manifest satisfies everything `dsh-typert-loader` checks
 *    (`package`/`face`/`schemas`/`invocations`/`model`);
 * 2. every descriptor satisfies everything `dsh-typert-registry` checks
 *    (ids, unique wire names, strict codecs with a `create()` factory);
 * 3. every codec's `create()` returns a schema that parses a representative
 *    payload — i.e. the schema shown to the boundary is the one the methods
 *    actually take, and it still rejects an unknown key rather than passing it
 *    through;
 * 4. the two faces describe the same method set, so a browser bundle can never
 *    mount an older descriptor set than the host serves;
 * 5. the client bundle inlines that same method set (it is bundled from
 *    `typert.remote-client.ts`, and a stale bundle would otherwise ship a UI
 *    that calls a method the host does not have).
 *
 * Usage: node tools/verify-typert.mjs
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

/** Assert one condition. */
function check(condition, message) {
  if (!condition) failures.push(message)
}

const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const { TYPERT } = await import(pathToFileURL(join(packageRoot, 'lib/types/typert.host.js')).href)
const client = await import(pathToFileURL(join(packageRoot, 'lib/types/typert.remote-client.js')).href)

/* ---- 0. every declared entry point exists ------------------------------ */
/*
 * The Loader imports this package by name. A path declared in `main`/`exports`
 * that the build never emits fails that import, and a failed row is a warning at
 * boot with a missing surface rather than a build error, so check the
 * declarations against the filesystem first.
 */
const declaredEntries = [
  ...(typeof manifest.main === 'string' ? [['main', manifest.main]] : []),
  ...(typeof manifest.types === 'string' ? [['types', manifest.types]] : []),
  ...Object.entries(manifest.exports ?? {}).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [[`exports["${key}"]`, value]]
      : Object.entries(value ?? {}).map(([condition, path]) => [`exports["${key}"].${condition}`, path])),
  // `./src/*` and friends are patterns, not files.
].filter(([, path]) => typeof path === 'string' && !path.includes('*') && (path.startsWith('./') || path.startsWith('lib/')))

for (const [label, path] of declaredEntries) {
  check(existsSync(join(packageRoot, path.replace(/^\.\//, ''))), `${label} points at "${path}", which the build did not emit`)
}

/* ---- 1. the host manifest -------------------------------------------- */

check(TYPERT.package === manifest.name, `manifest.package must be the package name (got ${String(TYPERT.package)})`)
check(TYPERT.face === 'host', `manifest.face must be 'host' (got ${String(TYPERT.face)})`)
check(typeof TYPERT.schemas === 'object' && TYPERT.schemas !== null, 'manifest.schemas must be an object')
check(Array.isArray(TYPERT.invocations), 'manifest.invocations must be an array')
check(TYPERT.model !== undefined, 'manifest.model must be present')

/* ---- 2. the descriptors ---------------------------------------------- */

const namespaces = new Set()
for (const descriptor of TYPERT.invocations) {
  const id = descriptor.id
  check(typeof id === 'string' && id.length > 0, 'every descriptor needs a non-empty id')
  const [owner] = String(id).split('#')
  check(String(owner) === manifest.name, `descriptor id "${String(id)}" must be owned by this package`)
  const method = descriptor.method
  check(typeof method === 'string' && method.length > 0, `descriptor "${String(id)}" needs a method segment`)

  const segments = String(id).split('#')
  check(segments.length === 2, `descriptor "${String(id)}" must be "<package>#<namespace>/<method>"`)
  check(descriptor.method === method, `descriptor "${String(id)}" must carry its method name`)

  const wires = new Set()
  for (const parameter of descriptor.parameters ?? []) {
    check(typeof parameter.wire === 'string' && parameter.wire.length > 0, `descriptor "${String(id)}" has a parameter with no wire name`)
    check(!wires.has(parameter.wire), `descriptor "${String(id)}" repeats the wire name "${String(parameter.wire)}"`)
    wires.add(parameter.wire)
    check(parameter.source === 'json', `descriptor "${String(id)}" parameter "${String(parameter.wire)}" must read from json`)
  }

  for (const codec of [...(descriptor.parameters ?? []).map((p) => p.codec), descriptor.result]) {
    check(codec !== undefined, `descriptor "${String(id)}" is missing a codec`)
    check(codec?.mode === 'strict', `descriptor "${String(id)}" must use a strict codec`)
    check(typeof codec?.typeSymbol === 'string' && codec.typeSymbol.length > 0, `descriptor "${String(id)}" codec needs a typeSymbol`)
    check(typeof codec?.create === 'function', `descriptor "${String(id)}" codec needs a create() factory`)
  }
  namespaces.add(segments[1]?.split('/')[0] ?? '')
}

check(namespaces.size === 1, `every descriptor must share one namespace (got ${[...namespaces].join(', ')})`)
check(namespaces.has('mcpMgr'), `the namespace must be the Cordis service key mcpMgr (got ${[...namespaces].join(', ')})`)

/* ---- 3. the codecs parse a representative payload --------------------- */

/** Parse `value` through one codec; returns the result. */
function parseWith(codec, value) {
  return codec.create().safeParse(value)
}

/** Whether the codec accepts `value`. */
function parse(codec, value) {
  return parseWith(codec, value).success
}

const byMethod = new Map(TYPERT.invocations.map((d) => [d.method, d]))

const applyResult = byMethod.get('apply')
check(applyResult !== undefined, 'the apply descriptor must exist')
check(parse(applyResult.result, { ok: true }), 'McpApplyResult must accept the ok branch')
check(parse(applyResult.result, { ok: false, error: 'x' }), 'McpApplyResult must accept the error branch')
// strict mode strips what it does not know instead of failing — assert the
// strip, since a passed-through key is the silent corruption this guards.
const stripped = parseWith(applyResult.result, { ok: true, error: 'x' })
check(stripped.success, 'McpApplyResult must accept the ok branch even with a stray key')
check(
  stripped.success && !('error' in stripped.data),
  'McpApplyResult must STRIP an unknown key rather than forward it',
)
check(!parse(applyResult.result, { ok: 'yes' }), 'McpApplyResult must reject a non-boolean ok')

const snapshot = byMethod.get('snapshot')
check(snapshot !== undefined, 'the snapshot descriptor must exist')
check(
  parse(snapshot.result, {
    global: [], workspaces: [], profile: [], registryPath: '/p',
    watchedWorkspaces: [], strictMode: false, activeWorkspace: '',
  }),
  'McpManagerSnapshot must accept an empty projection',
)

/* ---- 4. both faces carry the same method set -------------------------- */

const hostMethods = [...new Set(TYPERT.invocations.map((d) => d.method))].sort()
const clientMethods = [...new Set((client.TYPERT_REMOTE?.descriptors ?? []).map((d) => d.method))].sort()
check(
  hostMethods.join('|') === clientMethods.join('|'),
  `the host and client faces disagree on the method set:\n      host:   ${hostMethods.join(', ')}\n      client: ${clientMethods.join(', ')}`,
)
check(!hostMethods.includes('versionInfo'), 'the removed update-check method must stay gone')

/* ---- 4b. the table covers exactly what the host declares -------------- */
/*
 * The check above only proves the two published faces agree with EACH OTHER,
 * which they do by construction: both are built from this one table. It cannot
 * notice a `@Remote` on the host class that never made it into the table, and
 * that failure is invisible until the panel calls the method and gets
 * "unknown method" — a missing title chip, not a build error. `src/index.ts` is
 * the authority, so read it and require the two sets to match exactly.
 */
const source = readFileSync(join(packageRoot, 'src', 'index.ts'), 'utf8')
const declared = [...source.matchAll(/@Remote\(\s*'([^']+)'\s*\)/g)].map((match) => match[1]).sort()
check(declared.length > 0, 'no @Remote decorators found in src/index.ts — the check would be vacuous')

const missing = declared.filter((method) => !hostMethods.includes(method))
const extra = hostMethods.filter((method) => !declared.includes(method))
check(
  missing.length === 0,
  `the descriptor table is missing a @Remote the host declares, which fails at call time: ${missing.join(', ')}`,
)
check(
  extra.length === 0,
  `the descriptor table carries a method the host does not declare: ${extra.join(', ')}`,
)
check(
  declared.join('|') === hostMethods.join('|'),
  `src/index.ts and the descriptor table disagree:\n      index.ts: ${declared.join(', ')}\n      table:    ${hostMethods.join(', ')}`,
)

/* ---- 5. the built client bundle inlines the same set ------------------ */

// The sibling package's bundle is the artifact this section reads, and a fresh
// checkout has no lib/ at all: say so plainly instead of failing with ENOENT,
// because the fix is one command rather than a code change.
const uiBundle = join(packageRoot, '..', 'dsh-mcp-mgr-ui', 'lib', 'client.js')
if (!existsSync(uiBundle)) {
  console.error(
    'verify-typert: dsh-mcp-mgr-ui/lib/client.js is missing.\n\n'
    + '  This check reads the sibling package\'s built browser bundle, so the UI\n'
    + '  package must be built first. From the repository root:\n\n'
    + '      pnpm install && pnpm check\n\n'
    + '  (`pnpm check` builds both packages, then verifies both; building only the\n'
    + '  host package is what leaves this file absent.)\n',
  )
  process.exit(1)
}
const bundle = readFileSync(uiBundle, 'utf8')
for (const method of hostMethods) {
  check(bundle.includes(`method: "${method}"`) || bundle.includes(`method:"${method}"`), `lib/client.js does not carry the "${method}" descriptor`)
}
// The name may appear in a comment explaining its absence; what must not
// appear is a live descriptor for it.
check(!/method:\s*"versionInfo"/.test(bundle), 'lib/client.js still carries a live versionInfo descriptor')
check(!bundle.includes('yangfch3'), 'lib/client.js still carries the upstream project URL')

/* ---- report ------------------------------------------------------------ */

if (failures.length > 0) {
  console.error(`verify-typert: ${failures.length} failure(s)\n`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`verify-typert: PASS (${hostMethods.length} methods, ${TYPERT.invocations.length} invocations)`)
