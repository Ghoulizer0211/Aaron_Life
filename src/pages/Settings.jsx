import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { PinSetupSheet, PinVerifySheet, registerBiometric } from '../components/LockScreen'
import { supabase, sb } from '../lib/supabase'
import './Page.css'
import './Settings.css'

// ─── localStorage hooks ───────────────────────────────────────────────────────

function useProfile() {
  const [profile, setProfile] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aaron_profile') || 'null') || { name: 'Aaron', tagline: 'Personal dashboard' } }
    catch { return { name: 'Aaron', tagline: 'Personal dashboard' } }
  })
  const save = (updates) => {
    const next = { ...profile, ...updates }
    setProfile(next)
    localStorage.setItem('aaron_profile', JSON.stringify(next))
  }
  return { profile, save }
}

function usePrefs() {
  const [prefs, setPrefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aaron_prefs') || 'null') || { notifications: true, currency: 'USD', startOfWeek: 'Monday' } }
    catch { return { notifications: true, currency: 'USD', startOfWeek: 'Monday' } }
  })
  const save = (updates) => {
    const next = { ...prefs, ...updates }
    setPrefs(next)
    localStorage.setItem('aaron_prefs', JSON.stringify(next))
  }
  return { prefs, save }
}

// ─── Profile edit sheet ───────────────────────────────────────────────────────

