/**
 * dsh-weather — Server-side Cordis Plugin.
 *
 * Provides:
 *   - Weather caching service (in-memory, 30 min TTL)
 *   - Open-Meteo Forecast & Geocoding proxy
 *   - REST endpoints via ctx.webServer:
 *       GET /api/weather/current
 *       GET /api/weather/cities
 *       GET /api/weather/health
 */

export const name = 'weather'
export const inject = ['webServer']

export const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes
export const REQUEST_TIMEOUT_MS = 6000

// Default fallback location (Beijing)
export const DEFAULT_CITY = {
  name: '北京',
  country: '中国',
  latitude: 39.9042,
  longitude: 116.4074,
  isAutoIp: false
}

// Comprehensive WMO Weather Interpretation Codes (WW)
export const WMO_CODE_MAP = {
  0: { text: '晴朗', icon: 'sun', textEn: 'Clear sky' },
  1: { text: '晴间多云', icon: 'cloud-sun', textEn: 'Mainly clear' },
  2: { text: '多云', icon: 'cloud-sun', textEn: 'Partly cloudy' },
  3: { text: '阴天', icon: 'cloud', textEn: 'Overcast' },
  45: { text: '薄雾', icon: 'fog', textEn: 'Fog' },
  48: { text: '浓雾', icon: 'fog', textEn: 'Depositing rime fog' },
  51: { text: '小毛毛雨', icon: 'drizzle', textEn: 'Light drizzle' },
  53: { text: '毛毛雨', icon: 'drizzle', textEn: 'Moderate drizzle' },
  55: { text: '密集毛毛雨', icon: 'drizzle', textEn: 'Dense drizzle' },
  56: { text: '轻微冻毛毛雨', icon: 'drizzle', textEn: 'Light freezing drizzle' },
  57: { text: '冻毛毛雨', icon: 'drizzle', textEn: 'Dense freezing drizzle' },
  61: { text: '小雨', icon: 'rain', textEn: 'Slight rain' },
  63: { text: '中雨', icon: 'rain', textEn: 'Moderate rain' },
  65: { text: '大暴雨', icon: 'heavy-rain', textEn: 'Heavy rain' },
  66: { text: '冻雨', icon: 'rain', textEn: 'Freezing rain' },
  67: { text: '强冻雨', icon: 'heavy-rain', textEn: 'Heavy freezing rain' },
  71: { text: '小雪', icon: 'snow', textEn: 'Slight snow' },
  73: { text: '中雪', icon: 'snow', textEn: 'Moderate snow' },
  75: { text: '大雪', icon: 'snow', textEn: 'Heavy snow' },
  77: { text: '雪粒', icon: 'snow', textEn: 'Snow grains' },
  80: { text: '弱阵雨', icon: 'showers', textEn: 'Slight showers' },
  81: { text: '中阵雨', icon: 'showers', textEn: 'Moderate showers' },
  82: { text: '强阵雨', icon: 'showers', textEn: 'Violent showers' },
  85: { text: '小阵雪', icon: 'snow', textEn: 'Slight snow showers' },
  86: { text: '大阵雪', icon: 'snow', textEn: 'Heavy snow showers' },
  95: { text: '雷阵雨', icon: 'thunderstorm', textEn: 'Thunderstorm' },
  96: { text: '雷雨夹轻冰雹', icon: 'thunderstorm', textEn: 'Thunderstorm with slight hail' },
  99: { text: '雷暴夹重冰雹', icon: 'thunderstorm', textEn: 'Thunderstorm with heavy hail' }
}

