# DSH 天气插件 (dsh-weather) 交互与视觉实现规范

本文档为研发工程师 (`engineer`) 与评审员 (`reviewer`) 提供高精度的 UI 表现、动画数值、SVG 图标规范与组件交互逻辑。

---

## 1. 核心设计令牌 (Design Tokens)

使用 DSH Web 客户端的原生 CSS 自定义变量，确保在默认暗黑模式、浅色模式与高对比度模式下均具备完美的对比度与可读性：

```javascript
const T = {
  // 基础背景
  bg: 'var(--dsw-alias-bg-base, #18181b)',
  bgSubtle: 'var(--dsw-alias-bg-subtle, #27272a)',
  bgContainer: 'var(--dsw-alias-bg-container, #27272a)',
  bgGlass: 'rgba(24, 24, 27, 0.88)',
  
  // 边框系统
  border: 'var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08))',
  borderLight: 'var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12))',
  borderHighlight: 'var(--dsw-alias-border-l4, rgba(255, 255, 255, 0.22))',
  
  // 文字与标签
  labelPrimary: 'var(--dsw-alias-label-primary, #f4f4f5)',
  labelSecondary: 'var(--dsw-alias-label-secondary, #a1a1aa)',
  labelTertiary: 'var(--dsw-alias-label-tertiary, #71717a)',
  labelCaption: 'var(--dsw-alias-label-caption, #52525b)',
  
  // 交互与状态
  interactiveHover: 'var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.06))',
  interactiveActive: 'var(--dsw-alias-interactive-bg-active, rgba(255, 255, 255, 0.1))',
  accent: 'var(--dsw-alias-state-business-primary, #3b82f6)',
  warn: 'var(--dsw-alias-state-warn-label, #f59e0b)',
  error: 'var(--dsw-alias-state-error-primary, #ef4444)',
  success: 'var(--dsw-alias-state-success-primary, #10b981)',
  
  // 阴影与圆角
  shadowProminent: '0 16px 40px rgba(0, 0, 0, 0.45)',
  radiusPill: '10px',
  radiusCard: '14px',
  radiusChip: '6px'
}
```

---

## 2. 动画与过渡规范

### 2.1 CSS 关键帧
```css
@keyframes dshWeatherFadeSlideUp {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes dshWeatherFadeSlideDown {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateY(8px) scale(0.97);
  }
}

@keyframes dshWeatherSpin {
  to { transform: rotate(360deg); }
}

@keyframes dshWeatherSunPulse {
  0% { transform: rotate(0deg) scale(1); }
  50% { transform: rotate(180deg) scale(1.08); }
  100% { transform: rotate(360deg) scale(1); }
}

@keyframes dshWeatherRainDrop {
  0% { opacity: 0; transform: translateY(-2px); }
  50% { opacity: 1; }
  100% { opacity: 0; transform: translateY(4px); }
}
```

### 2.2 动效降级
针对操作系统开启减少动态效果 (`prefers-reduced-motion: reduce`) 的用户，禁用所有 transform 动画，仅保留基础的透明度切换。

---

## 3. 矢量 SVG 图标集规范 (内置零依赖)

为了保证无任何外部图标库或网络字体依赖，插件内置一套超轻量级、针对天气专门优化的内联 SVG 生成函数：

1. **`Sun` (晴天·昼)**：金色暖色 `#f59e0b`，中心圆配发散光芒。
2. **`Moon` (晴天·夜)**：冷蓝月牙 `#93c5fd`。
3. **`CloudSun` (晴间多云)**：云朵遮挡半轮红日。
4. **`Cloud` (多云/阴)**：圆润饱满双层云朵 `#94a3b8`。
5. **`Rain` (雨)**：云朵下方带斜向雨滴动画轨迹。
6. **`Snow` (雪)**：六角雪花符号 `#bae6fd`。
7. **`Thunder` (雷电)**：带有高饱和度亮黄/紫色闪电。
8. **`Fog` (雾)**：平行层次渐变横线。
9. **UI 控制图标**：
   - 定位图标 (`LocationPin`)
   - 刷新图标 (`RefreshCw`)
   - 切换/设置图标 (`Sliders` / `Search`)
   - 关闭图标 (`CloseCross`)

