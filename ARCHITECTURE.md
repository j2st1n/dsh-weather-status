# DSH 天气插件 (dsh-weather) 架构与技术设计方案

## 1. 概述与目标

### 1.1 背景与目标
在 DeepSeek Harness (DSH) 客户端中，为用户提供一个优雅、高效、轻量级的天气状态组件。
- **胶囊组件 (Capsule)**：无缝嵌入 DSH 左侧栏底部区域最上方（置顶于其他辅助插件上方），实时呈现用户所在城市、当前天气状况、气温。支持展开/收起（wide 展开模式与 rail 折叠图标模式自适应）。
- **天气详情卡片 (Detail Overlay)**：点击胶囊展开悬浮卡片，提供多维气象指标（体感温度、风速风向、相对湿度、降水概率）、未来 24 小时逐小时趋势与未来 5-7 天天气简报。
- **智能定位与城市切换 (Geocoding & Location)**：开箱支持基于 IP 的免授权自动定位；同时提供全球城市即搜即切换能力与持久化偏好记忆。
- **零外部运行时依赖与纯前端/Cordis 架构**：采用 ModuleLoader 纯 ESM、无庞大第三方包，符合 DSH 插件规范。

---

## 2. DSH 侧边栏槽位机制与排序设计

### 2.1 侧边栏布局层次与槽位拓扑
通过对 DSH 核心源码（`@deepseek-ai/dsh-client-ui-sidebar` 与 `@deepseek-ai/dsh-client-ui-renderer`）的深入分析，DSH 侧边栏组件 `SidebarRoot` 结构如下：

```text
SidebarRoot (左侧主容器)
├── brandArea (品牌区: sidebar.brand.mark, sidebar.brand.name)
├── newSessionArea (新会话按钮)
├── regionArea (工作区列表: sidebar.workspaces)
└── footArea (底部操作区)
    ├── footerActions (插件与工具席位: sidebar.footer.action)  <-- 本插件挂载点
    └── settingsArea (设置席位: sidebar.settings)
```

### 2.2 槽位排序机制 (`order` 算法解析)
在 `@deepseek-ai/dsh-client-ui-renderer` 的 `renderSlot` 实现中：
```javascript
const rows = host.entriesOfSlot(slotKey).map((entry) => ({
  entry,
  id: entry.options.id,
  order: entry.options.order ?? 0
}));
let list = [...rows].sort((a, b) => a.order - b.order);
```
- 容器 `footerActions` 的样式定义为垂直弹性布局：`flex-direction: column`。
- 排序依据为升序排序：`a.order - b.order`，即 **数值越小的项在垂直方向排在越上方**。
- DSH 现有插件的默认 order：
  - `dsh-link-pulse` 指定为 `order: -10`。
  - 未指定 order 的组件（如 cordis-panel）默认为 `0`。
  - `dsh-cpa-status` 指定为 `order: 10`。
  - `dsh-version-status`（版本状态插件）指定为 `order: 20`。
- **置顶决策**：
  - `dsh-weather` 注册 `sidebar.footer.action` 时指定 **`order: -100`**。
  - 这样排序结果为：`[-100 (dsh-weather), -10 (dsh-link-pulse), 0 (cordis-panel), 10 (cpa-status), 20 (dsh-version-status)]`。
  - 确保天气胶囊绝对居于所有插件最顶部，紧贴上方工作区分割线，视觉层级最为突出。

### 2.3 侧边栏宽窄状态响应 (Wide vs Rail)
DSH 侧边栏支持展开 (`wide: true`, 宽度约 240px) 和收起折叠 (`wide: false`, 宽度约 48px)。
`sidebar.footer.action` 槽位渲染时会向注册组件下发 `{ wide }` 属性：
- **`wide: true` (展开状态)**：
  - 展示完整胶囊视图（图标 + 城市名称 + 天气文字 + 实时温度 + 体感微标）。
  - 宽度 `100%`，高度 `28px`，圆角 `6px`，内边距 `4px 8px`，透明背景，`1px solid var(--dsw-alias-border-l1)` 边框，激活态为 `interactive-bg-hover`，字体 `12px`。
