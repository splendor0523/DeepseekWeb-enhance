# DS Enhance · Sidebar Edition

**DeepSeek 网页端侧边栏分类增强版**

> 基于 [calendar0917/DeepseekWeb-enhance](https://github.com/calendar0917/DeepseekWeb-enhance) 的社区 Fork，在原有对话管理功能上增加可折叠的侧边栏项目分类。

本仓库由 **splendor0523** 在原项目基础上进行修改和维护。感谢原作者 **calendar0917** 开源 DS Enhance 及 DS MCP Bridge。

**本项目是非官方修改版本，不代表原作者维护、支持或认可本版本。** 原项目的功能与技术成果仍归属于相应的原作者及贡献者；本分支仅对自己的新增和修改部分作出说明。

- **原项目**：[calendar0917/DeepseekWeb-enhance](https://github.com/calendar0917/DeepseekWeb-enhance)
- **本分支**：[splendor0523/DeepseekWeb-enhance](https://github.com/splendor0523/DeepseekWeb-enhance)
- **开源协议**：[GPL-3.0](./LICENSE)

## 本分支新增：侧边栏项目分类

原版 DS Enhance 已提供会话分类管理，但主要通过独立的增强面板操作。本分支在其基础上，为 **DeepSeek 网页端原有侧边栏** 增加可展开、可收起的「项目分类」区域，使分类后的对话可以直接从侧边栏访问。

| 新增能力 | 说明 |
| --- | --- |
| 侧边栏分类展示 | 在 DeepSeek 侧边栏内展示已有项目分类及分类下的对话 |
| 分类展开 / 收起 | 点击分类名称展开或折叠对话列表，展开状态保存在浏览器本地 |
| 分类对话跳转 | 点击分类下的对话，可直接打开对应会话 |
| 当前会话归类 | 右键分类，选择「将当前对话加入此分类」 |
| 分类重命名 | 通过分类右键菜单修改分类名称 |
| 分类删除 | 删除分类及其关联关系，**不会删除 DeepSeek 对话本身** |
| 与原版数据兼容 | 继续使用原有的 `localStorage.dse_categories` 分类数据结构 |
| 页面动态适配 | 在侧边栏 DOM 更新后尝试重新挂载分类区域，并刷新展示 |

### 基本使用

1. 安装本分支的 `ds-enhance.user.js`，打开并登录 [DeepSeek 网页版](https://chat.deepseek.com)。
2. 在侧边栏找到「项目分类」区域；如尚无分类，可通过区域内的管理入口打开原 DS Enhance 分类面板，新建分类。
3. 打开任意对话，右键对应分类，将当前对话加入分类；点击分类名称即可展开或收起会话列表。

### 功能截图

<img width="1910" height="883" alt="ScreenShot_2026-10-19_132733_462" src="https://github.com/user-attachments/assets/ff9fea12-fe91-449a-89e1-9fed825bc581" />

### 数据与兼容性说明

- 分类及对话关联数据保存在当前浏览器的 `localStorage` 中，不是 DeepSeek 官方账户的云端分类功能。
- 清除网站数据、切换浏览器或浏览器环境，可能导致本地分类丢失。建议利用原版分类面板的「导出分类数据」功能定期备份。
- 侧边栏模块依赖 DeepSeek 当前网页结构，站点改版后可能需要更新适配逻辑。
- 本分支与原版脚本功能重叠，**请勿同时启用两个 `ds-enhance.user.js` 实例**，以免重复挂载界面或产生冲突。
- 本功能来自本分支的修改，不是 DeepSeek 官方功能，也不是原作者已发布的原版功能。

---

## 项目概览

本仓库沿用原项目「两个独立脚本、共享基础设施」的结构。**本次修改主要针对 DS Enhance 对话管理脚本；DS MCP Bridge 的功能说明沿用原项目。**

| 脚本 | 定位 | 面板按钮颜色 | 本分支状态 |
| --- | --- | --- | --- |
| [**ds-enhance**](./ds-enhance.user.js) | 对话批量管理、Fork、分类、搜索、导出、重命名、提示词管理 | 蓝色 | **新增侧边栏项目分类** |
| [**ds-mcp-bridge**](./ds-mcp-bridge.user.js) | MCP 工具调用、TTS 朗读、多站点适配（DeepSeek / ChatGPT） | 绿色 | 沿用原项目功能 |

## 安装方法

### 1. 安装 DS Enhance（含本分支的侧边栏分类功能）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展。
2. 打开本仓库的 [`ds-enhance.user.js`](./ds-enhance.user.js)，复制完整脚本。
3. 在 Tampermonkey 中新建用户脚本，粘贴代码并保存。
4. 如已经安装原版 DS Enhance，请先禁用旧版本，避免重复运行。
5. 打开或刷新 [chat.deepseek.com](https://chat.deepseek.com)，使用左侧栏新增的「项目分类」区域或蓝色悬浮按钮。

**快捷键：** `Ctrl+Shift+D` 切换 DS Enhance 面板。

### 2. 安装 DS MCP Bridge（可选）

如果还需要 MCP 工具调用或 TTS 朗读，可按下文 **DS MCP Bridge** 的说明独立安装 `ds-mcp-bridge.user.js` 并启动本地服务。仅使用侧边栏分类功能时不需要安装 MCP Bridge。

---

## DS Enhance — 原项目对话管理功能

下表是 **原作者 DS Enhance 已有的功能**，并非本分支新增。

| 功能 | 说明 |
| --- | --- |
| **批量删除** | 勾选多个对话一键删除，支持清空全部 |
| **Fork 对话** | 完整复制对话，或从指定消息节点开始分支 |
| **会话分类** | 创建自定义标签，为对话分类；本地存储，支持导入 / 导出 |
| **搜索** | 按标题实时搜索对话历史 |
| **导出** | 导出对话为 JSON 或 Markdown 文件 |
| **批量重命名** | 直接重命名、添加前缀 / 后缀、查找替换、序号命名 |
| **提示词管理** | 保存并选择多条自定义提示词，按脚本逻辑注入请求 |

**原项目界面截图（展示原版功能，非本分支侧边栏新增界面）：**

<img width="1102" height="662" alt="原项目 DS Enhance 面板截图" src="https://github.com/user-attachments/assets/371ae615-d054-47f5-a7de-b2d8d9b696c4" />

<img width="1080" height="608" alt="原项目 DS Enhance 功能截图" src="https://github.com/user-attachments/assets/8a4f1eb3-b3fb-4ced-b613-d0d001d41625" />

### 技术原理（原项目）

原版通过 Bearer Token（从 `localStorage.userToken` 读取）调用 DeepSeek 网页端内部 API：

- `POST /api/v0/chat_session/delete` — 删除对话
- `POST /api/v0/chat_session/update_title` — 重命名
- `GET /api/v0/chat_session/fetch_page` — 获取对话列表
- `GET /api/v0/chat/history_messages` — 获取消息历史
- `POST /api/v0/share/create` + `POST /api/v0/share/fork` — Fork 对话

这些接口属于 DeepSeek 网页端使用的内部接口，可能变更；请勿将本项目视为官方 API 客户端。

**本分支的实现补充：** 侧边栏模块在页面中挂载分类列表，读取并更新原版使用的 `dse_categories` 本地数据；分类展开状态和部分对话标题缓存另外保存在本地。它不会把分类功能变成 DeepSeek 官方服务端功能。

---

## DS MCP Bridge — MCP 工具调用 + TTS 朗读（原项目）

> 本节沿用原作者项目的功能介绍，不属于本次侧边栏分类改动。

让 AI Chat 具备调用本地工具的能力（执行 Shell 命令、读写文件、网络搜索等），并支持 TTS 语音朗读。

### 支持站点

| 站点 | 原项目说明 |
| --- | --- |
| [chat.deepseek.com](https://chat.deepseek.com) | 完整支持 |

### 架构

```text
DeepSeek Chat（浏览器）
    ↓ SSE 流被油猴脚本拦截
    ↓ 检测到工具调用指令（mcp:tool_name）
    ↓
MCP Server（localhost:8024）   ← 本地 Python 服务
    ↓ JSON-RPC 2.0
工具执行 → 结果返回 → 注入对话
```

### 安装

1. 安装油猴脚本 [`ds-mcp-bridge.user.js`](./ds-mcp-bridge.user.js)（安装方式同上）。
2. 启动本地 MCP 服务器：

```bash
cd server
pip install -r requirements.txt
python server.py
```

3. 在 DeepSeek 页面点击绿色齿轮按钮，确认连接状态为「已连接」。

**快捷键：** `Ctrl+Shift+M` 切换面板。

### 面板功能

| Tab | 说明 |
| --- | --- |
| **状态** | 连接状态、已注册工具列表，支持重试 / 刷新 |
| **测试** | 选择工具 → 显示参数表单 → 执行 → 查看结果 |
| **MCP 服务器** | 预设工具市场、外部 MCP 服务器管理 |
| **设置** | MCP 地址、模块开关、TTS 配置（引擎 / 语音 / 自动朗读） |

### 内置工具

| 工具 | 说明 |
| --- | --- |
| `execute_command` | 执行 Shell 命令 |
| `get_cwd` | 获取当前工作目录 |
| `list_directory` | 列出目录内容 |
| `read_file` | 读取文件 |
| `write_file` | 写入文件 |
| `bing_search` | Bing 搜索（需配置 API Key） |
| `crawl_webpage` | 抓取网页内容 |

### 外部 MCP 服务器

除了内置工具，还可以接入外部 MCP 服务器。在 `server/mcp.json` 的 `mcpServers` 中配置，例如：

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/docs"]
    },
    "my-remote": {
      "url": "http://192.168.1.100:3000/mcp"
    }
  }
}
```

支持两种传输方式：

| 传输方式 | 配置字段 | 说明 |
| --- | --- | --- |
| **stdio** | `command` + `args` + `env` | 启动子进程，通过 stdin/stdout 通信 |
| **HTTP** | `url` + `headers` | 连接远程 MCP 服务器（支持 SSE） |

外部服务器的工具会合并到工具列表中供调用。

### 百智工具包预设

在 **MCP 服务器 → 工具预设** 中选择 **百智工具包（Baizhi MCP）**，填写自己的 API Key，再点击 **安装**。选择卡片只打开配置表单；安装后连接 `https://agent-toolkit.app.baizhi.cloud/mcp`，通过 `Authorization: Bearer <API Key>` 鉴权。只填写 Key 本身，不要重复添加 `Bearer `。

百智托管服务需要独立账号和额度，调用可能产生费用；使用前查看[服务与账号说明](https://baizhi.cloud/landing/agent-toolkit)。本项目的 GPL-3.0 许可证不覆盖托管后端或其服务条款。工具调用参数会发送给百智；返回结果会按现有桥接逻辑注入所选站点对话，可能进一步发送给 DeepSeek 或所选聊天服务。可用工具、参数和权限由连接时的服务目录及账号决定，预设不固定工具名或承诺结果。

- Key 输入框以密码形式显示，但安装后的 Header 会明文保存在 `server/mcp.json`。不要共享该文件，或将 Key 放入 Git、聊天、日志或截图。
- 现有 HTTP Header 会展开服务器进程中的 `$VAR` / `${VAR}`；未定义变量可能原样发送，不保证缺失环境变量时阻止连接。
- 点击 **停止** 只影响当前进程，配置仍保留；重启本地服务器会重新连接。要持久移除，请在已安装列表中 **删除**。停止或删除不代表远端任务取消、费用停止或 Key 撤销，撤销应通过服务账号完成。
- 原项目 README 注明：百智部分仅验证过本地合成 HTTP 流程，未验证真实百智调用、费用、浏览器界面或 ChatGPT 适配。

### 工具调用方式

在对话中让 DeepSeek 输出特定格式以触发工具调用，例如：

````text
请帮我执行以下工具：
```mcp:execute_command
{"command": "ls -la"}
```
````

或开启「自动执行」模式后，直接用自然语言描述需求，由 DeepSeek 决定调用哪个工具。

### TTS 朗读

AI 回复旁显示朗读按钮，支持手动朗读和自动朗读。

| TTS 引擎 | 说明 | 配置 |
| --- | --- | --- |
| **Edge TTS** | 免费，无需 API Key，中文质量好 | 直接可用 |
| **OpenAI 兼容** | 支持 OpenAI、SiliconFlow 等兼容 API | 需配置 API Key / Base URL / 模型 |
| **自定义 HTTP** | 接入自定义 TTS API | 需配置 URL / 请求模板 |

原项目设置页支持按语言、性别筛选语音，内置 21 个常用语音，连通 server 后可加载更多语音。

### 模块开关

| 模块 | 说明 |
| --- | --- |
| **MCP 工具调用** | 拦截 AI 回复并执行本地工具 |
| **TTS 朗读** | 显示朗读按钮 |
| **自动朗读** | AI 回复完成后自动播放（等待文本稳定后触发） |

### 工具结果文件化

当 AI 调用 `read_file` 或 `list_directory` 时，工具结果可作为文件上下文自动注入下次对话请求，避免将过长文本直接放入聊天窗口。

---

## 项目结构

```text
DeepseekWeb-enhance/
├── ds-enhance.user.js          # 对话管理脚本：本分支新增侧边栏项目分类
├── ds-mcp-bridge.user.js       # MCP + TTS + 多站点适配：沿用原项目
├── shared/
│   └── shared-header.js        # 共享基础设施的参考源
├── server/                     # MCP 服务器端
│   ├── server.py
│   ├── requirements.txt
│   ├── mcp.json
│   └── tools/
│       ├── shell.py
│       ├── search.py
│       ├── mcp_external.py
│       ├── tts.py
│       └── file_processor.py
├── tests/                      # 原项目测试
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
└── LICENSE
```

## 开发与测试

- `shared/shared-header.js` 是共享基础设施的参考源，两个脚本各自内联所需部分。
- 修改 `ds-enhance.user.js` 后，可以在 Tampermonkey 中替换脚本、保存并刷新网页验证。
- 在仓库根目录可运行原项目提供的用户脚本语法检查与回归测试：

```bash
node --check ds-enhance.user.js
node --check ds-mcp-bridge.user.js
node --test tests/userscript-regressions.test.js
```

- `server/` 可以独立运行和测试：`python server.py` 启动后访问 `http://localhost:8024/health`。
- 更多贡献约定请查看原项目的 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## TODO

### 本分支：侧边栏分类

- [ ] 补充增强版实际使用截图或 GIF
- [ ] 进一步覆盖 DeepSeek 侧边栏结构变化的兼容性测试
- [ ] 为侧边栏分类交互补充自动化回归测试

### 原项目：DS Enhance

- [ ] Fork 选择起点时增加助手回复预览
- [ ] 搜索支持日期范围过滤
- [ ] 导出 Markdown 支持树形分支结构
- [ ] 批量操作失败重试机制

### 原项目：DS MCP Bridge

- [x] SSE 拦截（DeepSeek 原生 SSE 格式 + OpenAI 兼容格式）
- [x] 工具调用检测（正则 + flex match 双策略）
- [x] 工具调用结果自动注入对话
- [x] TTS 朗读（Edge / OpenAI 兼容 / 自定义 HTTP）
- [x] 自动朗读（文本稳定后自动播放）
- [x] 适配器架构（DeepSeek + ChatGPT 样板）
- [x] 模块开关（MCP / TTS / 自动朗读）
- [x] 工具结果文件化（`read_file` 结果自动注入上下文）
- [ ] 工具白名单 / 黑名单
- [x] 支持外部 MCP 服务器（stdio / HTTP 传输）
- [ ] 完善 ChatGPT 适配器选择器

## 开源协议与贡献说明

本仓库是 [calendar0917/DeepseekWeb-enhance](https://github.com/calendar0917/DeepseekWeb-enhance) 的衍生版本，继续遵循 **GNU General Public License v3.0（GPL-3.0）**。许可全文见 [LICENSE](./LICENSE)。

- 保留原项目的 Git 历史、许可证和上游项目链接。
- 新增侧边栏项目分类模块及相关修改由本分支维护者贡献；未修改的原有功能仍归属原项目及相关贡献者。
- 欢迎提出 Issue、建议或 Pull Request。希望对上游有帮助的改进也可考虑向原项目提交 PR。

## 致谢

**特别感谢 [calendar0917](https://github.com/calendar0917) 开源 [DeepseekWeb-enhance](https://github.com/calendar0917/DeepseekWeb-enhance)。** 本分支是在原项目已有的对话管理、分类存储及界面交互基础上完成的扩展。

以下保留原项目所列的参考来源：

- [MCP Bridge](https://github.com/WongJingGitt/mcp_bridge) — 原项目的 SSE 解析、请求拦截、工具注入等核心思路参考了 WongJingGitt 的 MCP Bridge 浏览器扩展。
- [吾爱破解 — DeepSeek 结合 MCP 让 AI 操控你的电脑](https://www.52pojie.cn/forum.php?mod=viewthread&tid=2087748&highlight=deepseek%2B%BD%C5%B1%BE) — 原项目参考帖子。

## 友情链接

- [Linuxdo](https://linux.do)