export function getWeatherDesc(code, isDay = true) {
  const match = WMO_CODE_MAP[code]
  if (match) {
    if (code === 0 && !isDay) {
      return { ...match, text: '晴朗 (夜)', icon: 'moon' }
    }
    if ((code === 1 || code === 2) && !isDay) {
      return { ...match, icon: 'cloud-moon' }
    }
    return match
  }
  return { text: '多云', icon: isDay ? 'cloud-sun' : 'cloud-moon', textEn: 'Cloudy' }
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function formatWeekday(dateStr, index) {
  if (index === 0) return '今天'
  if (index === 1) return '明天'
  try {
    const d = new Date(dateStr)
    return WEEKDAY_NAMES[d.getDay()] || dateStr
  } catch {
    return dateStr
  }
}

function isPrivateIp(ip) {
  if (!ip || typeof ip !== 'string') return true
  const trimmed = ip.trim()
  if (!trimmed || trimmed === '127.0.0.1' || trimmed === '::1' || trimmed === 'localhost') return true
  if (trimmed.startsWith('192.168.') || trimmed.startsWith('10.') || trimmed.startsWith('169.254.')) return true
  const match172 = trimmed.match(/^172\.(\d+)\./)
  if (match172) {
    const sec = parseInt(match172[1], 10)
    if (sec >= 16 && sec <= 31) return true
  }
  return false
}

/**
 * Weather Service with 30-min TTL in-memory caching and IP geolocation.
 */
export class WeatherService {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs || DEFAULT_CACHE_TTL_MS
    this.cache = new Map() // key: `${lat.toFixed(2)},${lon.toFixed(2)}` -> { data, expiresAt }
    this.ipCache = new Map() // key: ip or 'default' -> { data, expiresAt }
  }

  getCacheKey(lat, lon) {
    const rLat = Number(lat).toFixed(2)
    const rLon = Number(lon).toFixed(2)
    return `${rLat},${rLon}`
  }

  getCached(key) {
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }
    return entry.data
  }

  setCache(key, data) {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.ttlMs
    })
  }

  clearCache() {
    this.cache.clear()
    this.ipCache.clear()
  }

  /**
   * Detect client egress IP geolocation using multi-channel high-availability cascading.
   */
  async detectIpLocation(clientIp = '') {
    const rawIp = typeof clientIp === 'string' ? clientIp.trim() : ''
    const isPrivate = isPrivateIp(rawIp)
    const targetIp = isPrivate ? '' : rawIp
    const cacheKey = targetIp || 'default'

    const cached = this.ipCache.get(cacheKey)
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data
    }

    let result = null

    // Channel 1: ip-api.com (free, high-speed, CN & global)
    try {
      const url = `http://ip-api.com/json/${targetIp ? encodeURIComponent(targetIp) : ''}?lang=zh-CN`
      const res = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { Accept: 'application/json' }
      })
      if (res.ok) {
        const d = await res.json()
        if (d && d.status === 'success' && d.lat != null && d.lon != null) {
          result = {
            name: d.city || d.regionName || d.country || '本地位置',
            country: d.country || '',
            latitude: Number(d.lat),
            longitude: Number(d.lon),
            ip: d.query || targetIp,
            timezone: d.timezone || 'auto',
            isAutoIp: true,
            source: 'ip-api'
          }
        }
      }
    } catch {}

    // Channel 2: api.ip.sb/geoip
    if (!result) {
      try {
        const url = `https://api.ip.sb/geoip/${targetIp ? encodeURIComponent(targetIp) : ''}`
        const res = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: { Accept: 'application/json' }
        })
        if (res.ok) {
          const d = await res.json()
          if (d && d.latitude != null && d.longitude != null) {
            result = {
              name: d.city || d.region || d.country || '本地位置',
              country: d.country || '',
              latitude: Number(d.latitude),
              longitude: Number(d.longitude),
              ip: d.ip || targetIp,
              timezone: d.timezone || 'auto',
              isAutoIp: true,
              source: 'ip.sb'
            }
          }
        }
      } catch {}
    }

    // Channel 3: ipwho.is
    if (!result) {
      try {
        const url = `https://ipwho.is/${targetIp ? encodeURIComponent(targetIp) : ''}`
        const res = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: { Accept: 'application/json' }
        })
        if (res.ok) {
          const d = await res.json()
          if (d && d.success !== false && d.latitude != null && d.longitude != null) {
            result = {
              name: d.city || d.region || d.country || '本地位置',
              country: d.country || '',
              latitude: Number(d.latitude),
              longitude: Number(d.longitude),
              ip: d.ip || targetIp,
              timezone: d.timezone?.id || d.timezone || 'auto',
              isAutoIp: true,
              source: 'ipwho.is'
            }
          }
        }
      } catch {}
    }

    if (!result) {
      throw new Error('All IP geolocation upstream channels failed')
    }

    this.ipCache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + 60 * 60 * 1000 // 1 hour TTL
    })

    return result
  }

  /**
   * Fetch weather forecast for given coordinate.
   */
  async getWeather({ lat = DEFAULT_CITY.latitude, lon = DEFAULT_CITY.longitude, cityName = DEFAULT_CITY.name, isAutoIp = false, force = false } = {}) {
    const nLat = Number(lat) || DEFAULT_CITY.latitude
    const nLon = Number(lon) || DEFAULT_CITY.longitude
    const cacheKey = this.getCacheKey(nLat, nLon)

    if (!force) {
      const cached = this.getCached(cacheKey)
      if (cached) {
        return {
          ...cached,
          fromCache: true,
          city: {
            ...cached.city,
            name: cityName || cached.city.name,
            isAutoIp: Boolean(isAutoIp)
          }
        }
      }
    }

    const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${nLat}&longitude=${nLon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code,precipitation_probability,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=7`

    const res = await fetch(apiUrl, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: 'application/json' }
    })

    if (!res.ok) {
      throw new Error(`Open-Meteo returned HTTP ${res.status}: ${res.statusText}`)
    }

    const raw = await res.json()
    const now = Date.now()
    const isDay = raw.current?.is_day === 1
    const currentCode = raw.current?.weather_code ?? 0
    const currentDesc = getWeatherDesc(currentCode, isDay)

    // Current hour index in hourly array aligned to location local time
    const hourlyTimes = raw.hourly?.time || []
    const hourlyTemps = raw.hourly?.temperature_2m || []
    const hourlyCodes = raw.hourly?.weather_code || []
    const hourlyPrecipProb = raw.hourly?.precipitation_probability || []

    const utcOffsetMs = (raw.utc_offset_seconds ?? 0) * 1000
    const localNow = new Date(Date.now() + utcOffsetMs)
    const y = localNow.getUTCFullYear()
    const m = String(localNow.getUTCMonth() + 1).padStart(2, '0')
    const d = String(localNow.getUTCDate()).padStart(2, '0')
    const h = String(localNow.getUTCHours()).padStart(2, '0')
    const currentIsoHour = `${y}-${m}-${d}T${h}` // e.g. "2026-09-08T14"

    let startHourIdx = hourlyTimes.findIndex((t) => t.startsWith(currentIsoHour))
    if (startHourIdx < 0) {
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

    // Take next 24 hours
    const hourly = []
    for (let i = startHourIdx; i < Math.min(startHourIdx + 24, hourlyTimes.length); i++) {
      const timeStr = hourlyTimes[i] || ''
      const hourPart = timeStr.includes('T') ? timeStr.split('T')[1].slice(0, 5) : timeStr
      const code = hourlyCodes[i] ?? 0
      let hourNum = 12
      if (timeStr.includes('T')) {
        hourNum = parseInt(timeStr.split('T')[1].slice(0, 2), 10)
      }
      const isDayHour = Array.isArray(raw.hourly?.is_day) && raw.hourly.is_day[i] !== undefined
        ? raw.hourly.is_day[i] === 1
        : (hourNum >= 6 && hourNum < 18)
      const desc = getWeatherDesc(code, isDayHour)
      hourly.push({
        time: i === startHourIdx ? '现在' : hourPart,
        isoTime: timeStr,
        temperature: Math.round(hourlyTemps[i] ?? 0),
        weatherCode: code,
        weatherText: desc.text,
        icon: desc.icon,
        precipitationProbability: hourlyPrecipProb[i] ?? 0
      })
    }

    // Daily 7 days
    const dailyTimes = raw.daily?.time || []
    const dailyCodes = raw.daily?.weather_code || []
    const dailyMax = raw.daily?.temperature_2m_max || []
    const dailyMin = raw.daily?.temperature_2m_min || []

    const daily = []
    for (let i = 0; i < dailyTimes.length; i++) {
      const code = dailyCodes[i] ?? 0
      const desc = getWeatherDesc(code, true)
      daily.push({
        date: dailyTimes[i],
        weekday: formatWeekday(dailyTimes[i], i),
        weatherCode: code,
        weatherText: desc.text,
        icon: desc.icon,
        tempMax: Math.round(dailyMax[i] ?? 0),
        tempMin: Math.round(dailyMin[i] ?? 0)
      })
    }

    const payload = {
      timestamp: now,
      expiresAt: now + this.ttlMs,
      fromCache: false,
      city: {
        name: cityName || DEFAULT_CITY.name,
        latitude: nLat,
        longitude: nLon,
        country: DEFAULT_CITY.country,
        isAutoIp: Boolean(isAutoIp)
      },
      weather: {
        current: {
          temperature: Math.round((raw.current?.temperature_2m ?? 0) * 10) / 10,
          apparentTemperature: Math.round((raw.current?.apparent_temperature ?? raw.current?.temperature_2m ?? 0) * 10) / 10,
          humidity: Math.round(raw.current?.relative_humidity_2m ?? 0),
          weatherCode: currentCode,
          weatherText: currentDesc.text,
          icon: currentDesc.icon,
          isDay,
          windSpeed: Math.round((raw.current?.wind_speed_10m ?? 0) * 10) / 10,
          precipitation: Math.round((raw.current?.precipitation ?? 0) * 10) / 10
        },
        hourly,
        daily
      }
    }

    this.setCache(cacheKey, payload)
    return payload
  }

  /**
   * Geocoding search proxy.
   */
  async searchCities(query) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return []
    }
    const q = query.trim()
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=zh&format=json`

    const res = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: 'application/json' }
    })

    if (!res.ok) {
      throw new Error(`Geocoding search failed: HTTP ${res.status}`)
    }

    const data = await res.json()
    const results = (data.results || []).map((item) => ({
      name: item.name,
      country: item.country || '',
      admin1: item.admin1 || '',
      latitude: item.latitude,
      longitude: item.longitude,
      timezone: item.timezone || 'auto'
    }))

    return results
  }
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Access-Control-Allow-Origin': '*'
  })
  res.end(JSON.stringify(body, null, 2))
}

