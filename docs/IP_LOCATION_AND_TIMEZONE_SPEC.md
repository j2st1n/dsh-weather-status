# IP 定位高可用双通道与未来 24 小时时区 Bug 修复规范与设计方案

## 1. 背景与缺陷根因分析 (Root Cause Analysis)

### 1.1 IP 定位掉落默认“北京”的根因
在早期实现（`src/client.js` 中的 `detectLocationByIp`）中：
1. **单一依赖境外接口**：仅按序尝试直连 `https://ipwho.is/` 与 `https://freeipapi.com/api/json/`。在国内普通网络环境下，因跨境网络抖动、DNS 污染或防火墙干扰，境外接口直连延迟极高（经常超过 3000ms）甚至直接报错无法连通。
2. **缺乏本地服务端代理通道**：完全依赖浏览器前端发起直连，容易触发浏览器 AdBlock / Tracking Protection 规则拦截，或受到 CORS 与 CSP 限制。而本地同源的 DSH 服务端（`http://127.0.0.1:3080`）具有同源零跨域、零内网延迟、免受广告拦截且运行在 Node.js 环境中可访问任意上游的天然优势，却没有提供 IP 代理端点。
3. **静默吞异常降级导致假定位**：境外接口两次超时（耗时整整 6 秒）后，异常被完全吞掉，直接返回 `{ ...DEFAULT_CITY, isAutoIp: true }`。用户在前端看到亮起的定位图标，误以为是自己的定位，实际上显示的是“北京 晴 15°C”，引起严重误解。

### 1.2 未来 24 小时逐小时时区错位与日夜颠倒 Bug 根因
在 `src/index.js`（169-180行）与 `src/client.js`（474-485行）中：
1. **8 小时时区偏差**：
   - 代码使用 `new Date().toISOString().slice(0, 13)`，产生的是 **UTC/零时区** 时间（例如北京时间下午 14:00 时，UTC 字符串为 `"2026-09-08T06"`）。
   - 向 Open-Meteo 发送请求时带了参数 `&timezone=auto`，Open-Meteo 返回的 `hourly.time` 数组是**当地本地时间**（如 `["2026-09-08T00:00", ..., "2026-09-08T14:00", ...]`）。
   - `hourlyTimes.findIndex((t) => t.startsWith(currentIsoHour))` 用 UTC 06:00 去匹配本地时间，直接匹配到了今天早晨 6 点，导致逐小时预报列表**整整向前错位了 8 个小时**！当前 14 点看到的“现在”实际上是早晨 6 点的数据。
2. **数组全局索引 `i` 代替真实时刻判断日夜**：
   - 代码写为 `const isDayHour = i >= 6 && i <= 19`。
   - `i` 是在 `hourlyTimes` 数组（7 天共 168 个小时）中的全局下标（0 ~ 167）。
   - 当 `i >= 20` 时（例如第二天上午 10 点，`i = 26`），`26 >= 6 && 26 <= 19` 结果为 `false`！
   - 导致第二天白天所有的天气图标全部被错误判定为夜晚（晴天显示月亮、多云显示夜间多云），图标逻辑彻底紊乱。

---

## 2. 架构方案与详细技术规格 (Architecture & Technical Spec)

### 2.1 服务端实现规范 (`src/index.js`)

#### 1) 新增 IP 定位方法 `detectIpLocation(clientIp)`
在 `WeatherService` 类中新增：
- **缓存机制**：`this.ipCache = new Map()`，缓存键为 IP 或 `'default'`，TTL 设为 1 小时 (`60 * 60 * 1000`)。
- **上游探测源竞速 / 级联设计**：
  - **首选源 (Channel 1)**：`http://ip-api.com/json/${ip ? ip : ''}?lang=zh-CN`
    - 免 Key，国内与国际速度极快；
    - 返回字段：`{ status: 'success', country, city, regionName, lat, lon, timezone, query }`；
    - 城市名处理：若 `city` 为空，回退取 `regionName` 或 `country`。
  - **备选源 (Channel 2)**：`https://api.ip.sb/geoip/${ip ? ip : ''}`
    - 免 Key，支持 Anycast；
    - 返回字段：`{ country, city, region, latitude, longitude, ip, timezone }`。
  - **备选源 (Channel 3)**：`https://ipwho.is/${ip ? ip : ''}`
    - 返回字段：`{ success: true, country, city, latitude, longitude, ip, timezone: { id } }`。
