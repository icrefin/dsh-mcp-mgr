# dsh-mcp-mgr (host package)

The host half of [dsh-mcp-mgr](https://github.com/icrefin/dsh-mcp-mgr): the MCP
server registry, the sync layer that mounts selected servers through
`mcp-client`, and the `mcpMgr` Typert Remote contract both halves share.

The browser half — the sidebar row and the page it opens — is the separate
package `dsh-mcp-mgr-ui`, and both are Loader rows of their own: installing this
package alone leaves the sidebar entry without the page it opens.

- User documentation and installation: the [repository README](https://github.com/icrefin/dsh-mcp-mgr#readme)
- Architecture, the file model and the Remote surface: [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)

MIT. Derives from `dsh-mcp-mgr` 0.2.0 by yangfch3; see the `LICENSE` beside this
file.
