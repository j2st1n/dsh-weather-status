# DSH 天气插件 (dsh-weather-status)

[![npm version](https://img.shields.io/npm/v/dsh-weather-status.svg)](https://www.npmjs.com/package/dsh-weather-status)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

为 DeepSeek Harness (DSH) Web 客户端量身定制的优雅天气插件。

---

## ✨ 核心特性

- **微型天气胶囊 (Sidebar Capsule)**：
  - 无缝嵌入 DSH 左侧栏底部操作区最顶端（`order: -100` 严格置顶于其他辅助插件上方，超越 link-pulse 的 -10 与 cpa 的 10）。
  - 胶囊样式对齐原生规范（高度 28px、透明背景、T.border 边框、hover/active 高亮）。
  - 详情弹窗对齐左侧底部向上弹出（left: 12, bottom: 54, 宽 380px，圆角 16px，shadow-lv3）。
  - 支持 **自适应展开模式 (`wide: true`)** 与 **收缩折叠模式 (`wide: false` / Rail 模式)**：
    - 展开模式下展示高精度内联 SVG 气象图标、城市名、天气文字、实时温度及体感温度徽标。
    - 折叠模式下收缩为紧凑的微型胶囊，突出图标与温度数字，悬浮展示完整气象 Tooltip。
- **全功能悬浮天气详情卡片 (Detail Overlay)**：
  - 点击侧边栏胶囊平滑展开/收起浮层卡片，通过 `shell.overlay` 脱离侧边栏溢出裁剪，具备视口自适应防溢出智能定位。
  - **核心指标 2x2 网格**：相对湿度、风速风向、降水量、体感温度。
  - **未来 24 小时气温走势**：横向可滚动查看逐小时温度走势、气象图标与降水概率。
  - **未来 7 天天气预报**：星期、天气状况及最高/最低温度区间图示。
- **智能定位与城市快速切换**：
  - 支持基于 IP 的全自动免 Key 智能定位（具备多级容错与基准城市兜底机制）。
  - 内置快速切换抽屉，提供热门城市快捷选择（北京、上海、广州、深圳、杭州、成都、香港、东京、新加坡等），支持即时中文/拼音/英文城市搜索。
- **多级缓存与离线韧性**：
  - 内存 + LocalStorage 30 分钟 TTL 缓存机制，实现首屏秒开（0ms 渲染）。
  - 断网或接口异常时平滑展示离线缓存提示，UI 不崩溃、无未捕获异常。
- **零依赖与原生自适应**：
  - 采用 DSH `__ModuleLoader__` 纯原生 ESM 与 React 组件标准，无外部打包链路依赖。
  - 纯 CSS 动态样式注入，深度融合 DSH 浅色与深色设计规范（CSS 变量全自适应）。

---

## 📁 目录结构

```text
dsh-plugins/dsh-weather/
├── package.json               # 声明 dsh.bundle.patch 与 dsh.client.exports
├── cordis.patch.yml           # Cordis 服务端图谱注入声明
├── ARCHITECTURE.md            # 完备系统架构设计方案
├── README.md                  # 插件说明与接入指南
├── docs/
│   ├── INTERACTION_AND_UI_SPEC.md  # 详细交互与组件契约规范
│   └── REVIEW_REPORT.md            # 全流程质量审查与核验证明报告
├── src/
│   ├── index.js               # 服务端 Cordis 插件实现 (代理、缓存与健康检查)
│   └── client.js              # 浏览器客户端单文件实现 (ModuleLoader, 纯React/纯CSS)
└── test/
    └── weather-verification.test.js # 自动化测试与全流程验证脚本
```

---

## 🚀 接入与启用方式

### 1. 插件引入与安装

支持通过 npm 安装或本地工作区软链引入：

```bash
npm install dsh-weather-status
```

在 DSH 项目的 `package.json` 中添加依赖：

```json
{
  "dependencies": {
    "dsh-weather-status": "^0.1.0"
  }
}
```

或者本地开发时在 `package.json` 中使用工作区依赖：

```json
{
  "dependencies": {
    "dsh-weather-status": "workspace:*"
  }
}
```

或将插件目录软链至 DSH 扫描路径下。

### 2. DSH 自动装载机制

本插件已在 `package.json` 中配置原生契约：

```json
{
  "exports": {
    ".": "./src/index.js",
    "./client": "./src/client.js",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "platform": "web",
      "inject": []
    }
  }
}
```

- **服务端**：DSH 启动时，Cordis 运行时根据 `cordis.patch.yml` 将 `weather` 服务注入图谱，自动挂载服务端路由。
- **客户端**：DSH Web 构建器根据 `dsh.client` 自动将 `./client` 加入浏览器运行时图谱，在进入页面时执行 `apply(ctx)`，将天气胶囊注入左侧栏底部。

---

## 🖥️ 服务端 API 参考

所有服务端 API 挂载于 `ctx.webServer`：

### 1. 实时天气预报代理
- **路径**：`GET /api/weather/current`
- **参数**：
  - `lat` (可选): 纬度 (默认 `39.9042`)
  - `lon` (可选): 经度 (默认 `116.4074`)
  - `cityName` (可选): 城市显示名称
  - `isAutoIp` (可选): 是否为 IP 自动定位 (`1` 或 `0`)
  - `force` (可选): 强制跳过服务端 30 分钟缓存
- **返回示例**：
  ```json
  {
    "ok": true,
    "data": {
      "timestamp": 1741480000000,
      "expiresAt": 1741481800000,
      "fromCache": false,
      "city": { "name": "北京", "latitude": 39.9042, "longitude": 116.4074 },
      "weather": {
        "current": { "temperature": 15.2, "apparentTemperature": 14.8, "humidity": 45, "weatherText": "晴朗", "icon": "sun", "isDay": true },
        "hourly": [ ... ],
        "daily": [ ... ]
      }
    }
  }
  ```

### 2. 城市地理编码检索
- **路径**：`GET /api/weather/cities`
- **参数**：
  - `query` (必需): 城市名称（中文、拼音或英文）
- **返回示例**：
  ```json
  {
    "ok": true,
    "results": [
      { "name": "北京", "country": "中国", "latitude": 39.9042, "longitude": 116.4074, "timezone": "Asia/Shanghai" }
    ]
  }
  ```

### 3. 服务健康检查
- **路径**：`GET /api/weather/health`
- **返回**：`{ "ok": true, "service": "dsh-weather", "cachedItems": 1, "ttlMs": 1800000 }`

---

## 🧪 测试与质量验证

在插件根目录下运行完整测试套件：

```bash
# 语法与编译校验
npm run build

# 运行自动化测试套件
npm test
```

测试套件（`test/weather-verification.test.js`）覆盖：
- `package.json` 与 `cordis.patch.yml` 规范校验
- WMO 天气编码全映射与日夜图标切换
- WeatherService 30 分钟内存缓存与过期策略
- Open-Meteo 实时与预报数据解析
- 城市地理编码检索与防抖测试
- Cordis 路由生命周期挂载与注销
- 客户端 ModuleLoader 规范、`order: -100` 置顶与双槽位注册
- Wide 展开模式与 Rail 折叠模式无崩坏渲染
- 离线网络故障与 LocalStorage 损坏容灾降级测试
