/**
 * dsh-weather — Client half (Web GUI).
 *
 * Hand-written __ModuleLoader__ bundle, zero build step, pure React / ESM.
 * Slots:
 *   - sidebar.footer.action : Pill capsule in sidebar footer (order: -100, strictly topmost)
 *   - shell.overlay         : Floating detail panel & city selector
 */
window.__ModuleLoader__.load({
  id: 'dsh-weather-status',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState, useRef, useSyncExternalStore, useCallback } = React

    // ---------- Constants & Defaults ----------
    const CACHE_KEY = 'dsh_weather_cache_v1'
    const SETTINGS_KEY = 'dsh_weather_settings_v1'
    const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes
    const REQUEST_TIMEOUT_MS = 6000

    const DEFAULT_CITY = {
      name: '北京',
      country: '中国',
      latitude: 39.9042,
      longitude: 116.4074,
      isAutoIp: true
    }

    const POPULAR_CITIES = [
      { name: '北京', country: '中国', latitude: 39.9042, longitude: 116.4074 },
      { name: '上海', country: '中国', latitude: 31.2304, longitude: 121.4737 },
      { name: '广州', country: '中国', latitude: 23.1291, longitude: 113.2644 },
      { name: '深圳', country: '中国', latitude: 22.5431, longitude: 114.0579 },
      { name: '杭州', country: '中国', latitude: 30.2741, longitude: 120.1551 },
      { name: '成都', country: '中国', latitude: 30.5728, longitude: 104.0668 },
      { name: '武汉', country: '中国', latitude: 30.5928, longitude: 114.3055 },
      { name: '西安', country: '中国', latitude: 34.3416, longitude: 108.9398 },
      { name: '香港', country: '中国', latitude: 22.3193, longitude: 114.1694 },
      { name: '东京', country: '日本', latitude: 35.6762, longitude: 139.6503 },
      { name: '新加坡', country: '新加坡', latitude: 1.3521, longitude: 103.8198 },
      { name: '伦敦', country: '英国', latitude: 51.5074, longitude: -0.1278 },
      { name: '纽约', country: '美国', latitude: 40.7128, longitude: -74.0060 }
    ]

    // WMO Weather Mapping
    const WMO_MAP = {
      0: { text: '晴朗', icon: 'sun' },
      1: { text: '晴间多云', icon: 'cloud-sun' },
      2: { text: '多云', icon: 'cloud-sun' },
      3: { text: '阴天', icon: 'cloud' },
      45: { text: '薄雾', icon: 'fog' },
      48: { text: '浓雾', icon: 'fog' },
      51: { text: '小毛毛雨', icon: 'drizzle' },
      53: { text: '毛毛雨', icon: 'drizzle' },
      55: { text: '密集毛毛雨', icon: 'drizzle' },
      61: { text: '小雨', icon: 'rain' },
      63: { text: '中雨', icon: 'rain' },
      65: { text: '大暴雨', icon: 'heavy-rain' },
      71: { text: '小雪', icon: 'snow' },
      73: { text: '中雪', icon: 'snow' },
      75: { text: '大雪', icon: 'snow' },
      77: { text: '雪粒', icon: 'snow' },
      80: { text: '弱阵雨', icon: 'showers' },
      81: { text: '中阵雨', icon: 'showers' },
      82: { text: '强阵雨', icon: 'showers' },
      85: { text: '小阵雪', icon: 'snow' },
      86: { text: '大阵雪', icon: 'snow' },
      95: { text: '雷阵雨', icon: 'thunderstorm' },
      96: { text: '雷雨夹轻冰雹', icon: 'thunderstorm' },
      99: { text: '强雷暴夹重冰雹', icon: 'thunderstorm' }
    }

    function getWeatherInfo(code, isDay = true) {
      const match = WMO_MAP[code]
      if (match) {
        if (code === 0 && !isDay) return { text: '晴朗 (夜)', icon: 'moon' }
        if ((code === 1 || code === 2) && !isDay) return { ...match, icon: 'cloud-moon' }
        return match
      }
      return { text: '多云', icon: isDay ? 'cloud-sun' : 'cloud-moon' }
    }

    const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    function getWeekdayLabel(dateStr, idx) {
      if (idx === 0) return '今天'
      if (idx === 1) return '明天'
      try {
        const d = new Date(dateStr)
        return WEEKDAYS[d.getDay()] || dateStr
      } catch {
        return dateStr
      }
    }

    // ---------- LocalStorage Helpers ----------
    function loadCachedData() {
      try {
        const raw = window.localStorage?.getItem(CACHE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && parsed.weather) {
          return parsed
        }
      } catch {}
      return null
    }

    function saveCachedData(payload) {
      try {
        window.localStorage?.setItem(CACHE_KEY, JSON.stringify(payload))
      } catch {}
    }

    function loadSettings() {
      try {
        const raw = window.localStorage?.getItem(SETTINGS_KEY)
        if (!raw) return { autoLocation: true, manualCity: null }
        return JSON.parse(raw)
      } catch {
        return { autoLocation: true, manualCity: null }
      }
    }

    function saveSettings(settings) {
      try {
        window.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings))
      } catch {}
    }

    // ---------- Design Tokens ----------
    const T = {
      bg: 'var(--dsw-alias-bg-base, #18181b)',
      bgSubtle: 'var(--dsw-alias-interactive-bg-subtle, rgba(255, 255, 255, 0.04))',
      bgHover: 'var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08))',
      bgActive: 'var(--dsw-alias-interactive-bg-active, rgba(255, 255, 255, 0.12))',
      bgPanel: 'var(--dsw-specific-menu, var(--dsw-alias-bg-layer-3, rgba(24, 24, 27, 0.96)))',
      bgCard: 'var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.04)))',
      border: 'var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1))',
      border2: 'var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.18))',
      borderHighlight: 'var(--dsw-alias-border-l4, rgba(255, 255, 255, 0.28))',
      label: 'var(--dsw-alias-label-primary, #f4f4f5)',
      labelSec: 'var(--dsw-alias-label-secondary, #a1a1aa)',
      labelDim: 'var(--dsw-alias-label-tertiary, #71717a)',
      accent: 'var(--dsw-alias-state-business-primary, #3b82f6)',
      accentBg: 'rgba(59, 130, 246, 0.15)',
      warn: 'var(--dsw-alias-state-warn-label, #f59e0b)',
      warnBg: 'rgba(245, 158, 11, 0.12)',
      shadow: 'var(--dsw-shadow-lv3, 0 10px 32px rgba(0, 0, 0, 0.4))'
    }

    // ---------- Inline Stylesheet ----------
    const CSS = `
      div[class*="footerActions"] {
        display: flex !important;
        flex-direction: column !important;
        gap: 4px !important;
        width: 100% !important;
      }
      @keyframes dshWeatherFadeSlideUp {
        from { opacity: 0; transform: translateY(8px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes dshWeatherFadeSlideDown {
        from { opacity: 1; transform: translateY(0) scale(1); }
        to { opacity: 0; transform: translateY(8px) scale(0.98); }
      }
      @keyframes dshWeatherSpin {
        to { transform: rotate(360deg); }
      }
      @keyframes dshWeatherPulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.06); }
      }
      .dsh-weather-panel-enter {
        animation: dshWeatherFadeSlideUp 0.18s cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      .dsh-weather-panel-exit {
        animation: dshWeatherFadeSlideDown 0.14s ease-in both;
        pointer-events: none !important;
      }
      .dsh-weather-spin {
        display: inline-block;
        animation: dshWeatherSpin 0.9s linear infinite;
      }
      .dsh-weather-pulse {
        animation: dshWeatherPulse 3s ease-in-out infinite;
      }
      .dsh-weather-capsule {
        transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
      }
      .dsh-weather-capsule:hover {
        background: ${T.bgHover} !important;
        border-color: ${T.border2} !important;
      }
      .dsh-weather-capsule:active {
        transform: scale(0.98);
      }
      .dsh-weather-btn {
        transition: all 0.15s ease;
      }
      .dsh-weather-btn:hover {
        background: ${T.bgHover} !important;
        color: ${T.label} !important;
      }
      .dsh-weather-btn:active {
        transform: scale(0.96);
      }
      .dsh-weather-chip {
        transition: all 0.12s ease;
      }
      .dsh-weather-chip:hover {
        background: ${T.accentBg} !important;
        border-color: ${T.accent} !important;
        color: #60a5fa !important;
      }
      .dsh-weather-scroll::-webkit-scrollbar {
        height: 4px;
        width: 4px;
      }
      .dsh-weather-scroll::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.15);
        border-radius: 4px;
      }
      @media (prefers-reduced-motion: reduce) {
        .dsh-weather-panel-enter, .dsh-weather-panel-exit, .dsh-weather-spin, .dsh-weather-pulse {
          animation: none !important;
        }
      }
    `

    // ---------- Inline SVG Icons ----------
    const Icons = {
      sun: () => h('svg', { width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none', stroke: '#f59e0b', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('circle', { cx: '12', cy: '12', r: '4', fill: '#f59e0b', fillOpacity: '0.2' }),
        h('path', { d: 'M12 2v2' }),
        h('path', { d: 'M12 20v2' }),
        h('path', { d: 'm4.93 4.93 1.41 1.41' }),
        h('path', { d: 'm17.66 17.66 1.41 1.41' }),
        h('path', { d: 'M2 12h2' }),
        h('path', { d: 'M20 12h2' }),
        h('path', { d: 'm6.34 17.66-1.41 1.41' }),
        h('path', { d: 'm19.07 4.93-1.41 1.41' })
      ]),
      moon: () => h('svg', { width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none', stroke: '#93c5fd', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('path', { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z', fill: '#93c5fd', fillOpacity: '0.2' })
      ]),
      'cloud-sun': () => h('svg', { width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('path', { d: 'M12 2v2', stroke: '#f59e0b', strokeWidth: '2' }),
        h('path', { d: 'm4.93 4.93 1.41 1.41', stroke: '#f59e0b', strokeWidth: '2' }),
        h('path', { d: 'M20 12h2', stroke: '#f59e0b', strokeWidth: '2' }),
        h('path', { d: 'm19.07 4.93-1.41 1.41', stroke: '#f59e0b', strokeWidth: '2' }),
        h('path', { d: 'M15.5 13a3.5 3.5 0 0 0-3.5-3.5c-.4 0-.8.1-1.1.2A4.5 4.5 0 0 0 3 13.5 4.5 4.5 0 0 0 7.5 18h8a3.5 3.5 0 0 0 0-7c-.2 0-.4 0-.6.1', fill: '#94a3b8', fillOpacity: '0.2', stroke: '#cbd5e1', strokeWidth: '2' })
      ]),
      'cloud-moon': () => h('svg', { width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('path', { d: 'M10.5 4a4.5 4.5 0 0 0 5 4.5 4.5 4.5 0 0 1-5-4.5Z', fill: '#93c5fd', fillOpacity: '0.3', stroke: '#93c5fd', strokeWidth: '1.8' }),
        h('path', { d: 'M17.5 19H9a5 5 0 0 1-1-9.9 5.5 5.5 0 0 1 10.5 1.9 4 4 0 0 1-1 8Z', fill: '#94a3b8', fillOpacity: '0.2', stroke: '#94a3b8', strokeWidth: '2' })
      ]),
      cloud: () => h('svg', { width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none', stroke: '#94a3b8', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('path', { d: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z', fill: '#94a3b8', fillOpacity: '0.2' })
      ]),
      fog: () => h('svg', { width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none', stroke: '#a1a1aa', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('path', { d: 'M4 14h16' }),
        h('path', { d: 'M6 18h12' }),
        h('path', { d: 'M4 10h16' }),
        h('path', { d: 'M7 6h10' })
      ]),
      drizzle: () => h('svg', { width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('path', { d: 'M17.5 15H9a5.5 5.5 0 1 1 5.3-7h1.2a3.5 3.5 0 1 1 2 7Z', fill: '#94a3b8', fillOpacity: '0.2', stroke: '#94a3b8', strokeWidth: '2' }),
        h('path', { d: 'm8 18-.5 2', stroke: '#38bdf8', strokeWidth: '2' }),
        h('path', { d: 'm12 18-.5 2', stroke: '#38bdf8', strokeWidth: '2' }),
        h('path', { d: 'm16 18-.5 2', stroke: '#38bdf8', strokeWidth: '2' })
      ]),
      rain: () => h('svg', { width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('path', { d: 'M17.5 14H9a6 6 0 1 1 5.8-8h1.2a4 4 0 1 1 1.5 8Z', fill: '#94a3b8', fillOpacity: '0.2', stroke: '#94a3b8', strokeWidth: '2' }),
        h('path', { d: 'm8 17-1.5 4', stroke: '#0284c7', strokeWidth: '2' }),
        h('path', { d: 'm12 17-1.5 4', stroke: '#0284c7', strokeWidth: '2' }),
        h('path', { d: 'm16 17-1.5 4', stroke: '#0284c7', strokeWidth: '2' })
      ]),
      'heavy-rain': () => h('svg', { width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('path', { d: 'M17.5 13H9a6 6 0 1 1 5.8-8h1.2a4 4 0 1 1 1.5 8Z', fill: '#64748b', fillOpacity: '0.3', stroke: '#64748b', strokeWidth: '2' }),
        h('path', { d: 'm7 16-2 5', stroke: '#2563eb', strokeWidth: '2.5' }),
        h('path', { d: 'm11 16-2 5', stroke: '#2563eb', strokeWidth: '2.5' }),
        h('path', { d: 'm15 16-2 5', stroke: '#2563eb', strokeWidth: '2.5' }),
        h('path', { d: 'm19 16-2 5', stroke: '#2563eb', strokeWidth: '2.5' })
      ]),
      showers: () => h('svg', { width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('path', { d: 'M17.5 14H9a6 6 0 1 1 5.8-8h1.2a4 4 0 1 1 1.5 8Z', fill: '#94a3b8', fillOpacity: '0.2', stroke: '#94a3b8', strokeWidth: '2' }),
        h('path', { d: 'm9 17-1 4', stroke: '#38bdf8', strokeWidth: '2' }),
        h('path', { d: 'm14 17-1 4', stroke: '#38bdf8', strokeWidth: '2' })
      ]),
      snow: () => h('svg', { width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none', stroke: '#bae6fd', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('path', { d: 'M12 2v20' }),
        h('path', { d: 'M17 5 7 19' }),
        h('path', { d: 'm7 5 10 14' }),
        h('circle', { cx: '12', cy: '12', r: '2', fill: '#bae6fd' })
      ]),
      thunderstorm: () => h('svg', { width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('path', { d: 'M17.5 13H9a6 6 0 1 1 5.8-8h1.2a4 4 0 1 1 1.5 8Z', fill: '#475569', fillOpacity: '0.3', stroke: '#475569', strokeWidth: '2' }),
        h('path', { d: 'm13 13-3 5h3l-1 4 4-6h-3l2-3', fill: '#eab308', stroke: '#eab308', strokeWidth: '1.5', strokeLinejoin: 'round' })
      ]),
      // UI Control Icons
      pin: () => h('svg', { width: '14', height: '14', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('path', { d: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z' }),
        h('circle', { cx: '12', cy: '10', r: '3' })
      ]),
      refresh: () => h('svg', { width: '14', height: '14', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('path', { d: 'M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }),
        h('path', { d: 'M3 3v5h5' }),
        h('path', { d: 'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16' }),
        h('path', { d: 'M16 21h5v-5' })
      ]),
      search: () => h('svg', { width: '14', height: '14', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('circle', { cx: '11', cy: '11', r: '8' }),
        h('path', { d: 'm21 21-4.3-4.3' })
      ]),
      close: () => h('svg', { width: '14', height: '14', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('path', { d: 'M18 6 6 18' }),
        h('path', { d: 'm6 6 12 12' })
      ]),
      back: () => h('svg', { width: '14', height: '14', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('path', { d: 'm15 18-6-6 6-6' })
      ]),
      wind: () => h('svg', { width: '15', height: '15', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('path', { d: 'M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2' }),
        h('path', { d: 'M9.6 4.6A2 2 0 1 1 11 8H2' }),
        h('path', { d: 'M12.6 19.4A2 2 0 1 0 14 16H2' })
      ]),
      humidity: () => h('svg', { width: '15', height: '15', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('path', { d: 'M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z' })
      ]),
      droplet: () => h('svg', { width: '15', height: '15', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('path', { d: 'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z' })
      ]),
      thermometer: () => h('svg', { width: '15', height: '15', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
        h('path', { d: 'M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z' })
      ])
    }

    function renderWeatherIcon(iconName, isDay = true) {
      let key = iconName
      if (!Icons[key]) {
        key = isDay ? 'cloud-sun' : 'cloud-moon'
      }
      const Comp = Icons[key] || Icons['cloud']
      return h(Comp)
    }

    // ---------- Global Store for Sync ----------
    const initialCache = loadCachedData()
    const initialSettings = loadSettings()

    const store = {
      state: {
        data: initialCache,
        settings: initialSettings,
        loading: !initialCache,
        refreshing: false,
        isOffline: false,
        panelState: 'closed', // 'closed' | 'open' | 'closing'
        viewMode: 'detail',   // 'detail' | 'citySearch'
        searchQuery: '',
        searchResults: [],
        searchLoading: false,
        triggerRect: null,
        errorMsg: null
      },
      listeners: new Set(),
      set(patch) {
        store.state = { ...store.state, ...patch }
        for (const fn of store.listeners) fn()
      },
      subscribe(fn) {
        store.listeners.add(fn)
        return () => store.listeners.delete(fn)
      }
    }

    function useStore() {
      return useSyncExternalStore(store.subscribe, () => store.state)
    }

    // ---------- IP Geolocation Fetchers ----------
    async function detectLocationByIp() {
      // 1. Try ipwho.is
      try {
        const res = await fetch('https://ipwho.is/', {
          signal: AbortSignal.timeout(3000),
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

      // 2. Try freeipapi.com
      try {
        const res = await fetch('https://freeipapi.com/api/json/', {
          signal: AbortSignal.timeout(3000),
          headers: { Accept: 'application/json' }
        })
        if (res.ok) {
          const d = await res.json()
          if (d && d.latitude && d.longitude) {
            return {
              name: d.cityName || '本地位置',
              country: d.countryName || '',
              latitude: d.latitude,
              longitude: d.longitude,
              isAutoIp: true
            }
          }
        }
      } catch (err) {}

      // 3. Fallback to Beijing
      return { ...DEFAULT_CITY, isAutoIp: true }
    }

    // ---------- Weather Fetch Pipeline ----------
    async function fetchWeatherData(force = false) {
      const { settings, data: currentData } = store.state

      // Cache validation
      if (!force && currentData && currentData.expiresAt && Date.now() < currentData.expiresAt) {
        return
      }

      store.set({ refreshing: true, errorMsg: null })

      try {
        let targetCity = null
        if (!settings.autoLocation && settings.manualCity) {
          targetCity = { ...settings.manualCity, isAutoIp: false }
        } else {
          targetCity = await detectLocationByIp()
        }

        const { latitude: lat, longitude: lon, name: cityName, isAutoIp } = targetCity

        // Try direct Open-Meteo
        let fetchedPayload = null
        try {
          const directUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=7`
          const res = await fetch(directUrl, {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: { Accept: 'application/json' }
          })
          if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`)
          const raw = await res.json()

          const now = Date.now()
          const isDay = raw.current?.is_day === 1
          const currentCode = raw.current?.weather_code ?? 0
          const currentDesc = getWeatherInfo(currentCode, isDay)

          // Hourly next 24h
          const hourlyTimes = raw.hourly?.time || []
          const hourlyTemps = raw.hourly?.temperature_2m || []
          const hourlyCodes = raw.hourly?.weather_code || []
          const hourlyPrecipProb = raw.hourly?.precipitation_probability || []

          const currentIsoHour = new Date().toISOString().slice(0, 13)
          let startHourIdx = hourlyTimes.findIndex((t) => t.startsWith(currentIsoHour))
          if (startHourIdx < 0) startHourIdx = 0

          const hourly = []
          for (let i = startHourIdx; i < Math.min(startHourIdx + 24, hourlyTimes.length); i++) {
            const timeStr = hourlyTimes[i] || ''
            const hourPart = timeStr.includes('T') ? timeStr.split('T')[1].slice(0, 5) : timeStr
            const code = hourlyCodes[i] ?? 0
            const isDayHour = i >= 6 && i <= 19
            const desc = getWeatherInfo(code, isDayHour)
            hourly.push({
              time: i === startHourIdx ? '现在' : hourPart,
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
            const desc = getWeatherInfo(code, true)
            daily.push({
              date: dailyTimes[i],
              weekday: getWeekdayLabel(dailyTimes[i], i),
              weatherCode: code,
              weatherText: desc.text,
              icon: desc.icon,
              tempMax: Math.round(dailyMax[i] ?? 0),
              tempMin: Math.round(dailyMin[i] ?? 0)
            })
          }

          fetchedPayload = {
            timestamp: now,
            expiresAt: now + CACHE_TTL_MS,
            city: {
              name: cityName,
              latitude: lat,
              longitude: lon,
              country: targetCity.country || '',
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
        } catch (directErr) {
          // Fallback to local Cordis proxy
          const proxyUrl = `/api/weather/current?lat=${lat}&lon=${lon}&cityName=${encodeURIComponent(cityName)}&isAutoIp=${isAutoIp ? '1' : '0'}${force ? '&force=1' : ''}`
          const pRes = await fetch(proxyUrl, { headers: { Accept: 'application/json' } })
          if (!pRes.ok) throw new Error(`Backend proxy error: HTTP ${pRes.status}`)
          const pJson = await pRes.json()
          if (pJson && pJson.ok && pJson.data) {
            fetchedPayload = pJson.data
          } else {
            throw new Error('No weather data received')
          }
        }

        if (fetchedPayload) {
          saveCachedData(fetchedPayload)
          store.set({
            data: fetchedPayload,
            loading: false,
            refreshing: false,
            isOffline: false
          })
        }
      } catch (err) {
        // If fetch fails, keep cached data but mark as offline
        store.set({
          loading: false,
          refreshing: false,
          isOffline: true,
          errorMsg: '网络连接异常，已展示离线缓存'
        })
      }
    }

    // City Geocoding Search
    async function searchCities(query) {
      if (!query || !query.trim()) {
        store.set({ searchResults: [], searchLoading: false })
        return
      }
      store.set({ searchLoading: true })
      try {
        const q = query.trim()
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=zh&format=json`
        let list = []
        try {
          const res = await fetch(url, {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: { Accept: 'application/json' }
          })
          if (res.ok) {
            const data = await res.json()
            list = (data.results || []).map((item) => ({
              name: item.name,
              country: item.country || '',
              admin1: item.admin1 || '',
              latitude: item.latitude,
              longitude: item.longitude
            }))
          }
        } catch (err) {
          // Fallback to backend proxy
          const pRes = await fetch(`/api/weather/cities?query=${encodeURIComponent(q)}`)
          if (pRes.ok) {
            const pData = await pRes.json()
            if (pData && pData.ok) list = pData.results || []
          }
        }
        store.set({ searchResults: list, searchLoading: false })
      } catch (err) {
        store.set({ searchResults: [], searchLoading: false })
      }
    }

    // Panel controls
    function openPanel(rect) {
      store.set({ panelState: 'open', triggerRect: rect, viewMode: 'detail' })
    }

    function closePanel() {
      if (store.state.panelState !== 'open') return
      store.set({ panelState: 'closing' })
      setTimeout(() => {
        store.set({ panelState: 'closed', triggerRect: null })
      }, 150)
    }

    function togglePanel(rect) {
      if (store.state.panelState === 'open') {
        closePanel()
      } else {
        openPanel(rect)
      }
    }

    function selectCity(city) {
      const newSettings = {
        autoLocation: false,
        manualCity: {
          name: city.name,
          country: city.country || '',
          latitude: city.latitude,
          longitude: city.longitude
        }
      }
      saveSettings(newSettings)
      store.set({
        settings: newSettings,
        viewMode: 'detail',
        searchQuery: '',
        searchResults: []
      })
      fetchWeatherData(true)
    }

    function restoreAutoLocation() {
      const newSettings = {
        autoLocation: true,
        manualCity: null
      }
      saveSettings(newSettings)
      store.set({
        settings: newSettings,
        viewMode: 'detail',
        searchQuery: '',
        searchResults: []
      })
      fetchWeatherData(true)
    }

    // ---------- Component: Sidebar Weather Capsule ----------
    function WeatherCapsule(props) {
      const wide = Boolean(props && props.wide)
      const state = useStore()
      const capsuleRef = useRef(null)
      const { data, loading, panelState } = state

      useEffect(() => {
        fetchWeatherData(false)
        const timer = setInterval(() => fetchWeatherData(false), 15 * 60 * 1000)
        return () => clearInterval(timer)
      }, [])

      const handleClick = useCallback((e) => {
        if (e && e.stopPropagation) e.stopPropagation()
        togglePanel()
      }, [])

      const isOpen = panelState === 'open'
      const cur = data?.weather?.current
      const cityName = data?.city?.name || '北京'
      const currentTemp = cur ? `${Math.round(cur.temperature)}°` : '--°'
      const apparentTemp = cur ? `${Math.round(cur.apparentTemperature)}°` : '--°'
      const weatherText = cur?.weatherText || (loading ? '加载中...' : '晴朗')
      const weatherIcon = cur?.icon || 'cloud-sun'
      const isDay = cur?.isDay ?? true

      const tooltipText = `${cityName} · ${weatherText} ${currentTemp} (体感 ${apparentTemp})`

      // Wide mode
      if (wide) {
        return h(
          'div',
          {
            ref: capsuleRef,
            onClick: handleClick,
            title: tooltipText,
            className: 'dsh-weather-capsule',
            style: {
              height: 28,
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              padding: '4px 8px',
              gap: 6,
              borderRadius: 6,
              background: isOpen ? 'var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08))' : 'transparent',
              border: `1px solid ${isOpen ? T.border2 : T.border}`,
              cursor: 'pointer',
              userSelect: 'none',
              boxSizing: 'border-box',
              position: 'relative',
              fontSize: 12,
              lineHeight: '18px'
            }
          },
          [
            // Weather Icon
            h('div', {
              style: {
                width: 16,
                height: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }
            }, renderWeatherIcon(weatherIcon, isDay)),

            // City + Weather text + Temp
            h('div', {
              style: {
                flex: 1,
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 12,
                color: T.label,
                fontWeight: 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }
            }, [
              h('span', {
                style: {
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }
              }, cityName),
              h('span', { style: { color: T.labelDim, fontSize: 11 } }, '·'),
              h('span', { style: { color: T.labelSec, fontSize: 11 } }, weatherText),
              h('span', {
                style: {
                  fontWeight: 600,
                  color: T.label,
                  fontVariantNumeric: 'tabular-nums'
                }
              }, currentTemp)
            ]),

            // Apparent temp badge
            h('span', {
              style: {
                fontSize: 10,
                color: T.labelDim,
                flexShrink: 0,
                padding: '0 4px',
                lineHeight: '16px',
                borderRadius: 4,
                background: T.bgSubtle
              }
            }, `体感 ${apparentTemp}`),

            // Indicator dot when open
            isOpen && h('div', {
              style: {
                width: 4,
                height: 4,
                borderRadius: '50%',
                background: T.accent,
                position: 'absolute',
                right: 3,
                top: 3
              }
            })
          ]
        )
      }

      // Rail mode (wide === false)
      return h(
        'div',
        {
          ref: capsuleRef,
          onClick: handleClick,
          title: tooltipText,
          className: 'dsh-weather-capsule',
          style: {
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 6,
            background: isOpen ? 'var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08))' : 'transparent',
            border: `1px solid ${isOpen ? T.border2 : T.border}`,
            cursor: 'pointer',
            userSelect: 'none',
            boxSizing: 'border-box',
            margin: '0 auto',
            position: 'relative',
            padding: 0
          }
        },
        [
          h('div', {
            style: {
              width: 16,
              height: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }
          }, renderWeatherIcon(weatherIcon, isDay)),
          isOpen && h('div', {
            style: {
              width: 4,
              height: 4,
              borderRadius: '50%',
              background: T.accent,
              position: 'absolute',
              right: 2,
              top: 2
            }
          })
        ]
      )
    }

    // ---------- Component: Overlay Detail Panel ----------
    function WeatherOverlay() {
      const state = useStore()
      const panelRef = useRef(null)
      const searchDebounceRef = useRef(null)
      const { panelState, triggerRect, data, settings, refreshing, isOffline, viewMode, searchQuery, searchResults, searchLoading } = state

      // Outside click handler
      useEffect(() => {
        if (panelState !== 'open') return
        function handleOutside(e) {
          if (panelRef.current && !panelRef.current.contains(e.target)) {
            const trigger = document.querySelector('.dsh-weather-capsule')
            if (trigger && trigger.contains(e.target)) return
            closePanel()
          }
        }
        function handleKey(e) {
          if (e.key === 'Escape') closePanel()
        }
        window.addEventListener('mousedown', handleOutside)
        window.addEventListener('keydown', handleKey)
        return () => {
          window.removeEventListener('mousedown', handleOutside)
          window.removeEventListener('keydown', handleKey)
        }
      }, [panelState])

      if (panelState === 'closed') return null

      const cur = data?.weather?.current
      const cityName = data?.city?.name || '北京'
      const isAuto = data?.city?.isAutoIp ?? settings.autoLocation
      const isDay = cur?.isDay ?? true
      const todayDaily = data?.weather?.daily?.[0]
      const maxT = todayDaily ? `${todayDaily.tempMax}°` : (cur ? `${Math.round(cur.temperature + 3)}°` : '--°')
      const minT = todayDaily ? `${todayDaily.tempMin}°` : (cur ? `${Math.round(cur.temperature - 4)}°` : '--°')

      // Handle search input change
      function handleSearchInput(e) {
        const val = e.target.value
        store.set({ searchQuery: val })
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
        searchDebounceRef.current = setTimeout(() => {
          searchCities(val)
        }, 300)
      }

      return h(
        'div',
        {
          ref: panelRef,
          className: panelState === 'closing' ? 'dsh-weather-panel-exit' : 'dsh-weather-panel-enter',
          style: {
            position: 'fixed',
            left: 12,
            bottom: 54,
            width: 380,
            maxWidth: 'calc(100vw - 24px)',
            maxHeight: 'calc(100vh - 80px)',
            background: T.bgPanel,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: `1px solid ${T.border}`,
            borderRadius: 16,
            boxShadow: T.shadow,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            pointerEvents: panelState === 'closing' ? 'none' : 'auto',
            zIndex: 80,
            fontSize: 12,
            lineHeight: 1.4,
            color: T.label
          }
        },
        [
          // Header Bar
          h('div', {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              borderBottom: `1px solid ${T.border}`,
              background: T.bgSubtle
            }
          }, [
            // Left Title / City
            h('div', {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontWeight: 600,
                fontSize: 13,
                color: T.label
              }
            }, [
              h('span', { style: { color: T.accent, display: 'flex' } }, h(Icons.pin)),
              cityName,
              h('span', {
                style: {
                  fontSize: 10,
                  fontWeight: 500,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: isAuto ? T.accentBg : T.bgHover,
                  color: isAuto ? '#60a5fa' : T.labelSec
                }
              }, isAuto ? 'IP 定位' : '手动设置')
            ]),

            // Right Action Icons
            h('div', {
              style: { display: 'flex', alignItems: 'center', gap: 6 }
            }, [
              // Refresh button
              h('button', {
                title: '刷新天气',
                onClick: () => fetchWeatherData(true),
                disabled: refreshing,
                className: 'dsh-weather-btn',
                style: {
                  background: 'none',
                  border: 'none',
                  padding: '4px',
                  borderRadius: 6,
                  cursor: refreshing ? 'default' : 'pointer',
                  color: T.labelSec,
                  display: 'flex'
                }
              }, h('span', { className: refreshing ? 'dsh-weather-spin' : '' }, h(Icons.refresh))),

              // Switch view button (Search / Detail)
              h('button', {
                title: viewMode === 'detail' ? '搜索/切换城市' : '返回天气详情',
                onClick: () => store.set({ viewMode: viewMode === 'detail' ? 'citySearch' : 'detail' }),
                className: 'dsh-weather-btn',
                style: {
                  background: viewMode === 'citySearch' ? T.accentBg : 'none',
                  border: 'none',
                  padding: '4px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: viewMode === 'citySearch' ? '#60a5fa' : T.labelSec,
                  display: 'flex'
                }
              }, h(viewMode === 'detail' ? Icons.search : Icons.back)),

              // Close button
              h('button', {
                title: '关闭',
                onClick: closePanel,
                className: 'dsh-weather-btn',
                style: {
                  background: 'none',
                  border: 'none',
                  padding: '4px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: T.labelDim,
                  display: 'flex'
                }
              }, h(Icons.close))
            ])
          ]),

          // Body Content
          viewMode === 'detail'
            ? h('div', {
                className: 'dsh-weather-scroll',
                style: {
                  overflowY: 'auto',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  maxHeight: 460
                }
              }, [
                // Offline notice banner
                isOffline && h('div', {
                  style: {
                    background: T.warnBg,
                    border: `1px solid ${T.warn}`,
                    borderRadius: 8,
                    padding: '6px 10px',
                    fontSize: 11,
                    color: T.warn,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }
                }, [
                  '⚠️ 离线模式：网络不可用，正展示最近一次缓存天气'
                ]),

                // Hero Section: Temp & Conditions
                h('div', {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: T.bgCard,
                    border: `1px solid ${T.border}`,
                    borderRadius: 12
                  }
                }, [
                  // Left: Big icon & Temp
                  h('div', {
                    style: { display: 'flex', alignItems: 'center', gap: 12 }
                  }, [
                    h('div', {
                      className: 'dsh-weather-pulse',
                      style: { width: 44, height: 44, display: 'flex' }
                    }, renderWeatherIcon(cur?.icon || 'sun', isDay)),
                    h('div', {}, [
                      h('div', {
                        style: {
                          fontSize: 36,
                          fontWeight: 600,
                          lineHeight: 1,
                          fontVariantNumeric: 'tabular-nums',
                          color: T.label
                        }
                      }, cur ? `${Math.round(cur.temperature)}°` : '--°'),
                      h('div', {
                        style: {
                          fontSize: 11,
                          color: T.labelSec,
                          marginTop: 4
                        }
                      }, `最高 ${maxT} · 最低 ${minT}`)
                    ])
                  ]),

                  // Right: Description & Apparent Temp
                  h('div', {
                    style: { textAlign: 'right' }
                  }, [
                    h('div', {
                      style: { fontSize: 15, fontWeight: 600, color: T.label }
                    }, cur?.weatherText || '晴朗'),
                    h('div', {
                      style: { fontSize: 11, color: T.labelSec, marginTop: 4 }
                    }, cur ? `体感 ${Math.round(cur.apparentTemperature)}°` : '体感 --°'),
                    h('div', {
                      style: {
                        fontSize: 10,
                        color: '#10b981',
                        marginTop: 2,
                        display: 'inline-block',
                        padding: '1px 5px',
                        background: 'rgba(16, 185, 129, 0.12)',
                        borderRadius: 4
                      }
                    }, '空气优良')
                  ])
                ]),

                // 2x2 Weather Metrics Grid
                h('div', {
                  style: {
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8
                  }
                }, [
                  // Humidity
                  h('div', {
                    style: {
                      background: T.bgCard,
                      border: `1px solid ${T.border}`,
                      borderRadius: 10,
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8
                    }
                  }, [
                    h('span', { style: { color: '#0ea5e9', display: 'flex' } }, h(Icons.humidity)),
                    h('div', {}, [
                      h('div', { style: { fontSize: 10, color: T.labelDim } }, '相对湿度'),
                      h('div', { style: { fontSize: 13, fontWeight: 600, color: T.label } }, cur ? `${cur.humidity}%` : '--')
                    ])
                  ]),

                  // Wind Speed
                  h('div', {
                    style: {
                      background: T.bgCard,
                      border: `1px solid ${T.border}`,
                      borderRadius: 10,
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8
                    }
                  }, [
                    h('span', { style: { color: '#38bdf8', display: 'flex' } }, h(Icons.wind)),
                    h('div', {}, [
                      h('div', { style: { fontSize: 10, color: T.labelDim } }, '风速'),
                      h('div', { style: { fontSize: 13, fontWeight: 600, color: T.label } }, cur ? `${cur.windSpeed} km/h` : '--')
                    ])
                  ]),

                  // Precipitation
                  h('div', {
                    style: {
                      background: T.bgCard,
                      border: `1px solid ${T.border}`,
                      borderRadius: 10,
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8
                    }
                  }, [
                    h('span', { style: { color: '#3b82f6', display: 'flex' } }, h(Icons.droplet)),
                    h('div', {}, [
                      h('div', { style: { fontSize: 10, color: T.labelDim } }, '降水量'),
                      h('div', { style: { fontSize: 13, fontWeight: 600, color: T.label } }, cur ? `${cur.precipitation} mm` : '--')
                    ])
                  ]),

                  // Apparent Temp
                  h('div', {
                    style: {
                      background: T.bgCard,
                      border: `1px solid ${T.border}`,
                      borderRadius: 10,
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8
                    }
                  }, [
                    h('span', { style: { color: '#f59e0b', display: 'flex' } }, h(Icons.thermometer)),
                    h('div', {}, [
                      h('div', { style: { fontSize: 10, color: T.labelDim } }, '体感温度'),
                      h('div', { style: { fontSize: 13, fontWeight: 600, color: T.label } }, cur ? `${Math.round(cur.apparentTemperature)}°C` : '--')
                    ])
                  ])
                ]),

                // 24-Hour Forecast
                h('div', {
                  style: {
                    background: T.bgCard,
                    border: `1px solid ${T.border}`,
                    borderRadius: 10,
                    padding: '10px 12px'
                  }
                }, [
                  h('div', {
                    style: {
                      fontSize: 11,
                      fontWeight: 600,
                      color: T.labelSec,
                      marginBottom: 8
                    }
                  }, '未来 24 小时气温趋势'),
                  h('div', {
                    className: 'dsh-weather-scroll',
                    style: {
                      display: 'flex',
                      overflowX: 'auto',
                      gap: 12,
                      paddingBottom: 4
                    }
                  }, (data?.weather?.hourly || []).map((hItem, idx) =>
                    h('div', {
                      key: idx,
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 5,
                        minWidth: 42,
                        flexShrink: 0
                      }
                    }, [
                      h('span', { style: { fontSize: 10, color: T.labelDim } }, hItem.time),
                      h('div', { style: { width: 18, height: 18, display: 'flex' } }, renderWeatherIcon(hItem.icon, true)),
                      h('span', { style: { fontSize: 11, fontWeight: 600, color: T.label } }, `${hItem.temperature}°`),
                      h('span', {
                        style: {
                          fontSize: 9,
                          color: hItem.precipitationProbability > 0 ? '#38bdf8' : T.labelDim
                        }
                      }, `${hItem.precipitationProbability}%`)
                    ])
                  ))
                ]),

                // 7-Day Forecast
                h('div', {
                  style: {
                    background: T.bgCard,
                    border: `1px solid ${T.border}`,
                    borderRadius: 10,
                    padding: '10px 12px'
                  }
                }, [
                  h('div', {
                    style: {
                      fontSize: 11,
                      fontWeight: 600,
                      color: T.labelSec,
                      marginBottom: 8
                    }
                  }, '未来 7 天天气预报'),
                  h('div', {
                    style: { display: 'flex', flexDirection: 'column', gap: 7 }
                  }, (data?.weather?.daily || []).map((dItem, idx) =>
                    h('div', {
                      key: idx,
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: 11
                      }
                    }, [
                      // Weekday & text
                      h('div', {
                        style: { display: 'flex', alignItems: 'center', gap: 8, width: 110 }
                      }, [
                        h('span', { style: { fontWeight: 500, color: T.label, width: 32 } }, dItem.weekday),
                        h('div', { style: { width: 16, height: 16, display: 'flex' } }, renderWeatherIcon(dItem.icon, true)),
                        h('span', { style: { color: T.labelSec, fontSize: 10 } }, dItem.weatherText)
                      ]),

                      // Temp range bar
                      h('div', {
                        style: {
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          gap: 8
                        }
                      }, [
                        h('span', { style: { color: T.labelDim, width: 22, textAlign: 'right' } }, `${dItem.tempMin}°`),
                        h('div', {
                          style: {
                            width: 60,
                            height: 4,
                            borderRadius: 2,
                            background: 'linear-gradient(90deg, #38bdf8 0%, #f59e0b 100%)',
                            opacity: 0.7
                          }
                        }),
                        h('span', { style: { color: T.label, fontWeight: 600, width: 22, textAlign: 'right' } }, `${dItem.tempMax}°`)
                      ])
                    ])
                  ))
                ])
              ])
            : // City Search & Selection View
              h('div', {
                className: 'dsh-weather-scroll',
                style: {
                  overflowY: 'auto',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  maxHeight: 460
                }
              }, [
                // Restore Auto-Location Button
                h('button', {
                  onClick: restoreAutoLocation,
                  className: 'dsh-weather-btn',
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: `1px solid ${settings.autoLocation ? T.accent : T.border2}`,
                    background: settings.autoLocation ? T.accentBg : T.bgSubtle,
                    color: settings.autoLocation ? '#60a5fa' : T.label,
                    fontWeight: 500,
                    cursor: 'pointer'
                  }
                }, [
                  h(Icons.pin),
                  '恢复当前 IP 自动定位'
                ]),

                // Search Input Box
                h('div', {
                  style: {
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center'
                  }
                }, [
                  h('span', {
                    style: {
                      position: 'absolute',
                      left: 10,
                      color: T.labelDim,
                      display: 'flex'
                    }
                  }, searchLoading ? h('span', { className: 'dsh-weather-spin' }, h(Icons.refresh)) : h(Icons.search)),
                  h('input', {
                    type: 'text',
                    value: searchQuery,
                    onChange: handleSearchInput,
                    placeholder: '搜索全球城市 (中文 / 拼音 / 英文)...',
                    style: {
                      width: '100%',
                      padding: '8px 10px 8px 32px',
                      borderRadius: 8,
                      background: T.bgSubtle,
                      border: `1px solid ${T.border2}`,
                      color: T.label,
                      fontSize: 12,
                      outline: 'none',
                      boxSizing: 'border-box'
                    }
                  })
                ]),

                // Search Results List
                searchResults && searchResults.length > 0 && h('div', {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    background: T.bgCard,
                    borderRadius: 8,
                    padding: '6px',
                    border: `1px solid ${T.border}`
                  }
                }, searchResults.map((item, idx) =>
                  h('div', {
                    key: idx,
                    onClick: () => selectCity(item),
                    className: 'dsh-weather-btn',
                    style: {
                      padding: '8px 10px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 12
                    }
                  }, [
                    h('span', { style: { fontWeight: 500, color: T.label } }, item.name),
                    h('span', { style: { color: T.labelDim, fontSize: 11 } }, [
                      item.admin1 ? `${item.admin1}, ` : '',
                      item.country
                    ])
                  ])
                )),

                // Popular Cities Chips
                h('div', {}, [
                  h('div', {
                    style: {
                      fontSize: 11,
                      fontWeight: 600,
                      color: T.labelDim,
                      marginBottom: 8
                    }
                  }, '热门城市快捷选择'),
                  h('div', {
                    style: {
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 6
                    }
                  }, POPULAR_CITIES.map((c, idx) =>
                    h('button', {
                      key: idx,
                      onClick: () => selectCity(c),
                      className: 'dsh-weather-chip',
                      style: {
                        padding: '5px 10px',
                        borderRadius: 6,
                        border: `1px solid ${T.border2}`,
                        background: (settings.manualCity?.name === c.name && !settings.autoLocation) ? T.accentBg : T.bgSubtle,
                        color: (settings.manualCity?.name === c.name && !settings.autoLocation) ? '#60a5fa' : T.label,
                        fontSize: 11,
                        cursor: 'pointer'
                      }
                    }, c.name)
                  ))
                ])
              ])
        ]
      )
    }

    // ---------- Plugin Apply Entrypoint ----------
    function apply(ctx) {
      // 1. Inject Stylesheet into Document Head
      ctx.effect(() => {
        const el = document.createElement('style')
        el.id = 'dsh-weather-styles'
        el.textContent = CSS
        document.head.appendChild(el)
        return () => el.remove()
      })

      // 2. Register Sidebar Footer Action Capsule (order: -100 ensures strictly topmost position)
      ctx.effect(() =>
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'dsh-weather-status', order: -100 },
            (props) => h(WeatherCapsule, props)
          )
        )
      )

      // 3. Register Shell Overlay Floating Panel (order: -100)
      ctx.effect(() =>
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'dsh-weather-status-overlay', order: -100 },
            () => h(WeatherOverlay)
          )
        )
      )
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  }
})
