type Page = "home" | "calendar" | "procurement" | "deliveries" | "security" | "reports" | "settings" | "alexa";

interface Props {
  active: Page;
  onNavigate: (page: Page) => void;
  /** Whether the sidebar drawer is open (mobile only) */
  mobileOpen?: boolean;
  /** Called when the user closes the sidebar on mobile */
  onMobileClose?: () => void;
}

const NAV: Array<{ id: Page; label: string; icon: React.ReactNode; section?: string }> = [
  {
    id: "home",
    label: "Command Center",
    section: "Workspace",
    icon: (
      <svg viewBox="0 0 24 24">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    id: "calendar",
    label: "Calendar",
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    id: "procurement",
    label: "Procurement",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
    ),
  },
  {
    id: "deliveries",
    label: "Deliveries",
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="1" y="3" width="15" height="13" />
        <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
  },
  {
    id: "security",
    label: "Security",
    section: "Operations",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    id: "reports",
    label: "Reports",
    icon: (
      <svg viewBox="0 0 24 24">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    section: "Account",
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    id: "alexa" as Page,
    label: "Alexa+ Simulator",
    section: "Hackathon",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
    ),
  },
];

export function Sidebar({ active, onNavigate, mobileOpen = false, onMobileClose }: Props) {
  // Group nav items by section
  const sections: Array<{ label: string | undefined; items: typeof NAV }> = [];
  let current: typeof NAV = [];
  let currentLabel: string | undefined;

  for (const item of NAV) {
    if (item.section !== undefined && item.section !== currentLabel) {
      if (current.length > 0) sections.push({ label: currentLabel, items: current });
      currentLabel = item.section;
      current = [item];
    } else {
      current.push(item);
    }
  }
  if (current.length > 0) sections.push({ label: currentLabel, items: current });

  function handleNavigate(id: Page) {
    onNavigate(id);
    // Close mobile drawer when a page is selected
    onMobileClose?.();
  }

  return (
    <nav className={`sidebar${mobileOpen ? " open" : ""}`}>
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="sidebar-brand-inner">
          <div className="sidebar-logo-icon">
            <svg viewBox="0 0 24 24">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div className="sidebar-brand-text">
            <div className="sidebar-wordmark">Arclio</div>
            <div className="sidebar-tagline">AI Operations</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="sidebar-nav">
        {sections.map((sec) => (
          <div key={sec.label ?? "default"} className="sidebar-section">
            {sec.label && (
              <div className="sidebar-section-label">{sec.label}</div>
            )}
            {sec.items.map((item) => (
              <button
                key={item.id}
                className={`sidebar-nav-item${active === item.id ? " active" : ""}`}
                onClick={() => handleNavigate(item.id)}
              >
                <span className="sidebar-nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* User footer */}
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-avatar">P</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">Prince</div>
            <div className="sidebar-user-role">Administrator</div>
          </div>
        </div>
      </div>
    </nav>
  );
}