- **`wide: false` (收起状态 / Rail 模式)**：
  - 自动收缩为紧凑微型胶囊，尺寸 `28px × 28px`，圆角 `6px`。
  - 展示高辨识度天气 SVG 图标，鼠标悬浮显示带城市名称与气温的原生 tooltip。

### 2.4 详情浮层挂载点 (`shell.overlay`)
- 天气详情卡片通过 `shell.overlay` 槽位挂载到顶层 Shell 容器，脱离侧边栏 overflow 裁剪。
- 对齐官方规范采用左下向上弹出定位：`position: 'fixed', left: 12, bottom: 54, width: 380, borderRadius: 16, boxShadow: var(--dsw-shadow-lv3, ...)`，与其它官方插件弹窗完全一致。

---

## 3. 天气数据源与定位服务选型

### 3.1 核心选型对比表

| 指标 | Open-Meteo (选定方案) | 和风天气 (QWeather) | OpenWeatherMap |
|---|---|---|---|
| **API Key 需求** | **无需任何 Key (开箱即用)** | 必须注册并配置 Key | 必须注册并配置 Key |
| **免费调用额度** | **10,000 次/天** | 1,000 次/天 | 1,000 次/天 |
| **CORS 跨域支持** | **完全支持 (`Access-Control-Allow-Origin: *`)** | 限制 Domain / Proxy | 限制 |
| **数据覆盖维度** | 实时、逐小时、多天、空气质量、经纬度反查 | 实时、预报、生活指数 | 实时、预报 |
| **多语言与地理反查** | 全球 Geocoding API 支持中英文地名检索 | 专注国内地名 | 英语为主 |
| **商业/私有化许可** | CC-BY 4.0 开放数据 | 商业授权限制 | 商业收费高 |

### 3.2 Open-Meteo 接口规格
1. **天气预报查询 API**：
   - URL: `https://api.open-meteo.com/v1/forecast`
   - 查询参数：
     ```text
     latitude={lat}
     longitude={lon}
     current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m
     hourly=temperature_2m,weather_code,precipitation_probability
     daily=weather_code,temperature_2m_max,temperature_2m_min
     timezone=auto
     forecast_days=7
     ```
2. **城市地理编码检索 API (Geocoding)**：
   - URL: `https://geocoding-api.open-meteo.com/v1/search`
   - 查询参数：`name={keyword}&count=6&language=zh&format=json`
   - 返回包含：城市名、国家、省份/行政区、经度、纬度、时区。

### 3.3 IP 自动定位与容错降级链路
用户无需手动输入城市即可获得首屏天气。定位执行三级降级策略：
1. **首选定位：`https://ipwho.is/`**
   - 纯 HTTPS，响应极快（通常 <150ms），CORS 完全开放。
   - 返回结构包含 `city`, `latitude`, `longitude`, `country`。
2. **备选定位：`https://freeipapi.com/api/json/`**
   - 备用免 Key HTTPS IP 定位服务。
3. **兜底定位 (Fallback Defaults)**：
   - 若处于断网、离线开发或 IP 定位被安全策略拦截，自动采用预设默认城市：
     - 城市名：`北京` (Beijing)
     - 经纬度：`lat: 39.9042, lon: 116.4074`
   - 界面提供明显的“点击切换城市”指引，保证任何情况下 UI 不报错、不崩溃。

### 3.4 WMO 天气编码与中文语义及图标映射

