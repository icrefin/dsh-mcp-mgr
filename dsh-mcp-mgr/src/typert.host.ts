/**
 * Host-face Typert artifact.
 *
 * `dsh-typert-loader` imports `exports["./typert"]`, validates the manifest and
 * hands it to `ctx.typert.register`, which is what lets the Host Gateway
 * dispatch `mcpMgr/<method>` calls against this plugin's service.
 *
 * The manifest is not compiler-generated: the descriptor table in
 * `typert.descriptors.ts` is the single declaration both faces share, which is
 * the same guarantee a generated pair gives (host and client can never
 * disagree about a wire name or a codec) with the table reviewable as source.
 *
 * @module dsh-mcp-mgr/typert.host
 */

export { HOST_MANIFEST as TYPERT } from './typert.descriptors.ts'
