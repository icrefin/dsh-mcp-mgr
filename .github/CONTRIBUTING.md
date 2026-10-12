# Contributing to icrefin/dsh-mcp-mgr

Thanks for taking the time to contribute. This document covers the repository
**dsh-mcp-mgr** owned by `icrefin`.

## Ways to contribute

- Report a bug using the *Bug report* issue form.
- Request a feature using the *Feature request* issue form.
- Improve documentation, examples, or translations.
- Send a pull request that fixes or implements something on the issue tracker.

If you plan a large change, open an issue first so we can agree on the design
before you write the implementation.

## Before you start

1. Search existing issues and pull requests to avoid duplicates.
2. Read the [Code of Conduct](CODE_OF_CONDUCT.md).
3. Check the README for supported versions and prerequisites.

## Development setup

This is a pnpm workspace of two TypeScript packages — the host half and the
browser bundle. It needs **Node `^22.19.0 || >=24.0.0`** and **pnpm 11.8.0**, the
version pinned in the root manifest through `packageManager` (`corepack enable`
picks it up). The `@deepseek-ai/dsh-*` peer dependencies are published on npm, so
a clean checkout really does install.

```bash
git clone https://github.com/icrefin/dsh-mcp-mgr.git
cd dsh-mcp-mgr
git switch main

corepack enable
pnpm install
pnpm check          # typecheck → build → verify, both packages
```

| Command | What it does |
| --- | --- |
| `pnpm typecheck` | `tsc` in the host package, and both of the browser package's configs |
| `pnpm build` | `tsc -p tsconfig.build.json` in the host package, then `tsdown` in the UI package (`lib/`, `lib/client.js`) |
| `pnpm verify` | the two verifiers: the host artifact check, then the browser bundle check |
| `pnpm check` | `typecheck && build && verify` per package — run this before opening a pull request |
| `pnpm install:profile` | pack both packages and add them to a profile (`sh tools/install-into-profile.sh`) |

`lib/`, `dist/` and the packed tarballs are build products and are not committed.
`pnpm check` builds before it verifies, which is why the verifiers have something
to read: the host verifier imports the compiled `lib/types/` output, and the
bundle verifier evaluates the built `lib/client.js`.

### What each verifier covers

Two packages mean two artifacts and two verifiers; `pnpm check` runs both, after
the builds they read.

| Verifier | Covers |
| --- | --- |
| `dsh-mcp-mgr/tools/verify-typert.mjs` | the host manifest (`package`/`face`/`schemas`/`invocations`/`model`), every descriptor against what the Typert registry checks, every codec against a representative payload, and that the two faces plus the built client bundle inline the same method set |
| `dsh-mcp-mgr-ui/tools/verify-client.mjs` | the built `lib/client.js` behind a stub `window.__ModuleLoader__`: the loader row id, the `apply()` registration, and the `sidebar.panellist` row whose id matches the `main` key it opens |

The verifiers exist because the failures that matter are late ones: a codec that
predates a field strips it silently, and a stale bundle calls a method the host
does not have. Neither shows up in a typecheck.

### Verifying the browser bundle

`dsh-mcp-mgr-ui/tools/verify-client.mjs` reproduces what the page does: it stubs
the loader, evaluates the bundle, runs the factory with a `require` limited to the
platform seeds, and drives `apply()` against a recording slot registry. That is
what catches a row id that no longer matches the package name, a registration that
throws inside `apply()` (which would blank the GUI), and a panellist row whose id
does not match the `main` key it opens.

### Installing into a profile

`tools/install-into-profile.sh` builds and packs both packages, then adds them to
a profile with `dsh plugin` (the plain pnpm passthrough the Plugins page also
uses):

```bash
sh tools/install-into-profile.sh desktop   # build, pack and install both packages
```

The UI package goes in first, because the host depends on it. The desktop profile
belongs to the Electron application, so `dsh --profile desktop` refuses to compose
it, while `dsh plugin --profile desktop` works. Restart the app afterwards; the
sidebar entry appears directly under **Plugins**.

## Branch and commit conventions

