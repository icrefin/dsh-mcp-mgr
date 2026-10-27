# dsh-mcp-mgr — architecture and engineering record

> The entry point for users is the [README](../README.md). This document is the
> engineering record: the file model, the Remote surface, the panel's slot wiring
> and the verifiers that gate a change.

A workspace-level MCP server manager for DeepSeek Harness. It reads MCP server
definitions, registers their tools through `mcp-client`, and manages them from a
**left-sidebar panel** whose entry sits directly under **Plugins**. Workspace
tools use the `mcp__<serverName>__<tool>` convention.

```
dsh-mcp-mgr/
├── dsh-mcp-mgr/          the host package: registry, sync, the mcpMgr Remote
├── dsh-mcp-mgr-ui/       the browser package: the sidebar row and its page
├── tools/
│   └── install-into-profile.sh    build both, pack both, install both
├── docs/
│   └── ARCHITECTURE.md   this document
└── README.md             the user-facing entry point
```

Both packages are Loader rows of their own. The host carries the management
logic and the Typert descriptors; the UI carries the browser bundle and the
`dsh.client` declaration the client-modules scanner reads. Installing the host
alone leaves the sidebar row without the page it opens.

## What it manages

Servers are defined once for the profile and selected per workspace, instead of
being redeclared in every workspace file:

```
<profile>/.dsh/dshmm/mcp-servers.json     every server definition, shared
<workspace>/.dsh/dshmm/mcp.json           `use: [...]` selects from it,
                                          and may still declare inline servers
```

A missing `use` keeps a workspace file working exactly as before. A selected
global server mounts once for the whole profile; inline servers mount per
workspace. Strict mode mounts only the active workspace's servers.

## The panel

The page is registered into two slots, both keyed by the same id (`mcpMgr`):

| Slot | Registration | Effect |
|---|---|---|
| `sidebar.panellist` | `id: 'mcpMgr'`, `order: 1` | the icon row under **Plugins** (`order: 0`) |
| `main` | `key: 'mcpMgr'` | the page the row opens in the center column |

Selecting the row goes through `ctx.layout.selectPanel('mcpMgr')`, a lookup in
the live `main` registry — so the two registrations must share the id, and a
missing `main` entry throws instead of switching panels. The page follows the
same geometry the built-in Plugins page uses: full height, its own scroll
container, a centered 960px column, and a header that clears the macOS window
chrome through `--dsh-frame-top-clearance`.

The title carries the installed plugin version and the author credit as a
trailing `v1.0.1 Author: icrefin [icrefinai@gmail.com]` chip, per `STYLES.md`.
The version is read once by the host from its own manifest and served over the
`version` Remote; the chip is simply absent when that read fails.

### Two tabs

The page separates the two jobs, which would otherwise share one scrolling
column:

| Tab | Content |
|---|---|
| **Global servers** | the registry: add / edit / delete / enable a server, plus the profile-level `mcp-client` registrations as read-only rows |
| **Workspaces** | which global servers each workspace selects, plus each workspace's own local servers, its dangling references, and its parse errors |

`SegmentedTabs` renders the tab list and owns the ARIA wiring
(`role="tablist"`, roving `tabIndex`, Left/Right/Home/End); the two panels are
this component's, addressed by the fixed ids `mcpMgr-panel-global` and
`mcpMgr-panel-workspaces` that the tab entries name. Both panels stay mounted
and the inactive one carries `hidden` — with an explicit `.panel[hidden]`
`display: none`, because the panel's own `display: flex` outranks the UA rule.

The tab choice is component state, and the panels survive a snapshot reload: a
selection toggle re-reads the snapshot without remounting the page, so the choice
and the scroll position hold. Both tabs read the same snapshot; a reload after a
mutation therefore never leaves one tab showing a stale registry.

A selection toggle is optimistic. The new selection is held per workspace until a
snapshot confirms it, so the checkbox does not flip back for the duration of the
round trip, and a rejected write drops the override rather than showing a
selection the host never accepted.

`dsh.client.inject` carries the ordering: `@deepseek-ai/dsh-client-ui-sidebar`
and `-layout` declare the two slots, so the client loader waits for them before
the bundle's `apply` runs.

## Remote surface

Thirteen methods on the `mcpMgr` namespace, declared once in
`src/typert.descriptors.ts` and wrapped as the host manifest
(`src/typert.host.ts`) and the browser contribution
(`src/typert.remote-client.ts`). Because both faces read the same table they
cannot disagree about a wire name or a codec.

