/**
 * The installed package version, read from this package's own manifest.
 *
 * It is what the panel's version chip renders beside the title. Reading it is
 * best-effort: a layout the reader does not recognise returns `''`, and the
 * chip simply omits the number rather than failing the page.
 * @module dsh-mcp-mgr/version
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

/** The package this module reports the version of. */
const PACKAGE = 'dsh-mcp-mgr'

/**
 * Read the installed version of this package.
 *
 * Tries the package self-reference first (the installed layout, where
 * `package.json` is an export), then the two file layouts a source tree can
 * have — `src/` and `lib/types/` are both one or two levels below the manifest.
 * @returns the version string, or `''` when nothing readable was found.
 */
export function readLocalVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require(`${PACKAGE}/package.json`) as { version?: unknown }
    if (typeof pkg.version === 'string') return pkg.version
  } catch {
    // Not resolvable as a package: fall through to the file layouts.
  }
  for (const relative of ['../package.json', '../../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8')) as { version?: unknown }
      if (typeof pkg.version === 'string') return pkg.version
    } catch {
      // try the next layout
    }
  }
  return ''
}
