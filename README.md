# dsh-weather-status

[![npm version](https://img.shields.io/npm/v/dsh-weather-status.svg)](https://www.npmjs.com/package/dsh-weather-status)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

为 DeepSeek Harness (DSH) Web 打造的侧栏天气状态胶囊与气象浮层插件，免配置开箱即用。

## 核心特性

- **侧边栏常驻胶囊**：无缝嵌入 DSH 左边栏底部（严格置顶），自适应宽栏与窄栏 Rail 模式，实时展示当前气象与温度。
- **全功能悬浮卡片**：点击胶囊弹出视口自适应气象面板，一览 24 小时气温走势、7 天天气预报及温湿度、风速等核心指标。
- **智能免 Key 定位与切换**：支持全自动 IP 智能定位与基准城市兜底，内置快速城市切换抽屉，支持全国城市检索。
- **多级缓存与离线韧性**：内存与 LocalStorage 双层 TTL 缓存，首屏 0ms 秒开，断网平滑降级，零外部打包依赖。

## 安装与使用

### 一键安装

```bash
dsh plugin --profile web add dsh-weather-status
```

> 或通过 GitHub 仓库安装：`dsh plugin --profile web add github:j2st1n/dsh-weather-status`

### 快速使用

1. 安装后启动或重启 DSH Web 界面 (`dsh web`)。
2. 左边栏底部即刻呈现天气胶囊，点击胶囊可展开/收起 7 天趋势与详细气象卡片。
3. 点击卡片右上角定位图标即可快速搜索切换城市。

### 卸载

```bash
dsh plugin --profile web remove dsh-weather-status
```

## License

[MIT](./LICENSE)