| WMO 编码 | 中文描述 | 图标标识 | 主题色调建议 |
|---|---|---|---|
| `0` | 晴朗 (Clear sky) | `sun` (昼) / `moon` (夜) | 金黄 / 琥珀橙 `#f59e0b` |
| `1, 2` | 晴间多云 (Partly cloudy) | `cloud-sun` / `cloud-moon` | 暖灰浅蓝 `#38bdf8` |
| `3` | 阴天 (Overcast) | `cloud` | 中灰蓝 `#94a3b8` |
| `45, 48` | 雾 / 浓雾 (Fog) | `fog` | 灰淡银 `#a1a1aa` |
| `51, 53, 55` | 毛毛雨 (Drizzle) | `drizzle` | 青碧蓝 `#0ea5e9` |
| `61, 63` | 小雨 / 中雨 (Rain) | `rain` | 蔚蓝 `#0284c7` |
| `65` | 大暴雨 (Heavy rain) | `heavy-rain` | 深海蓝 `#2563eb` |
| `71, 73, 75` | 小雪 / 中雪 / 大雪 (Snow) | `snow` | 冰晶白蓝 `#e0f2fe` |
| `80, 81, 82` | 阵雨 (Showers) | `showers` | 亮蓝 `#0284c7` |
| `95, 96, 99` | 雷阵雨 / 雷暴 (Thunderstorm) | `thunderstorm` | 闪电紫 `#8b5cf6` |

---

## 4. 状态管理与多级缓存策略

为确保 DSH 侧边栏秒开且避免频繁外部请求，设计三级缓存架构：

```text
[组件渲染层 (React Component)]
      │
      ▼
[Tier 1: 内存状态 (In-Memory Store)]  <── 实时同步，快速无闪烁更新
      │
      ▼
[Tier 2: 本地存储缓存 (localStorage)] <── 30分钟 TTL 缓存有效期
      │
      ├─ (命中缓存 & 未过期) ──> 直接装载渲染
      │
      ▼ (过期 / 用户手动刷新)
[Tier 3: 异步获取流水线 (Fetch Pipeline)]
      ├── 1. IP 定位 / 用户偏好城市
      ├── 2. Open-Meteo 实时与预报 API
      └── 3. 写入 localStorage 并在内存广播更新
```

### 4.1 缓存配置规范
- **LocalStorage 缓存键**：
  - 天气数据缓存：`dsh_weather_cache_v1`
  - 用户设置：`dsh_weather_settings_v1`
- **缓存有效周期 (TTL)**：
  - 默认 `30 分钟` (1,800,000 ms)。
  - 若在有效周期内，侧边栏初始化直接读取本地缓存，实现 **0 毫秒首屏冷启动渲染**。
- **数据结构定义**：
```typescript
interface WeatherCachePayload {
  timestamp: number;        // 获取时刻时间戳
  expiresAt: number;        // 过期时间戳 (timestamp + 1800000)
  city: {
    name: string;           // 城市展示名称 (如 "北京"、"上海")
    latitude: number;
    longitude: number;
    country?: string;
    isAutoIp: boolean;      // 是否为 IP 自动定位
  };
  weather: {
    current: {
      temperature: number;       // 实时温度 (°C)
      apparentTemperature: number; // 体感温度 (°C)
      humidity: number;          // 湿度 (%)
      weatherCode: number;       // WMO 代码
      weatherText: string;       // 中文天气描述 (如 "晴"、"小雨")
      isDay: boolean;            // 是否为白昼
      windSpeed: number;         // 风速 (km/h)
      precipitation: number;     // 降水量 (mm)
    };
    hourly: Array<{
      time: string;              // "14:00"
      temperature: number;
      weatherCode: number;
      precipitationProbability: number;
    }>;
    daily: Array<{
      date: string;              // "2026-09-08"
      weekday: string;           // "今天", "明天", "周三"
      weatherCode: number;
      weatherText: string;
      tempMax: number;
      tempMin: number;
    }>;
  };
}

interface WeatherSettings {
  autoLocation: boolean;         // 是否启用 IP 自动定位
  manualCity?: {
    name: string;
    latitude: number;
    longitude: number;
  };
  tempUnit: 'celsius' | 'fahrenheit';
}
```

