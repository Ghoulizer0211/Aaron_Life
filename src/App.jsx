import { useState, useEffect } from 'react'
import Header from './components/Header'
import BottomNav from './components/BottomNav'
import Schedule from './pages/Schedule'
import Health from './pages/Health'
import Finance from './pages/Finance'
import Settings from './pages/Settings'
import LockScreen from './components/LockScreen'
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
    const localCred = localStorage.getItem('aaron_security_cred_id')
    const sessionUnlocked = !!sessionStorage.getItem('aaron_unlocked')

    // Abort if server takes > 4 seconds (avoids hanging on unreachable server)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)

    fetch('/api/security', { signal: controller.signal })
      .then(r => r.json())
      .then(d => {
        // Always clear any cross-device cred_id that may have been wrongly synced
        // Biometric credentials are device-specific and must never be shared
        if (!localCred && localStorage.getItem('aaron_security_cred_id')) {
          localStorage.removeItem('aaron_security_cred_id')
        }

        // Desktop migration: local has hash but server doesn't → push up
        if (localHash && !d.pin_hash) {
          fetch('/api/security/pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin_hash: localHash }),
          }).catch(() => {})
          if (localCred && !d.cred_id) {
            fetch('/api/security/biometric', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cred_id: localCred }),
            }).catch(() => {})
          }
        }

        // Cross-device: server has hash but local doesn't → this is a different device
        // Pull the PIN hash, but ALWAYS wipe any stale cred_id (biometrics are device-specific)
        if (d.pin_hash && !localHash) {
          localStorage.setItem('aaron_security_pin_hash', d.pin_hash)
          localStorage.removeItem('aaron_security_cred_id')  // never inherit another device's credential
          if (!sessionUnlocked) setLocked(true)
        }

        // If server has no cred_id, also clear any leftover local cred_id
        if (!d.cred_id) {
          localStorage.removeItem('aaron_security_cred_id')
        }
      })
      .catch(() => { /* server unreachable — keep current state */ })
      .finally(() => clearTimeout(timeout))
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
