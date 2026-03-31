import './Header.css'

const TAB_TITLES = {
  schedule: 'Schedule',
  health:   'Health',
  finance:  'Finance',
  settings: 'Settings',
}

export default function Header({ activeTab }) {
  const today = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric',
  })

  return (
    <header className="header">
      {/* Mobile: show app name + date on left */}
      <div className="header-brand">
        <span className="header-app-name">Aaron's Life</span>
        <span className="header-date">{today}</span>
      </div>

      {/* Section title */}
      <h1 className="header-title">{TAB_TITLES[activeTab]}</h1>

      {/* Desktop: date on right */}
      <span className="header-date-right">{today}</span>
    </header>
  )
}