- Branch from `main`; keep one topic per branch (`fix/...`, `feat/...`, `docs/...`).
- Keep commits small and focused.
- Write imperative, scoped commit messages, e.g. `fix(sync): keep a dangling use entry visible in the Workspaces tab`.
- Rebase onto the latest `main` before requesting review; avoid merge commits inside the PR branch.

## Pull requests

Every pull request must:

- Explain **what** changed and **why**.
- Link the issue it closes (`Closes #123`).
- Pass CI.
- Update documentation whenever user-facing text or behavior changes — including
  both the English and the Chinese copy in `dsh-mcp-mgr-ui/src/client/locales.ts`,
  because the panel renders whichever locale the host has active.
- Contain no secrets, tokens, private keys, internal hostnames, or personal data.
- State the license of any newly added dependency and confirm it is compatible with
  this project's `MIT` license.

Use the repository's pull request template. Do not delete checklist items without
explaining why.

## Reporting bugs

A useful bug report contains:

- The version, commit SHA, or release tag of the plugin you tested.
- The DeepSeek Harness build you ran it against, and how the plugin was installed.
- Operating system and runtime version.
- **The MCP server definitions involved** — each `serverName`, its transport, and
  whether it is a registry entry or a workspace-local one, with URLs, headers and
  `env` values redacted.
- **Which surface was in play** — the **Global servers** tab or the **Workspaces**
  tab, strict mode, and the active workspace, since the same name means different
  things in the two files.
- **Which file the entry came from** — `<profile>/.dsh/dshmm/mcp-servers.json` or
  the workspace's `.dsh/dshmm/mcp.json`.
- **The panel's own error text** — the row status and the message it printed, not
  a paraphrase.
- A screenshot of the panel with secrets redacted.
- Exact reproduction steps, expected result, and actual result.
- Logs with secrets and personal data removed.

Report security vulnerabilities privately — see [SECURITY.md](SECURITY.md). Never open
a public issue for a vulnerability.

## Coding style

- Match the style of the surrounding code; do not reformat unrelated files.
- Add or update tests for behavior changes.
- Keep public APIs documented.
- Prefer clear names over comments that restate the code.
- Do not add a dependency for something the standard library already does.
- Keep the two packages apart: `dsh-mcp-mgr/src/*` runs on the host (the registry,
  the sync layer, and the Typert descriptors), `dsh-mcp-mgr-ui/src/client/*` runs in
  the browser, and the browser half talks to the host only through the `mcpMgr`
  Remote — never by reading the JSON files itself.
- Declare the wire contract once, in `src/typert.descriptors.ts`. The host manifest
  and the browser contribution are both derived from that declaration, so do not
  hand-edit one face; keep every codec strict, so an unknown key is rejected
  rather than silently stripped.
- Never let a registration throw out of `apply()`: a throw blanks the surface the
  row was mounted into. Degrade to an error page instead.
- A write to either JSON file goes through the same validated path the panel uses.
  Do not add a second writer that skips validation.
- The verifiers run against compiled artifacts and a recording slot registry, never
  against a real profile or a live MCP server. Keep it that way.

## Sign-off