function ProfileSheet({ profile, onSave, onClose }) {
  const [name,    setName]    = useState(profile.name)
  const [tagline, setTagline] = useState(profile.tagline)

  const handleSave = () => {
    if (!name.trim()) return
    onSave({ name: name.trim(), tagline: tagline.trim() })
    onClose()
  }

  return createPortal(
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <div className="modal-handle" />
        <div className="modal-header">
          <span className="modal-title">Edit Profile</span>
          <button className="modal-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Name</label>
            <input
              className="form-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Tagline <span className="form-optional">(optional)</span></label>
            <input
              className="form-input"
              value={tagline}
              onChange={e => setTagline(e.target.value)}
              placeholder="e.g. Personal dashboard"
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-save" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Picker sheet ─────────────────────────────────────────────────────────────

function PickerSheet({ title, options, value, onSelect, onClose }) {
  return createPortal(
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <div className="modal-handle" />
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="picker-list">
          {options.map(opt => (
            <button
              key={opt}
              className={`picker-item${value === opt ? ' picker-selected' : ''}`}
              onClick={() => { onSelect(opt); onClose() }}
            >
              <span>{opt}</span>
              {value === opt && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Confirm sheet ────────────────────────────────────────────────────────────

function ConfirmSheet({ message, confirmLabel, onConfirm, onClose }) {
  return createPortal(
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <div className="modal-handle" />
        <div className="confirm-body">
          <p className="confirm-message">{message}</p>
          <div className="confirm-actions">
            <button className="confirm-cancel" onClick={onClose}>Cancel</button>
            <button className="confirm-ok danger" onClick={() => { onConfirm(); onClose() }}>{confirmLabel}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Settings() {
  const { profile, save: saveProfile } = useProfile()
  const { prefs,   save: savePrefs   } = usePrefs()
  const [sheet, setSheet] = useState(null)  // 'profile' | 'currency' | 'startOfWeek' | 'clearCache' | 'pinSetup' | 'pinDisable' | 'pinVerifyBio'

  // Security state
  const [passcodeOn,  setPasscodeOn]  = useState(() => !!localStorage.getItem('aaron_security_pin_hash'))
  const [biometricOn, setBiometricOn] = useState(() => !!localStorage.getItem('aaron_security_cred_id'))
  const [bioAvail,    setBioAvail]    = useState(false)

  useEffect(() => {
    try {
      const fn = PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable
      if (typeof fn === 'function') {
        fn.call(PublicKeyCredential).then(setBioAvail).catch(() => {})
      }
    } catch {
      // WebAuthn not available (HTTP or unsupported browser)
    }
  }, [])

  const disablePasscode = () => {
    localStorage.removeItem('aaron_security_pin_hash')
    localStorage.removeItem('aaron_security_cred_id')
    sessionStorage.removeItem('aaron_unlocked')
    setPasscodeOn(false)
    setBiometricOn(false)
    if (supabase) {
      sb(supabase.from('settings').delete().eq('key', 'pin_hash'))
    } else {
      fetch('/api/security/pin', { method: 'DELETE' }).catch(() => {})
    }
  }

  const handleBiometricToggle = async () => {
    if (biometricOn) {
      localStorage.removeItem('aaron_security_cred_id')
      setBiometricOn(false)
      fetch('/api/security/biometric', { method: 'DELETE' }).catch(() => {})
      return
    }
    try {
      const credId = await registerBiometric(profile.name)
      setBiometricOn(true)
      fetch('/api/security/biometric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cred_id: credId }),
      }).catch(() => {})
    } catch (err) {
      alert(err.message || 'Biometric registration failed')
    }
  }

  const initials = profile.name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  const handleExport = () => {
    const data = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key.startsWith('aaron_')) {
        try { data[key] = JSON.parse(localStorage.getItem(key)) }
        catch { data[key] = localStorage.getItem(key) }
      }
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `aaron-life-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleClearCache = () => {
    const keys = []
    for (let i = 0; i < localStorage.length; i++) {
      if (localStorage.key(i).startsWith('aaron_')) keys.push(localStorage.key(i))
    }
    keys.forEach(k => localStorage.removeItem(k))
    window.location.reload()
  }

  return (
    <div className="page">

      {/* Profile card */}
      <button className="settings-profile card" onClick={() => setSheet('profile')}>
        <div className="profile-avatar">{initials}</div>
        <div className="profile-info">
          <span className="profile-name">{profile.name}</span>
          <span className="profile-sub">{profile.tagline || 'Personal dashboard'}</span>
        </div>
        <svg className="profile-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>

      {/* App section */}
      <section className="page-section">
        <h2 className="section-title">App</h2>
        <div className="card-list">

          <button className="card settings-row" onClick={() => savePrefs({ notifications: !prefs.notifications })}>
            <span className="settings-icon">🔔</span>
            <span className="settings-label">Notifications</span>
            <span className="settings-right">
              <span className={`toggle ${prefs.notifications ? 'on' : ''}`} />
            </span>
          </button>

          <button className="card settings-row" onClick={() => setSheet('currency')}>
            <span className="settings-icon">💱</span>
            <span className="settings-label">Currency</span>
            <span className="settings-right">
              <span className="settings-value">{prefs.currency}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="chevron">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </span>
          </button>

          <button className="card settings-row" onClick={() => setSheet('startOfWeek')}>
            <span className="settings-icon">📅</span>
            <span className="settings-label">Start of week</span>
            <span className="settings-right">
              <span className="settings-value">{prefs.startOfWeek}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="chevron">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </span>
          </button>

        </div>
      </section>

      {/* Security section */}
      <section className="page-section">
        <h2 className="section-title">Security</h2>
        <div className="card-list">

          <button
            className="card settings-row"
            onClick={() => passcodeOn ? setSheet('pinDisable') : setSheet('pinSetup')}
          >
            <span className="settings-icon">🔒</span>
            <span className="settings-label">Passcode</span>
            <span className="settings-right">
              <span className={`toggle ${passcodeOn ? 'on' : ''}`} />
            </span>
          </button>

          <button
            className="card settings-row"
            onClick={passcodeOn ? handleBiometricToggle : undefined}
            disabled={!passcodeOn || !bioAvail}
            style={{ opacity: (!passcodeOn || !bioAvail) ? 0.4 : 1 }}
          >
            <span className="settings-icon">🪪</span>
            <span className="settings-label">Face ID / Biometrics</span>
            <span className="settings-right">
              {!bioAvail && passcodeOn && <span className="settings-value">Not available</span>}
              {bioAvail && <span className={`toggle ${biometricOn ? 'on' : ''}`} />}
            </span>
          </button>

        </div>
        {!passcodeOn && (
          <p className="settings-hint">Enable Passcode first to use Face ID / Biometrics.</p>
        )}
      </section>

      {/* Data section */}
      <section className="page-section">
        <h2 className="section-title">Data</h2>
        <div className="card-list">

          <button className="card settings-row" onClick={handleExport}>
            <span className="settings-icon">📤</span>
            <span className="settings-label">Export data</span>
            <span className="settings-right">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="chevron">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </span>
          </button>

          <button className="card settings-row danger-row" onClick={() => setSheet('clearCache')}>
            <span className="settings-icon">🗑️</span>
            <span className="settings-label danger-label">Clear all data</span>
            <span className="settings-right">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="chevron">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </span>
          </button>

        </div>
      </section>

      {/* About section */}
      <section className="page-section">
        <h2 className="section-title">About</h2>
        <div className="card-list">
          <div className="card settings-row">
            <span className="settings-icon">ℹ️</span>
            <span className="settings-label">Version</span>
            <span className="settings-right">
              <span className="settings-value">1.0.0</span>
            </span>
          </div>
        </div>
      </section>

      {/* Sheets */}
      {sheet === 'profile' && (
        <ProfileSheet profile={profile} onSave={saveProfile} onClose={() => setSheet(null)} />
      )}
      {sheet === 'currency' && (
        <PickerSheet
          title="Currency"
          options={['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']}
          value={prefs.currency}
          onSelect={v => savePrefs({ currency: v })}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'startOfWeek' && (
        <PickerSheet
          title="Start of Week"
          options={['Monday', 'Sunday']}
          value={prefs.startOfWeek}
          onSelect={v => savePrefs({ startOfWeek: v })}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'pinSetup' && (
        <PinSetupSheet
          onDone={(hash) => {
            setPasscodeOn(true)
            if (supabase) {
              sb(supabase.from('settings').upsert({ key: 'pin_hash', value: hash }))
            } else {
              fetch('/api/security/pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin_hash: hash }),
              }).catch(() => {})
            }
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'pinDisable' && (
        <PinVerifySheet
          onVerified={disablePasscode}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'clearCache' && (
        <ConfirmSheet
          message="This will erase all your local data including schedule events, health tokens, and finance connections. This cannot be undone."
          confirmLabel="Clear Everything"
          onConfirm={handleClearCache}
          onClose={() => setSheet(null)}
        />
      )}

    </div>
  )
}