### 4.2 服务端 Cordis 支持 (`src/index.js`)
虽然客户端可直连 Open-Meteo，但在插件服务端（Cordis 服务端进程）同步提供可选的代理路由与配置接口：
- `GET /api/weather/current`: 后端代理由 Node.js 发起请求，具备 Node 内存级缓存（30 分钟），在内网受限或无跨域环境时作为无缝透明备选。
- `GET /api/weather/cities?query=`: 后端城市搜索代理。
- `GET /api/weather/health`: 健康检查端点，返回当前插件运行状态与缓存统计。

---

## 5. UI 与产品交互设计规范

### 5.1 侧边栏微型胶囊 (Sidebar Capsule)
#### 展开模式 (`wide: true`)
- **视觉构图**：
  ```text
  [ ☀ 晴间多云 ]  北京 · 23°C  [体感 24°]
  ```
- **尺寸与间距**：
  - 容器外边距：上下各 2px，左右 4px。
  - 高度：`36px`。
  - 圆角：`10px`。
  - 背景：`var(--dsw-alias-interactive-bg-subtle, rgba(255, 255, 255, 0.03))`。
  - 边框：`1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08))`。
  - 悬浮态：背景变为 `var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.07))`，边框轻微增亮。
  - 激活态：微缩 scale(0.98)。
- **微交互**：
  - 天气图标内嵌轻微呼吸发光或微动效果。
  - 点击胶囊：顺滑弹出详情浮层，并在胶囊右侧显示高亮指示微点。

#### 收起折叠模式 (`wide: false` / Rail 模式)
- **视觉构图**：
  ```text
  ┌──────┐
  │  ☀   │
  │ 23°  │
  └──────┘
  ```
- **尺寸与排版**：
  - 尺寸：`36px × 36px` 正方形圆角或圆形按钮。
  - 居中排布：上方 18px 矢量天气图标，下方 10px 紧凑温度文本（如 `23°`）。
  - 悬浮展开原生或浮层 Tooltip，展示完整地名与天气。

---

### 5.2 天气详情悬浮卡片 (Detail Overlay Card)
悬浮于页面顶层，宽度固定 `360px`，高度自适应内容（最大 `520px`，滚动展示）。

#### 布局分区
```text
┌──────────────────────────────────────────────────┐
│  [📍 北京市 · IP定位]        [🔄 刷新] [⚙ 切换] [✖]│  <- Header
├──────────────────────────────────────────────────┤
│                                                  │
│      ☀ 23°           晴间多云                      │  <- Hero Area
│      H: 26°  L: 18°   体感 24° · 空气优            │
│                                                  │
├──────────────────────────────────────────────────┤
│  [ 指标网格 2x2 ]                                │
│  ┌───────────────────────┬──────────────────────┐│
│  │ 💧 湿度  65%          │ 💨 风速  12 km/h     ││
│  ├───────────────────────┼──────────────────────┤│
│  │ ☔ 降水量 0.0 mm      │ 🧭 气压  1013 hPa    ││
│  └───────────────────────┴──────────────────────┘│
├──────────────────────────────────────────────────┤
│  [ 24小时温度与天气预报 (横向滑动) ]                │
│   现在    15:00    16:00    17:00    18:00       │
│    ☀       ☀        ⛅       ⛅       🌙        │
│   23°     24°      23°      21°      19°         │
├──────────────────────────────────────────────────┤
│  [ 未来 5 天天气趋势 ]                           │
│   今天     ☀ 晴间多云     18° ══════● 26°        │
│   明天     ⛅ 多云        17° ════●   24°        │
│   后天     🌧 小雨        16° ══●     21°        │
│   周五     ☀ 晴          15° ══════● 25°        │
│   周六     ☀ 晴          16° ══════● 27°        │
└──────────────────────────────────────────────────┘
```

