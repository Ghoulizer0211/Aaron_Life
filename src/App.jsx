import { useState, useEffect } from 'react'
import Header from './components/Header'
import BottomNav from './components/BottomNav'
import Schedule from './pages/Schedule'
import Health from './pages/Health'
import Finance from './pages/Finance'
import Settings from './pages/Settings'
import LockScreen from './components/LockScreen'
import { supabase, sb } from './lib/supabase'
import './App.css'

export default function App() {
  const [activeTab, setActiveTab] = useState('schedule')
  const [locked, setLocked] = useState(() => {
    // Resolve immediately — never show a blank screen
    // On HTTP (non-secure context), crypto.subtle is unavailable so PIN can't work — skip lock
    if (!window.isSecureContext) return false
    const hasPin   = !!localStorage.getItem('aaron_security_pin_hash')
    const unlocked = !!sessionStorage.getItem('aaron_unlocked')
    return hasPin && !unlocked
  })

  useEffect(() => {
    // Skip security sync on HTTP — crypto.subtle not available
    if (!window.isSecureContext) return

    const localHash = localStorage.getItem('aaron_security_pin_hash')
    const sessionUnlocked = !!sessionStorage.getItem('aaron_unlocked')

    const applyServerHash = (serverHash) => {
      // Always clear stale biometric credential — device-specific, never shared
      localStorage.removeItem('aaron_security_cred_id')

      if (serverHash && !localHash) {
        // Different device — pull the PIN hash and lock
        localStorage.setItem('aaron_security_pin_hash', serverHash)
        if (!sessionUnlocked) setLocked(true)
      }
      if (!serverHash && localHash) {
        // PIN was disabled on another device — clear locally too
        localStorage.removeItem('aaron_security_pin_hash')
        setLocked(false)
      }
    }

    if (supabase) {
      sb(supabase.from('settings').select('value').eq('key', 'pin_hash').maybeSingle())
        .then(({ data } = {}) => applyServerHash(data?.value || null))
      // Push local hash to Supabase if server doesn't have it yet (migration)
      if (localHash) {
        sb(supabase.from('settings').select('value').eq('key', 'pin_hash').maybeSingle())
          .then(({ data } = {}) => {
            if (!data?.value) {
              sb(supabase.from('settings').upsert({ key: 'pin_hash', value: localHash }))
            }
          })
      }
    } else {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 4000)
      fetch('/api/security', { signal: controller.signal })
        .then(r => r.json())
        .then(d => applyServerHash(d.pin_hash || null))
        .catch(() => {})
        .finally(() => clearTimeout(timeout))
    }
  }, []) // eslint-disable-line

  const renderPage = () => {
    switch (activeTab) {
      case 'schedule': return <Schedule />
      case 'health':   return <Health />
      case 'finance':  return <Finance />
      case 'settings': return <Settings />
      default:         return <Schedule />
    }
  }

  if (locked) return <LockScreen onUnlock={() => setLocked(false)} />

  return (
    <div className="app">
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="app-main">
        <Header activeTab={activeTab} />
        <main className="app-content" data-tab={activeTab}>
          {renderPage()}
        </main>
      </div>
    </div>
  )
}