// ---------------------------------------------------------------------------
// 本地 Host/Origin fence
//
// 移植自 dsh-opencode-status（零外部依赖），与 DSH client-connection 的
// isTrustedApiRequest 语义一致。exact 路由不经过宿主准入，因此路由自身必须做来源
// 校验：否则任意网页可用 DNS rebinding 伪造 Host 读取本机位置与天气查询结果。
// ---------------------------------------------------------------------------

/** 读取请求头；Node 的 headers 是名字归一化后的普通对象。 */
function headerValue(headers, name) {
  const value = headers?.[name]
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined
}

/** 与 DSH client-connection 对齐：localhost、[::1] 与 127/8（八位组必须 ≤255）。 */
function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** 按指定 scheme 解析裸 authority（host 或 host:port）；非法值返回 undefined。 */
function parseAuthority(authority, scheme = 'http:') {
  try {
    return new URL(`${scheme}//${authority}`)
  } catch {
    return undefined
  }
}

/** 绑定地址的 URL 主机名形式：IPv6 加方括号，去掉接口 zone。 */
function bindHostname(bindHost) {
  if (typeof bindHost !== 'string' || bindHost === '') return undefined
  const zoneAt = bindHost.indexOf('%')
  const bare = zoneAt === -1 ? bindHost : bindHost.slice(0, zoneAt)
  try {
    return new URL(`http://${bare.includes(':') ? `[${bare}]` : bare}`).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

/** 对齐 DSH 的 isTrustedAuthority：无端口条目匹配任意端口，带端口条目精确匹配。 */
function isTrustedAuthority(hostUrl, trustedHosts, scheme) {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry, scheme)
    if (entryUrl === undefined) return false
    const otherScheme = entryUrl.protocol === 'http:' ? 'https:' : 'http:'
    const explicitPort = entryUrl.port !== '' ? entryUrl.port : new URL(`${otherScheme}//${entry}`).port
    return explicitPort === ''
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/** Origin 的 http(s) scheme；非法或非 http(s) 值返回 undefined。 */
function originScheme(origin) {
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' ? 'https:' : url.protocol === 'http:' ? 'http:' : undefined
  } catch {
    return undefined
  }
}

/** 对齐 DSH 的 isSameAuthorityOrigin：Host 按 Origin 的 scheme 归一化默认端口后比较。 */
function isSameAuthorityOrigin(origin, host) {
  const scheme = originScheme(origin)
  if (scheme === undefined) return false
  const hostUrl = parseAuthority(host, scheme)
  return hostUrl !== undefined && new URL(origin).host === hostUrl.host
}

/** 读取宿主服务；未提供或未注入时 cordis 会抛错，这里统一降级为 undefined。 */
function readService(read) {
  try {
    return read()
  } catch {
    return undefined
  }
}

/** PUT/POST 只接受 JSON 请求体，允许带 charset 参数。 */
function isJsonContentType(value) {
  return typeof value === 'string' && /^application\/json\s*(?:;|$)/i.test(value.trim())
}

/**
 * Cordis plugin apply entrypoint.
 */
export function apply(ctx) {
  const service = new WeatherService()

  /** connection 服务（DSH Web 的 Host/Origin fence 所有者）及其 trustedHosts。 */
  function connectionService() {
    // 本插件的 ctx 可能不带 get；缺服务时 cordis 抛错或返回 null，统一用 != null 兜住。
    return readService(() => (typeof ctx.get === 'function' ? ctx.get('connection') : undefined))
  }

  function connectionTrustedHosts() {
    const trusted = readService(() => connectionService()?.trustedHosts)
    return Array.isArray(trusted) ? trusted.filter((entry) => typeof entry === 'string') : []
  }

  /** 监听器 scheme（https 由 TLS 配置决定，从不取自请求头）。 */
  function listenerScheme() {
    const protocol = readService(() => ctx.webServer?.protocol)
    return protocol === 'https:' || protocol === 'http:' ? protocol : 'http:'
  }

  /**
   * 本地 Host/Origin fence，与 DSH client-connection 的 isTrustedApiRequest 等价：
   * Host 必须是 loopback、监听器 bind 地址或 connection.trustedHosts 中的地址；
   * 拒绝 sec-fetch-site: cross-site；带 Origin 时必须是同一 authority（默认端口按 Origin 的 scheme 归一化）。
   */
  function trustedByLocalFence(req) {
    const headers = req.headers ?? {}
    const host = headerValue(headers, 'host')
    if (host === undefined || host === '') return false
    const origin = headerValue(headers, 'origin')
    const scheme = (origin !== undefined && originScheme(origin)) || listenerScheme()
    const hostUrl = parseAuthority(host, scheme)
    if (hostUrl === undefined) return false
    const bind = bindHostname(readService(() => ctx.webServer?.host))
    const hostTrusted = isLoopbackHostname(hostUrl.hostname)
      || (bind !== undefined && hostUrl.hostname === bind)
      || isTrustedAuthority(hostUrl, connectionTrustedHosts(), scheme)
    if (!hostTrusted) return false
    if (headerValue(headers, 'sec-fetch-site') === 'cross-site') return false
    if (origin === undefined || origin === '') return true
    return isSameAuthorityOrigin(origin, host)
  }

  /** 优先使用宿主的官方 fence，缺失 connection 服务时回退到等价的本地实现。 */
  function isTrustedRequest(req) {
    const connection = connectionService()
    // != null 同时覆盖 undefined 与 null 两种「服务不存在」形态。
    if (connection != null && typeof connection.isTrusted === 'function') {
      return readService(() => connection.isTrusted(req)) === true
    }
    return trustedByLocalFence(req)
  }

  /**
   * 读请求防护：四条路由全是只读 GET。
   * 只读路径同样会被 DNS rebinding 利用（攻击者页面可读取本机定位与天气数据），
   * 因此 GET 不再放行任意来源。
   */
  function assertTrustedRead(req) {
    if (!isTrustedRequest(req)) {
      throw Object.assign(new Error('拒绝不可信的读请求来源'), { statusCode: 403, code: 'FORBIDDEN' })
    }
  }

  /** 写请求防护：先做 Host/来源白名单（DNS rebinding 与跨站防护），再校验请求内容类型。 */
  function assertTrustedWrite(req) {
    if (!isTrustedRequest(req)) {
      throw Object.assign(new Error('拒绝不可信的写请求来源'), { statusCode: 403, code: 'FORBIDDEN' })
    }
    if (!isJsonContentType((req.headers ?? {})['content-type'])) {
      // 与宿主 client-connection 对齐：实体格式不受支持时返回 415，而不是 403。
      throw Object.assign(new Error('写请求必须使用 application/json'), {
        statusCode: 415,
        code: 'UNSUPPORTED_MEDIA_TYPE',
      })
    }
  }

  function guard(handler, { writeMethods = [], fencedRead = false } = {}) {
    return async (req, res) => {
      try {
        const method = String(req.method ?? '').toUpperCase()
        if (writeMethods.includes(method)) assertTrustedWrite(req)
        else if (fencedRead && method === 'GET') assertTrustedRead(req)
        // fence 只读请求头、不改写 req：校验通过后原样透传，
        // /api/weather/ip 仍然能读到 x-forwarded-for / x-real-ip 做 IP 定位。
        await handler(req, res)
      } catch (error) {
        sendJson(res, error?.statusCode ?? 500, {
          ok: false,
          error: { code: error?.code ?? 'INTERNAL', message: String(error?.message ?? error) }
        })
      }
    }
  }

  // 1. GET /api/weather/current
  async function handleWeatherCurrent(req, res) {
    if (req.method !== 'GET') {
      return sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'GET only' } })
    }

    try {
      const url = new URL(req.url || '/', 'http://localhost')
      const lat = parseFloat(url.searchParams.get('lat') || url.searchParams.get('latitude') || String(DEFAULT_CITY.latitude))
      const lon = parseFloat(url.searchParams.get('lon') || url.searchParams.get('longitude') || String(DEFAULT_CITY.longitude))
      const cityName = url.searchParams.get('cityName') || url.searchParams.get('city') || DEFAULT_CITY.name
      const isAutoIp = url.searchParams.get('isAutoIp') === '1' || url.searchParams.get('isAutoIp') === 'true'
      const force = url.searchParams.has('force') || url.searchParams.has('refresh')

      const data = await service.getWeather({ lat, lon, cityName, isAutoIp, force })
      sendJson(res, 200, { ok: true, data })
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        error: {
          code: 'FETCH_ERROR',
          message: err instanceof Error ? err.message : String(err)
        }
      })
    }
  }

  // 2. GET /api/weather/cities
  async function handleWeatherCities(req, res) {
    if (req.method !== 'GET') {
      return sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'GET only' } })
    }

    try {
      const url = new URL(req.url || '/', 'http://localhost')
      const query = url.searchParams.get('query') || url.searchParams.get('name') || url.searchParams.get('q') || ''
      if (!query.trim()) {
        return sendJson(res, 200, { ok: true, results: [] })
      }
      const results = await service.searchCities(query)
      sendJson(res, 200, { ok: true, results })
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        error: {
          code: 'SEARCH_ERROR',
          message: err instanceof Error ? err.message : String(err)
        }
      })
    }
  }

  // 3. GET /api/weather/health
  async function handleWeatherHealth(req, res) {
    if (req.method !== 'GET') {
      return sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'GET only' } })
    }

    sendJson(res, 200, {
      ok: true,
      service: 'dsh-weather',
      version: '0.1.2',
      cachedItems: service.cache.size,
      cachedIpItems: service.ipCache.size,
      ttlMs: service.ttlMs,
      timestamp: Date.now()
    })
  }

  // 4. GET /api/weather/ip
  async function handleWeatherIp(req, res) {
    if (req.method !== 'GET') {
      return sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'GET only' } })
    }

    try {
      const url = new URL(req.url || '/', 'http://localhost')
      const xForwardedFor = req.headers['x-forwarded-for']
      const clientIp = (typeof xForwardedFor === 'string' ? xForwardedFor.split(',')[0].trim() : '') ||
                       req.headers['x-real-ip'] ||
                       url.searchParams.get('ip') ||
                       ''
      const data = await service.detectIpLocation(clientIp)
      sendJson(res, 200, { ok: true, data })
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        error: {
          code: 'IP_LOCATION_ERROR',
          message: err instanceof Error ? err.message : String(err)
        }
      })
    }
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/weather/current',
      handler: guard(handleWeatherCurrent, { fencedRead: true })
    })
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/weather/cities',
      handler: guard(handleWeatherCities, { fencedRead: true })
    })
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/weather/health',
      handler: guard(handleWeatherHealth, { fencedRead: true })
    })
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/weather/ip',
      handler: guard(handleWeatherIp, { fencedRead: true })
    })
  )
}