#### 视觉设计细节
- **毛玻璃质感**：
  - 背景：`rgba(24, 24, 27, 0.88)` (深色主题) / `rgba(255, 255, 255, 0.92)` (浅色主题)。
  - 背景模糊：`backdrop-filter: blur(16px)`。
  - 投影：`0 16px 40px rgba(0, 0, 0, 0.4)`。
  - 边框：`1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12))`。
- **色彩与排版**：
  - 主文本：`var(--dsw-alias-label-primary, #f4f4f5)`，字号 `13px`。
  - 辅助文本：`var(--dsw-alias-label-secondary, #a1a1aa)`，字号 `12px`。
  - 大温度：`font-size: 38px, font-weight: 600, tabular-nums`。

---

### 5.3 城市搜索与切换抽屉 (City Selector Modal)
- **触发方式**：在详情卡片顶部点击 `[⚙ 城市切换]` 图标。
- **功能特性**：
  1. **当前定位还原按钮**：“📍 恢复当前 IP 自动定位”。
  2. **搜索输入框**：支持即时输入（带 300ms 防抖），调用 Open-Meteo Geocoding API。
  3. **热门城市快速选择标签 (Chips)**：
     - 国内精选：北京、上海、广州、深圳、杭州、成都、武汉、西安。
     - 国际精选：香港、东京、新加坡、伦敦、纽约。
  4. **搜索结果列表**：展示搜索到的“城市名, 行政区, 国家”，点击即可保存为用户手动选择城市并立即拉取该城市天气。

---

## 6. 异常处理与韧性设计 (Resilience & Edge Cases)

1. **断网与离线状态**：
   - 自动呈现上一次成功缓存的数据，并在城市名旁标注灰色的“离线缓存 · 1小时前”。
   - 若无任何缓存（初次启动无网），展示离线占位胶囊：`☁ 离线 · --°C`，点击可触发重试。
2. **定位失败（IP 定位服务无响应 / 429 限流）**：
   - 静默降级为默认基准城市（北京），并在设置面板中提示用户“自动定位超时，当前使用默认城市，可点击手动切换”。
3. **Open-Meteo 接口单次超时 / 500 错误**：
   - 请求设置 6000ms 超时中断，失败时不抛出未捕获异常，平滑保留旧缓存，仅在手动点击刷新时给予 Toast 或小黄点报警。
4. **窗口缩放与位置适配**：
   - 监听窗口 `resize` 事件与侧边栏折叠事件，自动重新计算并矫正详情卡片的弹出位置。

---

## 7. 下游开发指南 (给 Engineer & Reviewer)

### 7.1 目录结构规划
```text
dsh-plugins/dsh-weather/
├── package.json               # 声明 dsh.bundle.patch 与 dsh.client.exports
├── cordis.patch.yml           # Cordis 服务端图谱注入声明
├── ARCHITECTURE.md            # 本架构与技术设计方案
├── docs/
│   └── INTERACTION_AND_UI_SPEC.md  # 详细交互与组件契约
├── src/
│   ├── index.js               # 服务端 Cordis 插件实现 (Web 路由、后端缓存与健康检查)
│   └── client.js              # 浏览器客户端单文件实现 (ModuleLoader, 纯React/纯CSS, 无打包依赖)
└── test/
    └── weather-verification.test.js # 自动化语法、结构与网络容错验证
```

### 7.2 关键约束
- **严禁外部编译打包链路**：`src/client.js` 必须采用纯原生 JavaScript / `React.createElement` (`h`) 编写，完全适配 DSH `window.__ModuleLoader__.load` 机制。
- **纯 CSS 注入**：组件样式通过动态创建 `<style id="dsh-weather-styles">` 注入，使用 CSS 变量保证浅色/深色主题无缝融合。
- **侧边栏排序**：`sidebar.footer.action` 注册对象属性中务必声明 `order: -100`。
