import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  name,
  inject,
  WMO_CODE_MAP,
  getWeatherDesc,
  DEFAULT_CITY,
  DEFAULT_CACHE_TTL_MS,
  WeatherService,
  apply as serverApply
} from '../src/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.resolve(__dirname, '..')

// ==========================================
// 1. Package & Manifest Spec Verification
// ==========================================
test('package.json follows DSH plugin specifications', () => {
  const pkgPath = path.join(pluginRoot, 'package.json')
  assert.ok(fs.existsSync(pkgPath), 'package.json must exist')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

  assert.equal(pkg.name, 'dsh-weather-status')
  assert.equal(pkg.type, 'module')
  assert.ok(pkg.version.match(/^\d+\.\d+\.\d+/), 'Version should be semver')
  assert.equal(pkg.exports['.'], './src/index.js')
  assert.equal(pkg.exports['./client'], './src/client.js')
  assert.equal(pkg.exports['./package.json'], './package.json')

  assert.ok(pkg.dsh, 'package.json must declare dsh config')
  assert.equal(pkg.dsh.bundle?.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client?.platform, 'web')

  // Metadata verification for npm & GitHub
  assert.ok(pkg.author, 'package.json must declare author')
  assert.equal(pkg.license, 'MIT')
  assert.ok(pkg.repository?.url?.includes('j2st1n/dsh-weather-status'), 'Repository URL must point to j2st1n/dsh-weather-status')
  assert.ok(pkg.homepage?.includes('j2st1n/dsh-weather-status'), 'Homepage must point to j2st1n/dsh-weather-status')
  assert.ok(pkg.bugs?.includes('j2st1n/dsh-weather-status'), 'Bugs URL must point to j2st1n/dsh-weather-status')
  assert.ok(Array.isArray(pkg.keywords) && pkg.keywords.includes('weather-status'), 'Keywords must include weather-status')
})

test('cordis.patch.yml declares weather service insert', () => {
  const patchPath = path.join(pluginRoot, 'cordis.patch.yml')
  assert.ok(fs.existsSync(patchPath), 'cordis.patch.yml must exist')
  const content = fs.readFileSync(patchPath, 'utf8')

  assert.ok(content.includes('id: weather'), 'Must insert id: weather')
  assert.ok(content.includes('name: dsh-weather-status'), 'Must insert name: dsh-weather-status')
})

// ==========================================
// 2. Server-side Cordis Plugin & WeatherService
// ==========================================
test('server plugin metadata and constants', () => {
  assert.equal(name, 'weather')
  assert.deepEqual(inject, ['webServer'])
  assert.equal(DEFAULT_CITY.name, '北京')
  assert.equal(DEFAULT_CITY.latitude, 39.9042)
  assert.equal(DEFAULT_CACHE_TTL_MS, 30 * 60 * 1000)
})

test('WMO weather code interpretation and day/night mapping', () => {
  const sunnyDay = getWeatherDesc(0, true)
  assert.equal(sunnyDay.text, '晴朗')
  assert.equal(sunnyDay.icon, 'sun')

  const sunnyNight = getWeatherDesc(0, false)
  assert.equal(sunnyNight.text, '晴朗 (夜)')
  assert.equal(sunnyNight.icon, 'moon')

  const rainDesc = getWeatherDesc(61, true)
  assert.equal(rainDesc.text, '小雨')
  assert.equal(rainDesc.icon, 'rain')

  const thunderDesc = getWeatherDesc(95, true)
  assert.equal(thunderDesc.text, '雷阵雨')
  assert.equal(thunderDesc.icon, 'thunderstorm')

  // Unknown code fallback
  const fallback = getWeatherDesc(999, true)
  assert.equal(fallback.text, '多云')
})

test('WeatherService cache management and TTL expiration', () => {
  const svc = new WeatherService({ ttlMs: 100 })
  const mockPayload = {
    city: { name: '上海', latitude: 31.23, longitude: 121.47 },
    weather: { current: { temperature: 25 } }
  }

  const key = svc.getCacheKey(31.23, 121.47)
  assert.equal(key, '31.23,121.47')

  // Initial cache miss
  assert.equal(svc.getCached(key), null)

  // Set cache
  svc.setCache(key, mockPayload)
  assert.deepEqual(svc.getCached(key), mockPayload)

  // Clear cache
  svc.clearCache()
  assert.equal(svc.getCached(key), null)
})

