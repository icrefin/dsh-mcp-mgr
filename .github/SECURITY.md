# Security Policy

## Supported versions

Only the versions below receive security fixes. Older releases are provided "as-is" —
upgrade to a supported line before reporting.

| Version | Supported | Notes |
| --- | --- | --- |
| `main` (latest commit) | :white_check_mark: | Active development |
| Latest tagged release | :white_check_mark: | Fixes are backported when practical |
| Older tagged releases | :x: | Upgrade to the latest release |
| Forks and modified copies | :x: | Report to the maintainer of that fork |

## Reporting a vulnerability

**Do not open a public issue, discussion, or pull request for a security problem.**
A public report exposes every user before a fix exists.

Report privately through **GitHub Security Advisories**:
`https://github.com/icrefin/dsh-mcp-mgr/security/advisories/new`
(repository → *Security* → *Advisories* → *Report a vulnerability*). This keeps the
report private and gives us a private fork in which to prepare the fix.

Include in your report:

- Affected version or commit, plus the dsh build and the deployment you ran it in.
- Which MCP server definitions were involved, in which of the two files, and which
  tab was open, with URLs, headers and `env` values redacted.
- A minimal reproduction (proof of concept, code, or test case).
- Impact assessment: what an attacker gains, and under which preconditions.
- Any fix or mitigation you already know of.
- Whether you intend to publish, and the name you want used for credit.

## Our commitments

| Stage | Target |
| --- | --- |
| Acknowledge receipt | 3 business days |
| Initial assessment and severity triage | 10 business days |
| Fix or documented mitigation | 30 days for high/critical, best effort otherwise |
| Public disclosure | Coordinated with you, after a fix is available |

We credit you in the advisory unless you ask us not to. We will not pursue legal action
against researchers who act in good faith, avoid privacy violations, avoid service
disruption, and give us reasonable time to fix the issue before disclosure.

## Scope

In scope:

- The code in this repository (`icrefin/dsh-mcp-mgr`), including the browser
  bundle, the Loader patch row (`cordis.patch.yml`), and the CI workflows.
- The path boundary. The plugin writes two hand-editable JSON files
  (`<profile>/.dsh/dshmm/mcp-servers.json` and
  `<workspace>/.dsh/dshmm/mcp.json`). A way to make it write outside those paths,
  follow a symlink out of the profile or the workspace, or drop an unrelated key
  from either file, is a vulnerability.
- The `mcpMgr` Remote surface: a way to make a method serve another profile's or
  another workspace's data, or to change a server the caller did not name, is a
  vulnerability.
- The credential boundary. Entries may carry `headers` and `env` values and may
  reference `${VAR}`; the panel shows the stored entry so its owner can edit it,
  which is intended. A way to make those values reach a different session, a
  different profile's snapshot, or the log is a vulnerability.
- The plugin's failure faces: a way to make a failure render as a healthy server,
  or to hide the reason from the user, is a vulnerability.

Out of scope:

- Vulnerabilities in third-party dependencies — report those upstream; tell us only
  if this project becomes exploitable as a result.
- The behaviour of `@deepseek-ai/dsh-mcp-client` and of DeepSeek Harness itself.
  This plugin writes the JSON those packages read and registers servers through
  them; a defect in the client, the mount path, or the host RPC belongs to those
  projects.
- A server that is slow, unreachable, or hostile. A row's status reflects what the
  tool registry shows, and a server's own behaviour is its operator's problem.
- Anything that requires server credentials to be exposed in the first place, or a
  modification to the host configuration.
- Social engineering, physical access, and volume-based denial of service.
- Issues that require an already-compromised machine or a modified local build.
- Anything on a host you do not own or have written permission to test.

Note that this plugin opens no port and serves no route of its own: it reads and
writes the two JSON files under the profile and the workspace, and registers
servers through `mcp-client`. Any network traffic is a server process, or the MCP
client acting on a definition the user wrote.

## Safe harbor

If you follow this policy, we consider your research authorized, will work with you to
understand and fix the issue, and will not recommend or support legal action against you.

## Handling secrets in reports

Redact tokens, keys, and personal data. Use placeholders such as `192.0.2.10`,
`<YOUR_EMAIL>`, and `<YOUR_API_KEY>` when an example is needed — and the same
applies to a screenshot of the panel, which can show real server names, URLs,
`headers`, and local paths. If a live credential must be shown, tell us first and
rotate it immediately afterwards.

---

# 安全策略

## 支持的版本

只有下表中的版本会收到安全修复。更早的版本按“现状”提供 —— 报告前请先升级到受支持的分支。