---

## 4. 侧边栏微型胶囊交互规范

### 4.1 展开模式 (`wide: true`)
- **尺寸**：宽 100% (自适应侧边栏内部边距，约 224px)，高 28px，圆角 6px，内边距 `4px 8px`。
- **状态行为**：
  - **默认态**：透明背景 (`background: 'transparent'`)，边框 `1px solid var(--dsw-alias-border-l1)`，字体 12px，左侧天气图标，中间文字 `城市名 · 天气文字 23°`，右侧 `体感 24°` 灰色小标签。
  - **悬浮态 (Hover)**：背景提升至 `var(--dsw-alias-interactive-bg-hover)`，边框色提升至 `var(--dsw-alias-border-l2)`，鼠标指针为 `pointer`。
  - **激活态 (Active)**：微幅内压 `transform: scale(0.98)`。
  - **打开态 (Panel Open)**：激活态背景高亮 `var(--dsw-alias-interactive-bg-hover)`，并在右侧显现微型点亮蓝点。

### 4.2 收起模式 (`wide: false` / Rail 模式)
- **尺寸**：宽 28px，高 28px，圆角 6px，居中对齐。
- **排布**：
  - 居中：16px 天气 SVG 图标。
- **悬浮提示 (Tooltip)**：原生 title，展示完整信息（如：“北京 · 晴朗 23° (体感 24°)”）。

---

## 5. 天气详情卡片交互规范

### 5.1 展开与定位规范
详情弹窗采用与官方插件统一规范的固定左下向上弹出：
```javascript
{
  position: 'fixed',
  left: 12,
  bottom: 54,
  width: 380,
  maxWidth: 'calc(100vw - 24px)',
  maxHeight: 'calc(100vh - 80px)',
  borderRadius: 16,
  boxShadow: 'var(--dsw-shadow-lv3, 0 10px 32px rgba(0, 0, 0, 0.4))'
}
```

### 5.2 外部点击关闭 (Click Outside)
- 监听 `window.addEventListener('mousedown', handleOutside)`。
- 若点击区域不在详情卡片 `panelRef` 内，且不在侧边栏胶囊触发器内，则平滑执行关闭动画并在 150ms 后销毁 DOM。
- 按键 `Esc` 响应：按下 Escape 立即关闭卡片。

---

## 6. 城市搜索与管理交互流程

1. **进入切换界面**：
   - 用户在详情卡片点击右上角搜索图标 `[🔍]`。
   - 卡片正文平滑切换为搜索与城市管理视图。
2. **IP 自动定位恢复**：
   - 顶部提供醒目的快捷按钮：“📍 恢复当前位置 (IP 自动定位)”。
   - 若用户当前为手动城市，点击此按钮立即清除手动设置，触发 IP 定位流水线并刷新。
3. **热门城市快速点击 (Quick Chips)**：
   - 预设 8 个国内主要核心城市与 4 个国际主要城市：
     `北京`、`上海`、`广州`、`深圳`、`杭州`、`成都`、`武汉`、`西安`、`香港`、`东京`、`伦敦`、`纽约`。
   - 点击任一 Chip，立即设置为当前城市，重置缓存，并返回主天气界面。
4. **即时检索 (Geocoding Search)**：
   - 输入框具备 300ms 防抖。
   - 用户输入汉字（如“南京”）、拼音（“nanjing”）或英文。
   - 下方实时列表展示匹配项：`南京市, 江苏省, 中国`。
   - 点击选择后，写入 LocalStorage 持久化，关闭切换视图并立即加载天气。

---

## 7. 异常降级交互示例

- **网络完全断开**：
  - 胶囊显示灰度云朵与 `离线` 文本。
  - 详情卡片顶部呈现黄色弱提示条：“⚠️ 网络连接不可用，展示最近一次离线缓存 (14:30 更新)”。
- **定位超时**：
  - 静默采用备选城市（北京 39.90, 116.40），右上角提示“定位超时，已切换至默认城市”。
- **API 异常响应 (500/503)**：
  - 刷新按钮暂停旋转，呈现温和的轻提示，避免任何控制台未捕获红错。
