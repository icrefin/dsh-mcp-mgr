# dsh-mcp-mgr

**一份面向整个 profile 的 MCP 注册表** —— MCP 服务器只声明一次，按工作区挑选使用，并在 DeepSeek Harness 的左侧边栏面板里统一管理。

[English](README.md) | **简体中文**

[![License](https://img.shields.io/github/license/icrefin/dsh-mcp-mgr?style=flat-square)](LICENSE)
[![Release](https://img.shields.io/github/v/release/icrefin/dsh-mcp-mgr?style=flat-square)](https://github.com/icrefin/dsh-mcp-mgr/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/icrefin/dsh-mcp-mgr/ci.yml?branch=main&style=flat-square)](https://github.com/icrefin/dsh-mcp-mgr/actions/workflows/ci.yml)
[![Last commit](https://img.shields.io/github/last-commit/icrefin/dsh-mcp-mgr?style=flat-square)](https://github.com/icrefin/dsh-mcp-mgr/commits/main)
[![Stars](https://img.shields.io/github/stars/icrefin/dsh-mcp-mgr?style=flat-square)](https://github.com/icrefin/dsh-mcp-mgr/stargazers)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/icrefin/dsh-mcp-mgr/pulls)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-339933?style=flat-square&logo=node.js)](https://nodejs.org)
[![dsh](https://img.shields.io/badge/dsh-0.2.0--rc.2-4B5563?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)

> 如果这个插件帮你省下了一轮手改 JSON 的功夫，欢迎点一个 ⭐ Star，让更多人看到它。

## 它解决的问题

MCP 服务器是**按工作区**声明的，于是同一台服务器的描述会被复制到每个需要它的工作区文件里 —— 然后各自漂移。本插件把原本纠缠在一起的两个问题拆开：

| 问题 | 现在由谁回答 |
|---|---|
| *有哪些服务器？* | 一次回答，写在 profile 级注册表里 |
| *这个工作区用哪几个？* | 该工作区文件里的 `use` 列表 |

服务器可以在两个文件之间直接搬移、无需转换，两边都保持可手工编辑；而没有采用本插件的工作区行为完全不变：`use` 缺失时，它内联的 `mcpServers` 照旧挂载。

## 截图

![MCP Servers 面板：全局服务器注册表](docs/images/mcp-servers-panel.png)

*Global servers —— 新增、编辑、删除、启用或停用一台服务器，并列出 profile 级 `mcp-client` 注册（只读行）。*

![Workspaces 标签页：按工作区选择服务器](docs/images/mcp-servers-workspaces.png)

*Workspaces —— 每个工作区选中了哪些全局服务器，以及它自己的本地服务器、悬空引用与解析错误。*

## 两个文件

```
<profile>/.dsh/dshmm/mcp-servers.json     every server definition, shared
<workspace>/.dsh/dshmm/mcp.json           `use: [...]` selects from it,
                                          and may still declare inline servers
```

被选中的全局服务器在整个 profile 里只挂载一次；内联服务器按工作区挂载。严格模式（strict）下只挂载当前活动工作区的服务器。

## 功能

| 界面 | 作用 |
|---|---|
| 侧边栏条目 | 紧挨 **Plugins** 下方（`order: 1`），点开即在中栏打开 **MCP Servers** 页面 |
| Global servers 标签页 | 注册表本身：新增 / 编辑 / 删除 / 启用服务器，并把 profile 级 `mcp-client` 注册列为只读行 |
| Workspaces 标签页 | 以复选框按工作区选择服务器，另含各工作区自己的本地服务器、悬空引用、解析错误 |
| JSON 编辑 | 粘贴整个 `mcpServers` 对象或单台服务器的 JSON；由 host 校验并逐条报告错误 |
| 批量导入 | 一次导入多台服务器，并返回导入报告 |
| 工具注册 | 服务器经 `mcp-client` 注册；工作区工具使用 `mcp__<serverName>__<tool>` 命名约定 |
| 面板细节 | 选择操作乐观更新，后台每 60 秒刷新一次，标签页与滚动位置在重载后保留，标题带已安装版本号徽标 |

## 环境要求

- Node.js `^22.19.0 || >=24.0.0`
- 一套 DeepSeek Harness `0.2.0-rc.2` 安装（插件组合进某个 profile）
- `pnpm` 11.8.0（由根清单的 `packageManager` 固定）

## 安装

构建两个包、打包，然后交给 profile：

```sh
pnpm install
pnpm check                        # typecheck → build → verify, both packages
sh tools/install-into-profile.sh desktop
```

之后重启 DeepSeek Harness，侧边栏条目会出现在 **Plugins** 正下方。

本仓库有两个包，各自都是一个独立的 Loader 行：

| 包 | 职责 |
|---|---|
| `dsh-mcp-mgr` | host 半：注册表、同步层，以及 `mcpMgr` Typert Remote 契约 |
| `dsh-mcp-mgr-ui` | 浏览器半：侧边栏条目及它打开的页面 |

只装 host 会留下一个打不开页面的侧边栏条目，因此两者一起构建、一起安装。这两个包没有发布到 npm：profile 直接从本仓库安装。

脚本用的是 `dsh plugin`（等价于 pnpm 直通写入 profile 目录），Plugins 页面做的是同一件事。desktop profile 归 Electron 应用所有，所以 `dsh --profile desktop` 本身拒绝组合它，而 `dsh plugin` 仍然可用。

## 快速开始

1. 在侧边栏打开 **MCP Servers**。
2. 在 **Global servers** 里新增一台服务器 —— 用表单，或直接粘贴 JSON：

   ```json
   {
     "shared-http-server": {
       "type": "http",
       "url": "https://mcp.example.com/mcp"
     }
   }
   ```

3. 切到 **Workspaces**，为需要使用它的工作区勾选这台服务器。
4. 重启，或等面板刷新确认新的快照；服务器的工具会以 `mcp__shared-http-server__*` 出现。

## 配置

以下规则对两个文件都适用：

- 缺少 `type` 时按 Streamable HTTP 处理；支持 `${VAR}` 展开；
- 没有 `cwd` 的 stdio 服务器以工作区根目录为工作目录；
- `serverName` 必须匹配 `^[A-Za-z0-9_-]{1,32}$` 且全局唯一 —— 重名会以冲突形式暴露；
- `"enabled": false` 停用一条记录但不删除它；字段缺失表示启用。

profile 注册表会在面板第一次保存时自动创建，两个文件都不必手工新建。

## Remote 接口

`mcpMgr` 命名空间上有 13 个方法，只在 `src/typert.descriptors.ts` 里声明一次，再分别包装成 host 清单与浏览器侧贡献，因此两个面不可能对wire 名或编解码器产生分歧：

| 方法 | 用途 |
|---|---|
| `snapshot` | 整个管理视图 |
| `setStrictMode` · `setActiveWorkspace` | 网关状态，返回刷新后的快照 |
| `apply` · `removeServer` · `setServerEnabled` | 工作区本地服务器 |
| `saveGlobalServer` · `saveGlobalServerJson` · `removeGlobalServer` · `setGlobalServerEnabled` | 全局注册表 |
| `setWorkspaceSelection` · `importLocalServer` | 工作区选中哪些服务器 |
| `importJson` | 批量导入，返回自己的报告 |

## 注意事项

- **“已连接”指的是工具已注册**（工具注册表里存在 `mcp__<name>__*`），而不是网络在线。`mcp-client` 不暴露实时连接状态，因此不修改 dsh 本身就无法检测真正的断连。连接掉线时它会保留最后一代工具，并以退避策略重连。
- **刷新按钮只是重新读取 host 的最后一份快照**，不做探测。
- 插件不轮询任何注册表，也不提供自更新：面板显示的是已安装版本，升级意味着在这里重新构建并重装。

## 许可证与来源

MIT —— 见 [LICENSE](LICENSE)。host 与 UI 两个包派生自 **yangfch3** 的 `dsh-mcp-mgr` 0.2.0（MIT）；该版权行保留在 LICENSE 文件中。本仓库是在源码层面独立重写，而不是对已发布 bundle 的 vendored 拷贝。

面板注册进的是 dsh 自带页面所用的同一批插槽（`sidebar.panellist` 与 `main`），并遵循平台 `STYLES.md` 对页面几何与版本徽标的约定。

> 点 Star 不花钱，但能让这个项目被更多人发现。如果它帮到了你，欢迎点一下 ⭐。
