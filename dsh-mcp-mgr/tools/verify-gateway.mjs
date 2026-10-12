#!/usr/bin/env node
/**
 * Verify the built host half against a real Cordis context.
 *
 * `tools/verify-typert.mjs` checks the *declared* wire contract and the UI
 * package's `verify-client.mjs` checks the browser bundle; neither proves that
 * the host service actually mounts and publishes its methods. This script does:
 * it constructs the compiled gateway on a `@deepseek-ai/cordis` `Context` and
 * reads the markers back with the protocol's own `remoteMethods()` — the exact
 * call the Host Gateway makes when it discovers what a service exposes.
 *
 * It catches the failures a typecheck cannot: a decorator that standard-mode
 * lowering dropped, a service key that no longer matches the wire namespace
 * (the client would then look for `remote.<namespace>` and find nothing), a
 * method marked with a name that is not a legal wire segment, and a host that
 * throws on construction — which takes the whole bundle row down with it, and
 * with it the sidebar entry the browser half would have registered.
 *
 * Usage: node tools/verify-gateway.mjs
 */

import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { McpMgrGateway } from '../lib/types/index.js'
import { TYPERT } from '../lib/types/typert.host.js'
import { REMOTE_NAMESPACE } from '../lib/types/typert.descriptors.js'
import { readLocalVersion } from '../lib/types/version.js'

const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }

/* A context with no composition: the gateway reaches everything through the
   dependency view, so this is the minimum a real mount also provides. The
   services it reads on construction are stubbed to their empty shape. */
const ctx = new Context()
const config = {
  enabled: true,
  registryPath: '/tmp/dsh-mcp-mgr-verify/mcp-servers.json',
  rescanIntervalMs: 600_000,
  strictMode: false,
  activeWorkspace: '',
}

let gateway
try {
  gateway = new McpMgrGateway(ctx, config)
} catch (error) {
  failures.push(`constructing the gateway threw, which fails the bundle row: ${String(error)}`)
}

if (gateway !== undefined) {
  check(gateway.name === REMOTE_NAMESPACE, `the Cordis service key must be "${REMOTE_NAMESPACE}" (got "${String(gateway.name)}")`)
  check(gateway.typertRemote?.namespace === REMOTE_NAMESPACE, `the Typert namespace must be "${REMOTE_NAMESPACE}" (got "${String(gateway.typertRemote?.namespace)}")`)

  const marked = remoteMethods(gateway)
  // The protocol stores `method` and, only when it differs, `exportName`; the
  // wire name is the export name when present.
  const names = marked.map((marker) => marker.exportName ?? marker.method).sort()
  const declared = TYPERT.invocations.map((descriptor) => descriptor.method).sort()

  check(names.every((name) => typeof name === 'string' && /^[A-Za-z0-9_$.-]+$/.test(name)), 'every Remote method needs a legal wire segment name')
  check(
    names.length === declared.length,
    `the live service exposes ${names.length} method(s) but the manifest declares ${declared.length}`,
  )
  check(
    names.join('|') === declared.join('|'),
    `the live methods and the manifest disagree: live-only ${names.filter((n) => !declared.includes(n)).join(', ') || 'none'}; manifest-only ${declared.filter((n) => !names.includes(n)).join(', ') || 'none'}`,
  )
  check(marked.every((marker) => marker.invocation?.kind === 'direct'), 'every method must be a direct (unscoped) invocation')

  // The browser half calls exactly these; a name it cannot find leaves the
  // panel degrading silently.
  for (const required of ['version', 'snapshot', 'setWorkspaceSelection', 'setServerEnabled']) {
    check(names.includes(required), `the live service does not expose "${required}"`)
  }

  // The gateway owns a rescan interval and a file watcher, so the process only
  // exits once they are released. Report before releasing so a throw during
  // disposal still prints the checks that already ran.
  try {
    gateway.dispose?.()
  } catch (error) {
    failures.push(`disposing the gateway threw: ${String(error)}`)
  }
}

/* The version reader must resolve from the built layout, not just from src/,
   or the title chip renders without a number. */
check(/^\d+\.\d+\.\d+/.test(readLocalVersion()), `readLocalVersion must resolve from the built layout, got "${readLocalVersion()}"`)

if (failures.length > 0) {
  console.error(`verify-gateway: ${failures.length} problem(s)`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`verify-gateway: PASS (${TYPERT.invocations.length} live methods)`)
// Its timers and watcher are released above, but a pending rescan microtask
// must not keep the process alive either.
process.exit(0)
