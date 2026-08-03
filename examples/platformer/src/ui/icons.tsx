// Inline SVG so the HUD ships no assets and scales with the type.
type IconProps = { readonly className?: string };

export function Heart({ className, filled }: IconProps & { readonly filled: boolean }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path
        d="M12 21s-7.2-4.7-9.4-8.6C.8 9.4 2.4 5.4 6 4.3c2.2-.7 4.6.2 6 2.2 1.4-2 3.8-2.9 6-2.2 3.6 1.1 5.2 5.1 3.4 8.1C19.2 16.3 12 21 12 21z"
        fill={filled ? "#e8382f" : "#1d2f3d"}
        stroke={filled ? "#ff8a80" : "#33556b"}
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function CoinIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
      <circle cx="12" cy="12" fill="#f0a11e" r="10" />
      <circle cx="12" cy="12" fill="#ffd34d" r="7.6" />
      <path
        d="M12 6.6l1.7 3.5 3.8.5-2.8 2.7.7 3.8-3.4-1.8-3.4 1.8.7-3.8-2.8-2.7 3.8-.5z"
        fill="#f0a11e"
      />
    </svg>
  );
}

export function StarIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
      <path
        d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5 6.1 20.6l1.2-6.5L2.5 9.5l6.6-.9z"
        fill="#ffd23f"
        stroke="#e09a12"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
      <circle cx="12" cy="12" fill="#e9f4fb" r="9.4" stroke="#7d96a8" strokeWidth="1.6" />
      <path d="M12 6.6V12l3.6 2.4" stroke="#22384a" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

export function GemIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
      <path d="M12 2.4l8 6-8 13.2-8-13.2z" fill="#4fc3f7" stroke="#1c7ba8" strokeWidth="1.5" />
      <path d="M12 2.4l3.4 6-3.4 13.2-3.4-13.2z" fill="#a7e4ff" opacity="0.8" />
    </svg>
  );
}

export function FoxAvatar({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 48 48">
      <circle cx="24" cy="24" fill="#2f8fe0" r="22" stroke="#ffffff" strokeWidth="3.5" />
      <path d="M10 16l3 9 6-4zM38 16l-3 9-6-4z" fill="#f2a13c" />
      <circle cx="24" cy="26" fill="#f2a13c" r="13" />
      <ellipse cx="24" cy="32" fill="#fff2df" rx="7" ry="5.4" />
      <circle cx="19" cy="24" fill="#241a12" r="2" />
      <circle cx="29" cy="24" fill="#241a12" r="2" />
      <circle cx="24" cy="30.5" fill="#241a12" r="1.8" />
    </svg>
  );
}