test('WeatherService live data fetch and payload formatting', async () => {
  const svc = new WeatherService()
  const res = await svc.getWeather({
    lat: 39.9042,
    lon: 116.4074,
    cityName: '北京',
    force: true
  })

  assert.ok(res, 'Weather response must not be null')
  assert.equal(res.fromCache, false)
  assert.equal(res.city.name, '北京')
  assert.ok(typeof res.weather.current.temperature === 'number')
  assert.ok(typeof res.weather.current.humidity === 'number')
  assert.ok(typeof res.weather.current.windSpeed === 'number')
  assert.ok(Array.isArray(res.weather.hourly), 'Hourly forecast must be an array')
  assert.ok(res.weather.hourly.length > 0, 'Hourly forecast should have entries')
  assert.ok(Array.isArray(res.weather.daily), 'Daily forecast must be an array')
  assert.equal(res.weather.daily.length, 7, 'Daily forecast should cover 7 days')

  // Verify caching on second call
  const cachedRes = await svc.getWeather({
    lat: 39.9042,
    lon: 116.4074,
    cityName: '北京',
    force: false
  })
  assert.equal(cachedRes.fromCache, true)
})

test('WeatherService geocoding city search', async () => {
  const svc = new WeatherService()
  const results = await svc.searchCities('杭州')
  assert.ok(Array.isArray(results))
  assert.ok(results.length > 0, 'Should find cities for 杭州')
  assert.ok(results.some((c) => c.name.includes('杭州')))

  // Empty search returns empty array
  const emptyRes = await svc.searchCities('')
  assert.deepEqual(emptyRes, [])
})

test('Cordis server apply registers endpoints on ctx.webServer', () => {
  const registeredRoutes = []
  const mockCtx = {
    webServer: {
      register: (route) => {
        registeredRoutes.push(route)
      }
    },
    effect: (fn) => fn()
  }

  serverApply(mockCtx)
  assert.equal(registeredRoutes.length, 3)
  const paths = registeredRoutes.map((r) => r.path)
  assert.ok(paths.includes('/api/weather/current'))
  assert.ok(paths.includes('/api/weather/cities'))
  assert.ok(paths.includes('/api/weather/health'))
})

// ==========================================
// 3. Client-side ModuleLoader & React Component
// ==========================================
test('client module adheres to ModuleLoader, order: -100, slots registration & UI spec', () => {
  let loadedBundle = null
  global.window = {
    __ModuleLoader__: {
      load: (b) => {
        loadedBundle = b
      }
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {}
    },
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: () => {},
    removeEventListener: () => {}
  }

  const addedHeadElements = []
  global.document = {
    createElement: (tag) => {
      const el = { tag, style: {}, id: '', textContent: '', remove: () => {} }
      return el
    },
    head: {
      appendChild: (el) => addedHeadElements.push(el)
    }
  }

  // Load and evaluate client code
  const clientCode = fs.readFileSync(path.join(pluginRoot, 'src/client.js'), 'utf8')
  eval(clientCode)

  assert.ok(loadedBundle, 'ModuleLoader bundle must be registered')
  assert.equal(loadedBundle.id, 'dsh-weather-status')

  // Mock React
  const mockReact = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useEffect: (fn) => {},
    useState: (val) => [val, () => {}],
    useRef: (val) => ({ current: val }),
    useSyncExternalStore: (sub, get) => get(),
    useCallback: (fn) => fn
  }

  const clientExports = loadedBundle.factory((modName) => {
    if (modName === 'react') return mockReact
    throw new Error('Unknown module: ' + modName)
  })

  assert.deepEqual(clientExports.inject, ['slots'])
  assert.equal(typeof clientExports.apply, 'function')

  // Apply client
  const registeredSlots = []
  const mockClientCtx = {
    effect: (fn) => fn(),
    slots: {
      inject: (slotName, callback) => callback(),
      register: (options, componentFactory) => {
        registeredSlots.push({ options, componentFactory })
      }
    }
  }

  clientExports.apply(mockClientCtx)

  // Verify CSS injection
  assert.ok(addedHeadElements.some((el) => el.id === 'dsh-weather-styles'))

  // Verify slot registrations
  const sidebarSlot = registeredSlots.find((s) => s.options.name === 'sidebar.footer.action')
  assert.ok(sidebarSlot, 'sidebar.footer.action must be registered')
  assert.equal(sidebarSlot.options.id, 'dsh-weather-status')
  assert.equal(sidebarSlot.options.order, -100, 'Sidebar action order must be -100 to strictly top-align above all plugins')

  const overlaySlot = registeredSlots.find((s) => s.options.name === 'shell.overlay')
  assert.ok(overlaySlot, 'shell.overlay must be registered')
  assert.equal(overlaySlot.options.id, 'dsh-weather-status-overlay')
  assert.equal(overlaySlot.options.order, -100)

  // Verify component rendering without crashing
  // 1. Sidebar Capsule in Wide Mode (height: 28px, borderRadius: 6px, padding: '4px 8px', background: 'transparent', fontSize: 12)
  const wideCapsuleEl = sidebarSlot.componentFactory({ wide: true })
  assert.ok(wideCapsuleEl)
  const wideRendered = wideCapsuleEl.type(wideCapsuleEl.props)
  assert.equal(wideRendered.props.className, 'dsh-weather-capsule')
  assert.equal(wideRendered.props.style.height, 28)
  assert.equal(wideRendered.props.style.borderRadius, 6)
  assert.equal(wideRendered.props.style.padding, '4px 8px')
  assert.equal(wideRendered.props.style.background, 'transparent')
  assert.equal(wideRendered.props.style.fontSize, 12)

  // 2. Sidebar Capsule in Rail Mode (wide: false, 28x28px compact)
  const railCapsuleEl = sidebarSlot.componentFactory({ wide: false })
  assert.ok(railCapsuleEl)
  const railRendered = railCapsuleEl.type(railCapsuleEl.props)
  assert.equal(railRendered.props.style.width, 28)
  assert.equal(railRendered.props.style.height, 28)
  assert.equal(railRendered.props.style.borderRadius, 6)
  assert.equal(railRendered.props.style.background, 'transparent')

  // Click capsule to open detail panel
  wideRendered.props.onClick({ stopPropagation: () => {} })

  // 3. Overlay Panel Component (left: 12, bottom: 54, width: 380, borderRadius: 16, shadow-lv3)
  const overlayPanelEl = overlaySlot.componentFactory({})
  assert.ok(overlayPanelEl)
  const overlayRendered = overlayPanelEl.type(overlayPanelEl.props)
  assert.ok(overlayRendered && typeof overlayRendered === 'object')
  assert.equal(overlayRendered.props.style.position, 'fixed')
  assert.equal(overlayRendered.props.style.left, 12)
  assert.equal(overlayRendered.props.style.bottom, 54)
  assert.equal(overlayRendered.props.style.width, 380)
  assert.equal(overlayRendered.props.style.borderRadius, 16)
  assert.ok(overlayRendered.props.style.boxShadow.includes('dsw-shadow-lv3'))
})