- **数据归一化格式**：
  ```javascript
  {
    name: city || regionName || '本地位置',
    country: country || '',
    latitude: Number(lat),
    longitude: Number(lon),
    ip: query || ip,
    timezone: timezone || 'auto',
    isAutoIp: true,
    source: 'ip-api' // 或 'ip.sb' / 'ipwho.is'
  }
  ```

#### 2) 新增路由 `GET /api/weather/ip`
在 Cordis `apply(ctx)` 中注册：
- 提取客户端真实 IP：
  ```javascript
  const xForwardedFor = req.headers['x-forwarded-for']
  const clientIp = (typeof xForwardedFor === 'string' ? xForwardedFor.split(',')[0].trim() : '') ||
                   req.headers['x-real-ip'] ||
                   url.searchParams.get('ip') ||
                   ''
  ```
  注意：若为内网私有 IP（`127.0.0.1`、`::1`、`192.168.`、`10.`、`172.16-31.`），不要传给上游，传空字符串以查询出口公网 IP。
- 成功返回：
  ```json
  {
    "ok": true,
    "data": {
      "name": "天津",
      "country": "中国",
      "latitude": 39.0842,
      "longitude": 117.2009,
      "ip": "117.12.148.207",
      "timezone": "Asia/Shanghai",
      "isAutoIp": true
    }
  }
  ```
- 异常容错：若所有上游均失败，返回 500 或 200 携带 `ok: false, error: ...`，不要崩溃。

#### 3) 修复服务端 `getWeather()` 中的逐小时时间对齐与日夜计算
在 `src/index.js` 中：
- 请求 Open-Meteo URL 中的 `hourly` 参数补充 `is_day`：
  `hourly=temperature_2m,weather_code,precipitation_probability,is_day`
- 计算当地本地当前小时：
  ```javascript
  const utcOffsetMs = (raw.utc_offset_seconds ?? 0) * 1000
  const localNow = new Date(Date.now() + utcOffsetMs)
  const y = localNow.getUTCFullYear()
  const m = String(localNow.getUTCMonth() + 1).padStart(2, '0')
  const d = String(localNow.getUTCDate()).padStart(2, '0')
  const h = String(localNow.getUTCHours()).padStart(2, '0')
  const currentIsoHour = `${y}-${m}-${d}T${h}` // 精确生成当地当前小时，如 "2026-09-08T14"
  ```
- 查找 `startHourIdx`：
  ```javascript
  let startHourIdx = hourlyTimes.findIndex((t) => t.startsWith(currentIsoHour))
  if (startHourIdx < 0) {
    // 容错：查找最接近当前时刻的索引
    const nowMs = Date.now()
    let minDiff = Infinity
    startHourIdx = 0
    for (let idx = 0; idx < hourlyTimes.length; idx++) {
      const diff = Math.abs(Date.parse(hourlyTimes[idx] + 'Z') - (nowMs + utcOffsetMs))
      if (diff < minDiff) {
        minDiff = diff
        startHourIdx = idx
      }
    }
  }
  ```
- 日夜图标判定（彻底修复 `i` 下标 bug）：
  ```javascript
  let hourNum = 12
  if (timeStr.includes('T')) {
    hourNum = parseInt(timeStr.split('T')[1].slice(0, 2), 10)
  }
  const isDayHour = Array.isArray(raw.hourly?.is_day) && raw.hourly.is_day[i] !== undefined
    ? raw.hourly.is_day[i] === 1
    : (hourNum >= 6 && hourNum < 18)
  ```

---

### 2.2 客户端实现规范 (`src/client.js`)