| Method | Purpose |
|---|---|
| `snapshot` | the whole management view |
| `setStrictMode` · `setActiveWorkspace` | gateway state, answering the refreshed snapshot |
| `apply` · `removeServer` · `setServerEnabled` | workspace-local servers |
| `saveGlobalServer` · `saveGlobalServerJson` · `removeGlobalServer` · `setGlobalServerEnabled` | the global registry |
| `setWorkspaceSelection` · `importLocalServer` | which servers a workspace selects |
| `importJson` | bulk import, answering its own report |

Every descriptor uses a strict codec with a type symbol and a `create()` factory,
which is what `dsh-typert-loader` requires. The runtime schemas live beside the
table; `src/types.ts` holds the TypeScript contract and ends with a compile-time
assertion that each interface and its schema stay mutually assignable, so the two
cannot drift into silently stripping a field at the boundary.

## Configuration

### Workspace file — `<workspace>/.dsh/dshmm/mcp.json`

```json
{
  "use": ["shared-http-server"],
  "mcpServers": {
    "local-stdio-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "<mcp-server-package>"]
    }
  }
}
```

### Global registry — `<profile>/.dsh/dshmm/mcp-servers.json`

Same `mcpServers` schema, no `use`. Entries move between the two files without
translation, and both stay hand-editable. The file is created on the first save
from the panel.

Rules for either file:

- a missing `type` is treated as Streamable HTTP; `${VAR}` expansion is supported;
- a stdio server without `cwd` uses the workspace root;
- `serverName` must match `^[A-Za-z0-9_-]{1,32}$` and is globally unique —
  duplicates surface as conflicts;
- `"enabled": false` disables an entry without removing it; absent means enabled.

## Build, verify, install

```sh
pnpm install          # once, from the repository root
pnpm check            # typecheck → build → verify, both packages
```

`check` is the whole gate, and it builds **both** packages before verifying
either, because the host's verifier reads the UI package's built bundle. The
per-package commands exist for working inside one package, but only after a full
`pnpm check` has run at least once:

```sh
pnpm --filter dsh-mcp-mgr check       # typecheck → build → verify
pnpm --filter dsh-mcp-mgr-ui check
```

Beyond the typecheck it runs two verifiers that catch what types cannot:

| Verifier | What it drives |
|---|---|
| `dsh-mcp-mgr/tools/verify-typert.mjs` | loads both published manifests, validates every descriptor the way `dsh-typert-loader` does, checks the codecs parse representative payloads and strip unknown keys, and confirms the browser bundle inlines the same method set the host serves (it says so, and names the fix, when that bundle has not been built) |
| `dsh-mcp-mgr-ui/tools/verify-client.mjs` | evaluates `lib/client.js` behind a stub module loader, runs `apply()` against a recording slot registry, and asserts the sidebar row and main page share one id, the externals are only platform seeds, and the version chip matches the style contract |

Then install into a profile and restart DeepSeek Harness:

```sh
sh tools/install-into-profile.sh desktop
```

The script builds and packs both packages and hands them to `dsh plugin add`,
which is a pnpm passthrough into the profile directory — the same thing the
Plugins page does. The desktop profile is owned by the Electron application, so
`dsh --profile desktop` itself refuses it; `dsh plugin` does not.

## Caveats

- **"Connected" means the tools are registered** (`mcp__<name>__*` present in the
  tool registry), not that the network is live. `mcp-client` exposes no live
  connection state, so a real disconnect cannot be detected without changing dsh
  itself. A connection that drops keeps its last tool generation and reconnects
  with backoff; the row shows *Registered* once the reconnect budget is spent.
- **The refresh button re-reads the host's last snapshot**; it does not probe.
- The plugin polls no registry and offers no self-update: the panel shows its
  installed version, and updating means rebuilding and reinstalling it here.

## License and provenance

MIT (see the `LICENSE` at the repository root, which both packages also carry).

This repository is a **source-built rewrite**, not a vendored copy of the
published bundles: the code derives from `dsh-mcp-mgr` 0.2.0 and
`dsh-mcp-mgr-ui` 0.2.0 by **yangfch3** (MIT), whose copyright line is kept in
the LICENSE files, and every line here is compiled from the `src/` in this
repository. The panels register into the slots dsh's own pages use
(`sidebar.panellist` and `main`) and follow the platform's `STYLES.md` contract
for page geometry and the version chip.
