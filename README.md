# AgentPlatform

面向公众的 AI 能力管理、分发与使用平台，让用户在统一入口发现、连接和使用 MCP 工具与 A2A Agent，让个人开发者与团队发布、分享专业能力。

## 当前状态

项目已通过 M1 可控环境技术验收。前后端骨架、平台身份、个人能力查询和组件验证页可运行；协议、远端 OAuth、队列和真实模型的验证结果见 [开发计划](docs/plan.md)。下列能力为首版建设目标，完整接入与执行闭环正在建设。

## 计划提供的能力

| 入口 | 用途 |
|---|---|
| Capability Hub · 我的能力 | 添加或安装能力，管理个人 OAuth 连接，直接测试工具与 Agent，查看调用记录 |
| Capability Market · 能力市场 | 发现、发布、审核、分享与安装能力 |
| AI Playground · AI 工作台 | 通过自然语言使用已启用且获授权的能力，完成 MCP 工具调用与 A2A 任务委托 |

首版围绕“添加或发现能力 → 安装与授权 → 直接测试或 AI 调用 → 查看真实结果”构建闭环，支持在同一对话中先调用 MCP，再将结果交给 A2A Agent。

平台按用户隔离服务连接，保存用户的远端服务 OAuth 令牌，分别校验服务授权与执行确认。发布者维护远端服务，平台负责能力管理、分发与受控调用。

## 项目文档

- 产品目标、首版范围与用户验收见 [产品定义](docs/product.md)。
- 模块职责、关键技术方案与安全边界见 [架构决策](docs/architecture.md)。
- 当前进度、里程碑与待准备资源见 [开发计划](docs/plan.md)。
- 开发协作与最小必要文档原则见 [AGENTS.md](AGENTS.md)。

## 参与开发

需要 Node.js 24 LTS、pnpm 10.33.0 和可用的 Docker。首次在仓库根目录运行：

```powershell
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:start
pnpm db:migrate
pnpm dev
```

打开 [本地网站](http://127.0.0.1:5173)，API 健康检查为 `http://127.0.0.1:3000/health`。`setup:local` 在 `apps/server/.env` 生成随机本地凭证，已有配置会保留；配置结构见 `apps/server/.env.example`。数据库仅绑定回环地址，持久数据保存在 Docker 卷中。

首个管理员通过环境变量 `ADMIN_EMAIL`、`ADMIN_NAME`、`ADMIN_PASSWORD` 提供资料后，运行 `pnpm admin:create`。密码至少 12 位，通过本地环境或密钥管理器传入，不写进仓库；平台已有用户时此初始化命令拒绝执行。

开发模式下的 [组件验证页](http://127.0.0.1:5173/lab) 提供示例 Schema 表单与对话组件。表单只回显参数；对话真实模型和 Hub 执行接线就绪前，接口明确返回不可用。浏览器自动化测试使用独立的可控响应。

```powershell
pnpm typecheck
pnpm test
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

集成测试通过 Testcontainers 创建临时 PostgreSQL 容器，不使用本地开发数据库。数据库结构修改后运行 `pnpm db:generate`，检查迁移再运行 `pnpm db:migrate`。`pnpm db:stop` 停止本地数据库并保留数据。

### 真实模型冒烟测试

在 `apps/server/.env.model.local`（Git 忽略）或服务端进程环境中设置 `AEC_MODEL_BASE_URL`、`AEC_MODEL_API_KEY`、`AEC_MODEL_ID`。模型须支持 OpenAI 兼容的 Chat Completions 工具调用。运行：

```powershell
pnpm --filter server test:model:live
```

命令会消耗模型额度，只发送合成文本，通过两个本机独立 HTTP 测试服务验证 MCP → A2A 的实际调用及最终回答。模型密钥只发送给所配置的模型接口。

`pnpm mcp:inspect` 按固定版本启动官方 MCP Inspector，用于独立协议联调。生成骨架和复用组件的许可证声明见 [第三方源码声明](THIRD_PARTY_NOTICES.md)。

项目主要由 AI Agent 开发。开始修改前请阅读项目文档与协作规则，结合当前里程碑选择工作。欢迎通过 Issue 讨论需求与问题，通过 Pull Request 提交改进。

## 许可证

本项目采用 [MIT License](LICENSE)。