Every commit must carry a `Signed-off-by:` line, added by `git commit -s`. It is
your certification of the [Developer Certificate of Origin 1.1](https://developercertificate.org):
that you wrote the contribution or otherwise have the right to submit it under
this repository's license.

## Review process

Maintainers review pull requests as time allows. Expect at least one round of
feedback. Address comments with follow-up commits or a rebase, then re-request review.
A pull request inactive for 60 days without response may be closed.

## License

By contributing, you agree that your contributions are licensed under the `MIT`
license of this repository — inbound contributions are licensed outbound under
the same terms. Do not paste code you cannot license under these terms.

## Questions

Open an issue, or start a discussion in the repository's *Discussions* tab.

---

# 为 icrefin/dsh-mcp-mgr 贡献

感谢你抽出时间参与贡献。本文适用于 `icrefin` 名下的仓库 **dsh-mcp-mgr**。

## 贡献方式

- 用 *Bug report* 表单报告问题。
- 用 *Feature request* 表单提出需求。
- 改进文档、示例或翻译。
- 提交 pull request，修复或实现 issue 中的事项。

如果改动较大，请先开 issue 讨论设计，以免实现在错误的方向上白费功夫。

## 开始之前

1. 先搜索已有的 issue 和 pull request，避免重复。
2. 阅读[行为准则](CODE_OF_CONDUCT.md)。
3. 查看 README 中说明的支持版本与前置条件。

## 开发环境

本项目是一个 pnpm workspace，包含两个 TypeScript 包：宿主侧与浏览器 bundle。需要
**Node `^22.19.0 || >=24.0.0`** 与 **pnpm 11.8.0**（根 manifest 的 `packageManager`
字段已固定该版本，`corepack enable` 会自动采用）。`@deepseek-ai/dsh-*` 这些 peer
依赖已发布到 npm，因此在干净的检出上可以直接安装。

```bash
git clone https://github.com/icrefin/dsh-mcp-mgr.git
cd dsh-mcp-mgr
git switch main

corepack enable
pnpm install
pnpm check          # 先 typecheck，再 build，最后 verify，两个包都跑
```

| 命令 | 作用 |
| --- | --- |
| `pnpm typecheck` | 宿主包执行 `tsc`，浏览器包的两个配置各执行一次 `tsc` |
| `pnpm build` | 宿主包先 `tsc -p tsconfig.build.json`，UI 包再 `tsdown`（产物为 `lib/`、`lib/client.js`） |
| `pnpm verify` | 两个校验脚本：先校验宿主产物，再校验浏览器 bundle |
| `pnpm check` | 对每个包执行 `typecheck && build && verify` —— 提 PR 前请跑这个 |
| `pnpm install:profile` | 打包两个包并安装到 profile（`sh tools/install-into-profile.sh`） |

`lib/`、`dist/` 与打出的 tarball 都是构建产物，不纳入版本库。`pnpm check` 会先构建
再校验，所以校验脚本才有东西可读：宿主侧的校验脚本 import 编译后的 `lib/types/`，
bundle 校验脚本则直接求值构建好的 `lib/client.js`。

### 各校验脚本覆盖什么

两个包意味着两份产物、两个校验脚本；`pnpm check` 会在它们各自读取的构建之后依次跑完。

| 校验脚本 | 覆盖内容 |
| --- | --- |
| `dsh-mcp-mgr/tools/verify-typert.mjs` | 宿主 manifest（`package`/`face`/`schemas`/`invocations`/`model`）、每个描述符是否满足 Typert registry 的检查、每个 codec 对代表性载荷的解析，以及两侧与构建出的 client bundle 是否内联了同一套方法集 |
| `dsh-mcp-mgr-ui/tools/verify-client.mjs` | 在桩 `window.__ModuleLoader__` 之后加载构建好的 `lib/client.js`：loader 行 id、`apply()` 注册，以及 `sidebar.panellist` 行的 id 是否与它打开的 `main` key 一致 |

之所以要有校验脚本，是因为真正会出问题的地方都是「晚期失败」：早于某个字段的 codec 会静默
丢掉它，过期的 bundle 会调用宿主没有的方法。这两者类型检查都看不出来。

### 校验浏览器 bundle

`dsh-mcp-mgr-ui/tools/verify-client.mjs` 复现页面所做的过程：桩掉 loader、求值 bundle、
用一个只放行平台种子模块的 `require` 跑 factory，然后对着一个记录型 slot 注册表驱动
`apply()`。这样能抓到：行 id 已与包名不一致、`apply()` 里的注册抛出异常（会让 GUI 变空白），
以及 panellist 行的 id 与它打开的 `main` key 不匹配。

### 安装到 profile

`tools/install-into-profile.sh` 会构建并打包两个包，再用 `dsh plugin`（Plugins 页面同样使用的
pnpm 透传）把它们装进 profile：

```bash
sh tools/install-into-profile.sh desktop   # 构建、打包、安装两个包
```

UI 包先装，因为宿主包依赖它。桌面 profile 属于 Electron 应用，因此 `dsh --profile desktop`
拒绝组合它，而 `dsh plugin --profile desktop` 可以正常工作。之后重启应用，
侧边栏条目会出现在 **Plugins** 正下方。

## 分支与提交规范

- 从 `main` 拉分支，一个分支只做一件事（`fix/...`、`feat/...`、`docs/...`）。
- 提交粒度尽量小。
- 提交信息用祈使句并带范围，例如 `fix(sync): keep a dangling use entry visible in the Workspaces tab`。
- 请求评审前先 rebase 到最新的 `main`；PR 分支内避免合并提交。

## Pull request 要求

每个 pull request 必须：

- 说明改了**什么**、**为什么**改。
- 关联对应 issue（`Closes #123`）。
- 通过 CI。
- 当用户可见文案或行为变化时更新文档，包括 `dsh-mcp-mgr-ui/src/client/locales.ts`
  里的中英文文案——面板渲染的是宿主当前启用的语言。
- 不含任何密钥、令牌、私钥、内网主机名或个人数据。
- 说明新增依赖的许可证，并确认与本项目的 `MIT` 许可证兼容。

请使用仓库的 pull request 模板；不要在没有说明理由的情况下删除检查项。

## 报告 bug

一份有效的 bug 报告应包含：

- 你测试的插件版本号、commit SHA 或发布标签。
- 你运行它所用的 DeepSeek Harness 版本，以及插件的安装方式。
- 操作系统与运行时版本。
- **涉及的 MCP 服务器定义** —— 每个 `serverName`、它的传输方式，以及它是注册表条目
  还是工作区本地条目；URL、请求头与 `env` 值请先脱敏。
- **当时在哪个界面** —— **Global servers** 还是 **Workspaces** 标签页、严格模式是否开启、
  当前活动工作区是哪个，因为同一个名字在两个文件里含义不同。
- **条目来自哪个文件** —— `<profile>/.dsh/dshmm/mcp-servers.json` 还是工作区的
  `.dsh/dshmm/mcp.json`。
- **面板自己给出的错误文本** —— 行状态与它打印的那条消息，不要转述。
- 一张已脱敏的面板截图。
- 精确的复现步骤、期望结果与实际结果。
- 去除密钥与个人信息后的日志。

安全漏洞请私下报告，见 [SECURITY.md](SECURITY.md)。切勿为漏洞开公开 issue。

## 代码风格

- 与周边代码风格保持一致；不要顺手重排无关文件。
- 行为变更需要新增或更新测试。
- 公开 API 必须有文档。
- 命名要清晰，避免复述代码的注释。
- 标准库已能实现的功能，不要新增依赖。
- 保持两个包分离：`dsh-mcp-mgr/src/*` 跑在宿主侧（注册表、同步层与 Typert 描述符），
  `dsh-mcp-mgr-ui/src/client/*` 跑在浏览器侧；浏览器侧只能通过 `mcpMgr` Remote 与宿主
  通信，不要自己去读那两个 JSON 文件。
- 线上契约只声明一次，位于 `src/typert.descriptors.ts`：宿主 manifest 与浏览器侧贡献都由它
  派生，所以不要手改其中一面；每个 codec 都要保持严格，让未知键被拒绝而不是被静默丢弃。
- 不要让注册把异常抛出 `apply()`：一次抛出会让该行挂载的界面变成空白。请退化成错误页面。
- 写这两个 JSON 文件必须走面板用的同一条校验路径，不要新增绕过校验的第二个写入方。
- 校验脚本跑在构建产物和记录型 slot 注册表上，绝不接触真实 profile 或真实 MCP 服务器。
  请保持这一点。

## Sign-off

每个提交都必须带 `Signed-off-by:` 行，由 `git commit -s` 添加。它是对
[开发者原创声明 1.1（DCO）](https://developercertificate.org) 的确认：你撰写或拥有该贡献的提交权，
并同意按本仓库的许可证授权。

## 评审流程

维护者会在时间允许时评审 pull request，通常至少有一轮反馈。请通过后续提交响应意见，
或推送 rebase 后重新请求评审。超过 60 天无回应的 pull request 可能被关闭。

## 许可证

参与贡献即表示你同意自己的贡献按本仓库的 `MIT` 许可证授权——进来的贡献以同样的条款出去。
请勿粘贴你无权按此条款授权的代码。

## 疑问

请开 issue，或在仓库的 *Discussions* 标签页发起讨论。