#### 1) 重构 `detectLocationByIp()`
三级级联与快速超时设计（杜绝 6s 长时间卡死与掉落北京）：
```javascript
async function detectLocationByIp() {
  // 1. 优先尝试本地 Cordis 服务端代理通道 /api/weather/ip (无跨域、内网极速、免拦截)
  try {
    const res = await fetch('/api/weather/ip', {
      signal: AbortSignal.timeout(2500),
      headers: { Accept: 'application/json' }
    })
    if (res.ok) {
      const json = await res.json()
      if (json?.ok && json.data?.latitude && json.data?.longitude) {
        return {
          name: json.data.name || '本地位置',
          country: json.data.country || '',
          latitude: json.data.latitude,
          longitude: json.data.longitude,
          isAutoIp: true
        }
      }
    }
  } catch (err) {}

  // 2. 备选直连通道 A：api.ip.sb/geoip (Anycast，支持 CORS，全球含国内快速)
  try {
    const res = await fetch('https://api.ip.sb/geoip', {
      signal: AbortSignal.timeout(2500),
      headers: { Accept: 'application/json' }
    })
    if (res.ok) {
      const d = await res.json()
      if (d && d.latitude && d.longitude) {
        return {
          name: d.city || d.region || '本地位置',
          country: d.country || '',
          latitude: d.latitude,
          longitude: d.longitude,
          isAutoIp: true
        }
      }
    }
  } catch (err) {}

  // 3. 备选直连通道 B：ipwho.is
  try {
    const res = await fetch('https://ipwho.is/', {
      signal: AbortSignal.timeout(2500),
      headers: { Accept: 'application/json' }
    })
    if (res.ok) {
      const d = await res.json()
      if (d && d.success !== false && d.latitude && d.longitude) {
        return {
          name: d.city || '本地位置',
          country: d.country || '',
          latitude: d.latitude,
          longitude: d.longitude,
          isAutoIp: true
        }
      }
    }
  } catch (err) {}

  // 4. 兜底策略：结合浏览器本地时区进行智能降级
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  if (tz.includes('Tokyo')) {
    return { name: '东京', country: '日本', latitude: 35.6762, longitude: 139.6503, isAutoIp: true, isFallback: true }
  }
  if (tz.includes('Berlin') || tz.includes('Paris') || tz.includes('London')) {
    return { name: '法兰克福', country: '德国', latitude: 50.1109, longitude: 8.6821, isAutoIp: true, isFallback: true }
  }
  if (tz.includes('New_York')) {
    return { name: '纽约', country: '美国', latitude: 40.7128, longitude: -74.0060, isAutoIp: true, isFallback: true }
  }
  // 默认东八区/国内兜底
  return { ...DEFAULT_CITY, isAutoIp: true, isFallback: true }
}
```

#### 2) 同步修复客户端直连 Open-Meteo 的逐小时对齐与日夜计算
在 `src/client.js` 的 `fetchWeatherData` 中：
- `directUrl` 请求参数 `hourly` 追加 `is_day`；
- 使用与服务端相同的本地时间计算算法（结合 `raw.utc_offset_seconds` 与真实 `hourNum`）；
- 消除前 8 小时错位以及第 20 小时后的日夜颠倒 Bug。

---

## 3. 版本与测试规划

1. **版本号升级**：
   - `package.json` 中的 `version` 递增至 `0.1.2`。
2. **测试用例扩展 (`test/weather-verification.test.js`)**：
   - 增加 `GET /api/weather/ip` 路由注册与处理器响应测试；
   - 增加 `WeatherService.prototype.detectIpLocation` 探测与归一化测试；
   - 增加逐小时时间对齐算法测试（验证传入非零 UTC 偏移量时，对齐时间为本地时间而非 UTC）；
   - 增加跨 24 小时真实日夜图标判定测试（验证第二天白天 `isDayHour === true`，图标为 `sun` 而非 `moon`）。
3. **构建与语法检查**：
   - 运行 `npm run build` (`node -c src/index.js src/client.js`)；
   - 运行 `npm test` 保证全部通过。
