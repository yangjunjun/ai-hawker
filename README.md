# AI 智能叫卖助手 · v0.2.0

输入商品、价格和卖点，生成三种可编辑的中文叫卖文案，再试听、循环播放或下载音频。零框架 HTML/CSS/JavaScript + 原生 Node HTTP；无需数据库。

## 立即体验

- [GitHub Pages 静态演示](https://yangjunjun.github.io/ai-hawker/)：本地模板 + 浏览器系统语音，无需 API Key。
- 直接打开 `public/index.html` 也可使用模板、编辑和系统语音。系统语音取决于浏览器/操作系统，不支持导出音频。
- 本地完整服务（Node >=20.11，建议 Node 22 LTS）：

```bash
npm ci
npm start
```

打开 http://localhost:3000 。默认 `TEXT_PROVIDER=template`、`TTS_PROVIDER=edge`，保持 v0.1 的使用方式，无需 Key。Edge 在线合成可试听、循环播放、下载 MP3；失败时试听回退到系统语音，下载明确报错。

## 启用 MiMo

```bash
cp .env.example .env
# 编辑 .env，填入自己的 MIMO_API_KEY 并配置供应商
npm run start:env
```

Windows PowerShell 可用 `Copy-Item .env.example .env`。普通 `npm start` **不会自动加载 `.env`**；生产环境可以直接注入环境变量。不要把 Key 提交到仓库、放进 `public/` 或浏览器存储。

先启用 MiMo 文案，保留 Edge 配音：

```dotenv
TEXT_PROVIDER=mimo
TTS_PROVIDER=edge
MIMO_API_KEY=你的服务端密钥
```

文案和语音都用 MiMo：

```dotenv
TEXT_PROVIDER=mimo
TTS_PROVIDER=mimo
MIMO_API_KEY=你的服务端密钥
```

修改配置后重启服务。前端自动读取可用能力，没有供应商密钥输入框。

| 能力 | 本地 / 浏览器 | Edge | MiMo |
| --- | --- | --- | --- |
| 文案 | 固定三种模板 | — | 三种风格 AI 文案，可编辑 |
| 配音 | 系统语音，不能导出 | 六种原有声音预设 | 苏打、白桦、冰糖、茉莉 |
| 下载 | 不支持 | MP3 | WAV |
| 数值语速 | 浏览器近似调节 | -30%～+30% | 当前禁用，使用正常语速 |

MiMo 首版使用非流式 WAV，不声称支持直接 MP3，不做转码、音色设计、克隆或方言效果保证。Edge 的“东北热情大哥”是普通话男声加东北风格文案，非真实方言；原辽宁/陕西音色仅属于 Edge。AI 文案要求保留商品和价格，但仍须人工核对事实，避免虚假宣传。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `TEXT_PROVIDER` | `template` | `template` / `mimo`，前者由浏览器生成 |
| `TTS_PROVIDER` | `edge` | `edge` / `mimo` |
| `MIMO_API_KEY` | 空 | 仅服务端持有；缺失时对应能力关闭 |
| `MIMO_BASE_URL` | `https://api.xiaomimimo.com/v1` | HTTPS 基地址；不允许 URL 中的认证、查询参数和片段 |
| `MIMO_TEXT_MODEL` | `mimo-v2.6-flash` | 需支持 Chat Completions JSON-object 输出 |
| `MIMO_TTS_MODEL` | `mimo-v2.5-tts` | 仅实现预置音色合成协议，不可改成 voiceclone/voicedesign |
| `TEXT_TIMEOUT_MS` | `20000` | 100～120000 毫秒 |
| `TTS_TIMEOUT_MS` | `45000` | 100～120000 毫秒 |
| `AI_MAX_CONCURRENT` | `4` | 单进程同时生成上限，1～16 |
| `AI_REQUESTS_PER_MINUTE` | `30` | 单进程生成接口总请求上限，1～1000 |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | 默认只监听本机 |
| `TTS_PROXY` | 空 | 只用于 Edge，如 `http://127.0.0.1:7890`；不作用于 MiMo |
| `ALLOWED_ORIGINS` | 空 | 跨域网页的精确 Origin，用逗号分隔；不能写路径、`*` 或 `null` |

当前 MiMo 适配器直接使用 Node fetch，没有专用代理选项；部署环境需要能访问配置的 MiMo 地址。未知供应商和无效配置会使启动失败。账号支持的模型、Key 与 Base URL 配对、套餐及额度须在 MiMo 控制台确认。

## 前端与后端部署

推荐完整服务同源部署：Node 位于反向代理后面，由 HTTPS 网关提供访问控制。默认不改变本地体验。

GitHub Pages 只部署 `public/`，不会运行 `server.mjs`。每次推送到 `main` 会先执行检查，再部署静态资源；首次启用需将仓库 Pages Source 设为 GitHub Actions。

需要 Pages 连接独立后端时，仅修改公开文件 `public/config.js`：

```js
window.HAWKER_CONFIG = { apiBaseUrl: 'https://你的后端域名' };
```

后端配置：

```dotenv
ALLOWED_ORIGINS=https://yangjunjun.github.io
```

公开配置只包含地址，不能包含 Key。显式 API 地址优先；未配置时 `.github.io` 和 `file://` 保持静态模式，其他 HTTP(S) 站点尝试同源 API。自定义静态域名没有 API 时会保留模板和系统语音。`file://` 的 `null` Origin 默认不放行，完整体验请通过本地 Node 打开。

**收费 API 不应直接裸露到公网。** CORS 只限制浏览器读取，不能防止 curl 等客户端调用。单进程限流/并发限制不是身份认证，也不是跨实例额度系统。开放公网前需在部署网关配置认证、用户额度和总预算限制；跨域网关的身份认证方式需另行接入，当前前端不发送跨域会话凭据。最小可用路径是本地或受保护的同源部署。

## API 与扩展

- `GET /api/health`：`{ok:true}`，只表示进程存活。
- `GET /api/capabilities`：返回分别配置的文案/配音能力、音色、音频格式、语速模式；不包含 Key，也不发起上游调用。`enabled` 表示已配置，不能保证账户额度或网络正常。
- `POST /api/scripts`：`{product,price,sellingPoint}`，返回 `{provider,model,scripts:[{style,text}]}`。风格固定为 `enthusiastic`、`playful`、`concise`；每条非空、不超过350字符并包含原商品、原价格。输入限制：商品60、价格60、卖点200字符。
- `POST /api/tts`：`{text,voice,rate}`，返回真实音频二进制。兼容旧 Edge voice ID；MiMo 用能力接口提供的 voice ID，rate 必须省略或为0。文字上限350字符。`?download=1` 设置附件响应头。
- 错误：`{error,code,retryable,requestId}`。400/413 参数错误，429 限流，503 服务配置不可用，504 超时，502 上游异常。保留旧版 `error` 字符串；不自动重试收费生成。

`lib/ai/index.mjs` 是适配注册与缓存入口；新增供应商时实现 `generateScripts(input,{signal})` 或 `synthesizeSpeech(input,{signal})`，再注册配置、能力及契约测试。前端不提交任意上游地址或模型。音频按供应商、模型、文本、音色、语速、格式及风格版本缓存/去重，最多40项、总32 MiB、单音频8 MiB。取消试听会停止等待和播放；已开始的共享 TTS 可能继续到完成或超时，取消并不保证免计费。

文案失败保留当前编辑，并提供“使用本地模板”；生成期间修改输入或文案会取消旧请求。试听失败提示后使用系统语音；下载失败不会伪造文件。

## 验证

```bash
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

17项 Node 测试覆盖协议、校验、限流、超时、取消、缓存/去重、CORS和错误脱敏；浏览器测试覆盖静态、Node、Pages、MiMo、下载、失败回退、取消和移动布局。测试使用模拟上游和模拟播放，**不证明真实 MiMo/Edge 服务可用或配音质量达标**。CI 在 Node 20/22 检查，Chromium 回归不使用供应商密钥。

真实接入验收：配置服务端 Key，分别生成三条文案、用预置音色合成并试听/下载 WAV，核对价格发音、响应时间、账户限额及错误提示；再验证 Edge MP3。如需要方言、精确语速或 MP3 转码，先确认能力和效果再扩展。当前 Issue #1 保留 open 等待真实 API 验收。

- [需求与实现计划](docs/issue-1-plan.md)
- [MiMo Quick Start](https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call)
- [MiMo 语音合成](https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/speech-synthesis-v2.5)
- [MiMo 结构化输出](https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/text-generation/structured-output)

Edge 使用第三方非正式接口，依赖网络且可用性可能变化。正式商用需核实供应商授权、服务条款、额度和当地商业噪声要求。
