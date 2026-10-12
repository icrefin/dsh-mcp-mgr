# dsh-mcp-mgr-ui (browser package)

The browser half of [dsh-mcp-mgr](https://github.com/icrefin/dsh-mcp-mgr): the
**MCP Servers** page in the dsh sidebar — the global server registry and the
per-workspace selection — built as a module-loader bundle from the `src/client/`
sources in this package.

The host half — the registry, the sync layer and the `mcpMgr` Typert Remote
contract this bundle calls — is the separate package `dsh-mcp-mgr`. Both are
Loader rows of their own, and this bundle is what the client-modules scanner
reads for the `dsh.client` declaration, so it cannot be folded into the host.

- User documentation and installation: the [repository README](https://github.com/icrefin/dsh-mcp-mgr#readme)
- Architecture, the panel's slot wiring and the Remote surface: [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)

## License

MIT. Derives from `dsh-mcp-mgr-ui` 0.2.0 by yangfch3; see the `LICENSE` beside
this file.
