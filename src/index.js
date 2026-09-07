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

/**
 * Weather Service with 30-min TTL in-memory caching.
 */
export class WeatherService {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs || DEFAULT_CACHE_TTL_MS
    this.cache = new Map() // key: `${lat.toFixed(2)},${lon.toFixed(2)}` -> { data, expiresAt }
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

    const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${nLat}&longitude=${nLon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=7`

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

    // Current hour index in hourly array
    const hourlyTimes = raw.hourly?.time || []
    const hourlyTemps = raw.hourly?.temperature_2m || []
    const hourlyCodes = raw.hourly?.weather_code || []
    const hourlyPrecipProb = raw.hourly?.precipitation_probability || []

    const currentIsoHour = new Date().toISOString().slice(0, 13) // "2026-09-08T14"
    let startHourIdx = hourlyTimes.findIndex((t) => t.startsWith(currentIsoHour))
    if (startHourIdx < 0) startHourIdx = 0

    // Take next 24 hours
    const hourly = []
    for (let i = startHourIdx; i < Math.min(startHourIdx + 24, hourlyTimes.length); i++) {
      const timeStr = hourlyTimes[i] || ''
      const hourPart = timeStr.includes('T') ? timeStr.split('T')[1].slice(0, 5) : timeStr
      const code = hourlyCodes[i] ?? 0
      const isDayHour = i >= 6 && i <= 19
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

/**
 * Cordis plugin apply entrypoint.
 */
export function apply(ctx) {
  const service = new WeatherService()

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
      version: '0.1.0',
      cachedItems: service.cache.size,
      ttlMs: service.ttlMs,
      timestamp: Date.now()
    })
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/weather/current',
      handler: handleWeatherCurrent
    })
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/weather/cities',
      handler: handleWeatherCities
    })
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/weather/health',
      handler: handleWeatherHealth
    })
  )
}
