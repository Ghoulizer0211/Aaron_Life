import { useState, useEffect, useCallback, useRef } from 'react'
import './LockScreen.css'

// ─── Crypto helpers ───────────────────────────────────────────────────────────

async function hashPin(pin) {
  const data = new TextEncoder().encode('aaron_life:' + pin)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function b64ToBuffer(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

async function biometricAuth(credId) {
  return navigator.credentials.get({
    publicKey: {
      challenge:          crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials:   [{ id: b64ToBuffer(credId), type: 'public-key' }],
      userVerification:   'required',
      timeout:            60000,
    },
  })
}

// ─── Keyboard hook ────────────────────────────────────────────────────────────

function useKeyboard(onKey) {
  const ref = useRef(onKey)
  ref.current = onKey
  useEffect(() => {
    const handler = (e) => {
      if (e.key >= '0' && e.key <= '9') ref.current(e.key)
      else if (e.key === 'Backspace') ref.current('⌫')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}

// ─── PIN pad ──────────────────────────────────────────────────────────────────

const PAD = ['1','2','3','4','5','6','7','8','9','','0','⌫']

function PinPad({ pin, onKey, error }) {
  return (
    <div className="lock-pad">
      {/* Dots */}
      <div className="lock-dots">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={`lock-dot${i < pin.length ? ' filled' : ''}${error ? ' error' : ''}`} />
        ))}
      </div>

      {error && <p className="lock-error">{error}</p>}

      {/* Number grid */}
      <div className="pad-grid">
        {PAD.map((k, i) => (
          k === '' ? <span key={i} /> :
          <button
            key={i}
            className={`pad-btn${k === '⌫' ? ' pad-back' : ''}`}
            onClick={() => onKey(k)}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Lock screen ──────────────────────────────────────────────────────────────

export default function LockScreen({ onUnlock }) {
  const [pin,   setPin]   = useState('')
  const [error, setError] = useState('')
  const [biometricAvail, setBiometricAvail] = useState(false)

  const storedHash  = localStorage.getItem('aaron_security_pin_hash')
  const credId      = localStorage.getItem('aaron_security_cred_id')
  const bioEnabled  = !!credId

  // Check biometric availability
  useEffect(() => {
    if (PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then(setBiometricAvail)
        .catch(() => {})
    }
  }, [])

  // Auto-trigger biometric on mount if enabled
  const tryBiometric = useCallback(async () => {
    if (!bioEnabled || !biometricAvail) return
    try {
      await biometricAuth(credId)
      sessionStorage.setItem('aaron_unlocked', '1')
      onUnlock()
    } catch {
      // user cancelled or failed — fall back to PIN silently
    }
  }, [bioEnabled, biometricAvail, credId, onUnlock])

  useEffect(() => {
    if (biometricAvail && bioEnabled) tryBiometric().catch(() => {})
  }, [biometricAvail]) // eslint-disable-line

  // Handle key press (touch or keyboard)
  const handleKey = useCallback(async (k) => {
    if (k === '⌫') {
      setPin(p => p.slice(0, -1))
      setError('')
      return
    }
    const next = pin + k
    setPin(next)
    setError('')

    if (next.length === 6) {
      const hash = await hashPin(next)
      if (hash === storedHash) {
        sessionStorage.setItem('aaron_unlocked', '1')
        onUnlock()
      } else {
        setError('Incorrect passcode')
        setTimeout(() => { setPin(''); setError('') }, 800)
      }
    }
  }, [pin, storedHash, onUnlock])

  useKeyboard(handleKey)

  return (
    <div className="lock-screen">
      <div className="lock-top">
        <div className="lock-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h1 className="lock-title">Aaron's Life</h1>
        <p className="lock-sub">Enter your passcode</p>
      </div>

      <PinPad pin={pin} onKey={handleKey} error={error} />

      {bioEnabled && biometricAvail && (
        <button className="biometric-btn" onClick={tryBiometric}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
            <path d="M12 8c-1.1 0-2 .9-2 2v1c0 1.1.9 2 2 2s2-.9 2-2v-1c0-1.1-.9-2-2-2z"/>
            <path d="M8 16c0-2.2 1.8-4 4-4s4 1.8 4 4"/>
          </svg>
          Use Face ID / Biometrics
        </button>
      )}
    </div>
  )
}

// ─── PIN setup sheet (used in Settings) ───────────────────────────────────────

export function PinSetupSheet({ onDone, onClose }) {
  const [step, setStep] = useState('set')   // 'set' | 'confirm'
  const [first, setFirst] = useState('')
  const [pin,   setPin]   = useState('')
  const [error, setError] = useState('')

  const handleKey = async (k) => {
    if (k === '⌫') { setPin(p => p.slice(0, -1)); setError(''); return }
    const next = pin + k
    setPin(next)
    setError('')

    if (next.length < 6) return

    if (step === 'set') {
      setFirst(next)
      setPin('')
      setStep('confirm')
    } else {
      if (next === first) {
        const hash = await hashPin(next)
        localStorage.setItem('aaron_security_pin_hash', hash)
        onDone(hash)
        onClose()
      } else {
        setError("Passcodes don't match — try again")
        setTimeout(() => { setPin(''); setFirst(''); setStep('set'); setError('') }, 900)
      }
    }
  }

  useKeyboard(handleKey)

  return (
    <div className="pinsetup-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pinsetup-sheet">
        <div className="modal-handle" />
        <div className="pinsetup-header">
          <p className="pinsetup-title">
            {step === 'set' ? 'Enter a 6-digit passcode' : 'Re-enter your passcode'}
          </p>
          <button className="modal-close pinsetup-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <PinPad pin={pin} onKey={handleKey} error={error} />
      </div>
    </div>
  )
}

// ─── PIN verify sheet (used to disable passcode) ──────────────────────────────

export function PinVerifySheet({ onVerified, onClose }) {
  const [pin,   setPin]   = useState('')
  const [error, setError] = useState('')
  const storedHash = localStorage.getItem('aaron_security_pin_hash')

  const handleKey = async (k) => {
    if (k === '⌫') { setPin(p => p.slice(0, -1)); setError(''); return }
    const next = pin + k
    setPin(next)
    setError('')

    if (next.length === 6) {
      const hash = await hashPin(next)
      if (hash === storedHash) {
        onVerified()
        onClose()
      } else {
        setError('Incorrect passcode')
        setTimeout(() => { setPin(''); setError('') }, 800)
      }
    }
  }

  useKeyboard(handleKey)

  return (
    <div className="pinsetup-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pinsetup-sheet">
        <div className="modal-handle" />
        <div className="pinsetup-header">
          <p className="pinsetup-title">Enter your passcode</p>
          <button className="modal-close pinsetup-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <PinPad pin={pin} onKey={handleKey} error={error} />
      </div>
    </div>
  )
}

// ─── Export biometric helpers for Settings ────────────────────────────────────

export { biometricAuth, hashPin }

export async function registerBiometric(profileName = 'Aaron') {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge:   crypto.getRandomValues(new Uint8Array(32)),
      rp:          { name: "Aaron's Life", id: window.location.hostname },
      user:        { id: new TextEncoder().encode('aaron'), name: 'aaron', displayName: profileName },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000,
    },
  })
  const credId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)))
  localStorage.setItem('aaron_security_cred_id', credId)
  return credId
}
