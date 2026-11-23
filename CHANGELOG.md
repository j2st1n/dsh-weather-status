# Changelog — dsh-weather-status

> 包名为 `dsh-weather-status`，仓库目录名为 `dsh-weather`。
> 本文件于 2026-11-22 依据 git 提交历史回溯建立，早期条目只能依据提交信息还原，故较简略。

## [0.1.5] - 2026-11-23

### Added
- **侧栏触发器新增 220ms 延迟悬停预览卡片**：与 `dsh-link-pulse` / `dsh-cpa-status` 同一节奏，停留 220ms 后弹出只读卡片，移出立即收起；主面板打开（含关闭退场动画）期间不显示，卡片显示时移除触发器的原生 `title` 以免浮层叠加。内容分三块：① 当前体感与环境——天气图标、城市、天气文案、当前温度与「体感」、湿度/风速/降水；② 未来 6 小时逐小时趋势；③ 未来 3 天预报（星期、天气、最低/最高温）。数据只读 store 缓存，不触发刷新，无缓存时不出卡片。
- 卡片定位按触发器上下可用空间自动翻转：上方空间不足时翻到触发器下方，`maxHeight` 取 `min(220px, 可用空间)` 且不低于 96px，超出改为内部滚动；折叠 rail 用 `position: fixed` + 实测触发器矩形定位，宽 264px（极端窄视口下夹到 200px 并收在视口内），绕开侧栏列 `overflow: hidden`；展开态保持触发器上方 `absolute` 定位。
- 卡片为纯预览（`pointer-events: none`），不吃指针事件、不挡住下方会话区。
- 自动化验证测试补充悬停卡片的布局、内容与模式切换用例（28 项全绿）。

## [0.1.4] - 2026-11-23

### Changed
- 包元数据：`author` 不再公开邮箱，只保留 `j2st1n`（npm 0.1.3 的 author 邮箱无法原地修改，以本版本修正）。代码与接口无改动。

## [0.1.3] - 2026-11-22

### Fixed
- **补上四条接口的来源围栏**：`/api/weather/current`、`/api/weather/cities`、`/api/weather/health`、`/api/weather/ip` 原先以 `kind: 'exact'` 直接注册在 webServer 上，会绕过 DSH 对 `/api` 前缀通道的准入校验（Host / Origin / `Sec-Fetch-Site`），导致伪造 Host（DNS rebinding）、跨站请求与不匹配 Origin 都能读到天气数据与 IP 定位结果。现在四条路由均按 `{ fencedRead: true }` 接入宿主等价的只读围栏：Host 必须是环回、监听器 bind 地址或 `connection.trustedHosts` 之一，拒绝 `Sec-Fetch-Site: cross-site`，带 Origin 时必须同 authority；宿主提供 `connection.isTrusted` 时以其判定为准，缺失时回退本地等价实现。不可信来源一律返回 403，不再返回 200。
- 围栏只读取请求头、不改写请求对象，校验通过后原样透传给处理器，因此 `/api/weather/ip` 依赖的 `x-forwarded-for` / `x-real-ip` 首值语义保持不变；伪造来源时连定位探测都不会触发。

### Added
- 测试补齐来源围栏用例：四条路由逐一验证伪造 Host 得 403、环回放行 200，并覆盖 bind 地址、`connection.trustedHosts` 与 `connection.isTrusted` 优先级。

## [0.1.2] - 2026-09-08

### Added
- 新增 `GET /api/weather/ip` 接口，多通道级联定位（ip-api、ip.sb、ipwho.is），带 1 小时内存缓存。
- 新增自动化验证测试，覆盖全部新功能与边界情况（当时 15 项通过）。

### Changed
- 重构客户端 IP 探测顺序：优先本地服务代理，其次直连 anycast 通道，最后按时区智能回退。
- 定位回退到北京。

### Fixed
- 24 小时预报时间对齐改用本地时区偏移，不再按 UTC 零偏移计算。
- 昼夜图标改用真实小时与 Open-Meteo 的 `is_day` 字段判断。

## [0.1.1] - 2026-09-07

### Changed
- 版本号提升至 0.1.1，并精简 README。

## [0.1.0] - 2026-09-07

### Added
- 初始提交，建立 dsh-weather-status 插件。
