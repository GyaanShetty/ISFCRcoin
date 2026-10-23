/**
 * The ISFCRcoin mark: three blocks stacked and offset, like a chain seen from the side.
 * Back to front: white, blue, orange, the app's three tile colours. With `animate`, the
 * blocks drop in one after another, the way a chain grows.
 */
export function Logo({ size = 36, animate = false }: { size?: number; animate?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={`logo ${animate ? 'logo-anim' : ''}`} role="img" aria-label="ISFCRcoin">
      <rect className="lb lb3" x="30" y="6" width="27" height="27" rx="8" fill="#f2f2f4" />
      <rect className="lb lb2" x="18.5" y="18.5" width="27" height="27" rx="8" fill="#4257f5" stroke="#0a0a0b" strokeWidth="3" />
      <rect className="lb lb1" x="7" y="31" width="27" height="27" rx="8" fill="#ff4a1c" stroke="#0a0a0b" strokeWidth="3" />
      <path className="lb lb1" d="M15 44.5h11" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  )
}

/** Logo plus wordmark. */
export function Brand({ size = 32 }: { size?: number }) {
  return (
    <span className="brand">
      <Logo size={size} />
      <span className="brand-word">ISFCR<span>coin</span></span>
    </span>
  )
}
