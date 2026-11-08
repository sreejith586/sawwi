// Small stroke icons on a 20px grid, colored by currentColor.

type IconProps = { className?: string };

function Icon({ className = "size-[18px]", viewBox = "0 0 20 20", strokeWidth = 1.6, children }: IconProps & { viewBox?: string; strokeWidth?: number; children: React.ReactNode }) {
  return (
    <svg aria-hidden viewBox={viewBox} className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 8.6 10 3l7 5.6V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1V8.6Z" />
  </Icon>
);

export const RunsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5.5h12M4 10h12M4 14.5h7" />
    <path d="m13.5 14.2 1.4 1.4 2.6-2.8" />
  </Icon>
);

export const TemplatesIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="5.5" height="5.5" rx="1.2" />
    <rect x="11.5" y="3" width="5.5" height="5.5" rx="1.2" />
    <rect x="3" y="11.5" width="5.5" height="5.5" rx="1.2" />
    <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.2" />
  </Icon>
);

export const CalendarIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4.5" width="14" height="12.5" rx="1.6" />
    <path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4" />
  </Icon>
);

export const AutomationIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11 2.5 4.5 11H10l-1 6.5L15.5 9H10l1-6.5Z" />
  </Icon>
);

export const InvoiceIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 2.8h7.5L15.5 6v11.2H5z" />
    <path d="M12.5 2.8V6h3M7.5 9.5h5M7.5 12.5h5M7.5 15h3" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 4.5v11M4.5 10h11" />
  </Icon>
);

export const PanelIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.75" y="3.5" width="14.5" height="13" rx="2" />
    <path d="M7.75 3.5v13" />
  </Icon>
);

export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 5 10 10M15 5 5 15" />
  </Icon>
);

export const ChatIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 3.5h11a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5H9l-3.6 2.8a.4.4 0 0 1-.65-.32V14H4.5A1.5 1.5 0 0 1 3 12.5V5a1.5 1.5 0 0 1 1.5-1.5Z" />
  </Icon>
);

export const UserIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="7" r="3.2" />
    <path d="M3.8 16.5a6.2 6.2 0 0 1 12.4 0" />
  </Icon>
);

// Gear (outline after Lucide's "settings", ISC licence), drawn on a 24px grid.
export const SettingsIcon = (p: IconProps) => (
  <Icon {...p} viewBox="0 0 24 24" strokeWidth={1.9}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const ChevronsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6.5 8 3.5-3.5L13.5 8M6.5 12l3.5 3.5 3.5-3.5" />
  </Icon>
);