| 版本 | 是否支持 | 说明 |
| --- | --- | --- |
| `main`（最新提交） | :white_check_mark: | 活跃开发 |
| 最新的发布标签 | :white_check_mark: | 可行时会回合修复 |
| 更早的发布标签 | :x: | 请升级到最新发布版 |
| 分支（fork）与改动过的副本 | :x: | 请向该分支的维护者报告 |

## 报告漏洞

**请勿为安全问题开公开 issue、discussion 或 pull request。**
公开报告会在修复发布之前就暴露给所有用户。

请通过 **GitHub Security Advisories** 私下报告：
`https://github.com/icrefin/dsh-mcp-mgr/security/advisories/new`
（仓库 → *Security* → *Advisories* → *Report a vulnerability*）。报告保持私密，
同时给我们一个私有分支用于准备修复。

报告中请包含：

- 受影响的版本或 commit，以及你运行的 dsh 版本与所属部署。
- 涉及哪些 MCP 服务器定义、来自两个文件中的哪一个、当时打开的是哪个标签页；
  URL、请求头与 `env` 值请隐去。
- 最小可复现样例（PoC、代码或测试用例）。
- 影响评估：攻击者能获得什么，前置条件是什么。
- 你已知的修复或缓解方式。
- 是否打算公开，以及你希望使用的署名。

## 我们的承诺

| 阶段 | 目标 |
| --- | --- |
| 确认收到 | 3 个工作日 |
| 初步评估与严重性定级 | 10 个工作日 |
| 修复或书面缓解方案 | 高危/严重 30 天内，其余尽力而为 |
| 公开披露 | 与你协商，且在修复可用之后 |

除你要求匿名外，我们会在公告中署名致谢。对于善意研究 —— 不侵犯隐私、不中断服务、
并在披露前给我们合理的修复时间 —— 我们不会采取法律行动。

## 范围

在范围内：

- 本仓库（`icrefin/dsh-mcp-mgr`）的代码，包括浏览器 bundle、
  Loader 补丁行（`cordis.patch.yml`）与 CI 工作流。
- 路径边界。插件只会写两个可手改的 JSON 文件
  （`<profile>/.dsh/dshmm/mcp-servers.json` 与 `<workspace>/.dsh/dshmm/mcp.json`）。
  若能让它写到这两个路径之外、跟随符号链接跑出 profile 或工作区，或从任一文件中丢掉
  无关的键，都算漏洞。
- `mcpMgr` Remote 接口：若能让某个方法返回别的 profile 或别的工作区的数据，
  或改动调用方没有指定的服务器，都算漏洞。
- 凭据边界。条目可能带 `headers` 与 `env`，也可能引用 `${VAR}`；面板会显示存储的条目
  以便所有者编辑，这是有意为之。若能让这些值流入别的会话、别的 profile 的快照或日志，
  都算漏洞。
- 插件的失败界面：若能让失败显示成服务器状态正常，或让用户看不到失败原因，都算漏洞。

不在范围内：

- 第三方依赖自身的漏洞 —— 请报告给上游；仅当本项目因此变得可被利用时再告知我们。
- `@deepseek-ai/dsh-mcp-client` 与 DeepSeek Harness 自身的行为。本插件写的是那些包
  读取的 JSON，并通过它们注册服务器；客户端、挂载路径或宿主 RPC 的缺陷属于那些项目。
- 服务器本身慢、不可达或带恶意。行状态反映的是工具注册表的实际情况，
  服务器自身的行为由其运营者负责。
- 任何以服务器凭据本就已泄露为前提的问题，或需要改动宿主配置的问题。
- 社会工程、物理访问，以及靠流量压垮服务的拒绝服务。
- 需要已失陷主机或被改动的本地构建才能成立的问题。
- 任何你并不拥有、也没有书面授权测试的主机。

请注意：本插件不开端口，也不提供任何路由 —— 它只读写 profile 与工作区下的那两个
JSON 文件，并通过 `mcp-client` 注册服务器。任何网络流量都来自服务器进程，
或来自 MCP 客户端按用户自己写的定义发起的连接。

## 安全港

只要你遵循本策略，我们视你的研究为已授权，会与你一起理解并修复问题，
并且不会建议或支持对你采取法律行动。

## 报告中的密钥处理

请隐去令牌、密钥与个人信息。需要示例时请使用 `192.0.2.10`、`<YOUR_EMAIL>`、
`<YOUR_API_KEY>` 这类占位符 —— 面板截图同理，它可能带着真实的服务器名称、URL、
`headers` 与本地路径。若必须展示有效凭据，请先告知我们，并在其后立即轮换。