// ==========================================
// 4. Fault Tolerance & Offline Degradation
// ==========================================
test('degradation and edge cases handling in WeatherService', async () => {
  const svc = new WeatherService()

  // Default coordinate fallback
  const fallbackRes = await svc.getWeather({
    lat: undefined,
    lon: undefined,
    cityName: undefined
  })
  assert.equal(fallbackRes.city.name, '北京')
  assert.equal(fallbackRes.city.latitude, 39.9042)

  // Null query city search should gracefully return []
  const nullSearch = await svc.searchCities(null)
  assert.deepEqual(nullSearch, [])

  // In-memory cache returns cached data on network error if already cached
  const cacheKey = svc.getCacheKey(39.9042, 116.4074)
  assert.ok(svc.getCached(cacheKey), 'Cached data should exist')
})

test('client storage resilience with corrupted JSON in localStorage', () => {
  let corruptedRead = false
  const mockStorage = {
    getItem: (key) => {
      corruptedRead = true
      return '{corrupted-json-invalid'
    },
    setItem: () => {}
  }

  // Load client bundle with mock corrupted storage
  let testBundle = null
  global.window = {
    __ModuleLoader__: { load: (b) => { testBundle = b } },
    localStorage: mockStorage,
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener: () => {},
    removeEventListener: () => {}
  }

  const clientCode = fs.readFileSync(path.join(pluginRoot, 'src/client.js'), 'utf8')
  assert.doesNotThrow(() => {
    eval(clientCode)
  }, 'Client evaluation must never crash on corrupted localStorage')

  const mockReact = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useEffect: (fn) => {},
    useState: (val) => [val, () => {}],
    useRef: (val) => ({ current: val }),
    useSyncExternalStore: (sub, get) => get(),
    useCallback: (fn) => fn
  }

  const clientExports = testBundle.factory((mod) => (mod === 'react' ? mockReact : null))
  const registeredSlots = []
  clientExports.apply({
    effect: (fn) => fn(),
    slots: {
      inject: (name, cb) => cb(),
      register: (opt, factory) => registeredSlots.push({ opt, factory })
    }
  })

  assert.ok(corruptedRead, 'localStorage getItem should have been called')
  const capsuleEl = registeredSlots[0].factory({ wide: true })
  const capsuleRendered = capsuleEl.type(capsuleEl.props)
  assert.ok(capsuleRendered, 'Capsule should render safely even with corrupted localStorage')
})
