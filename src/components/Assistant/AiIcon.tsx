export function AiIcon({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Headphone band */}
      <path
        d="M 22 52 C 20 18 80 18 78 52"
        stroke="var(--brand-blue)"
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
      />

      {/* Left ear cup */}
      <circle cx="18" cy="56" r="14" fill="var(--brand-light)" />
      <circle cx="18" cy="56" r="9" fill="var(--brand-blue)" />
      <circle cx="18" cy="49" r="3" fill="var(--brand-navy)" />

      {/* Right ear cup */}
      <circle cx="82" cy="56" r="14" fill="var(--brand-light)" />
      <circle cx="82" cy="56" r="9" fill="var(--brand-blue)" />
      <circle cx="82" cy="49" r="3" fill="var(--brand-navy)" />

      {/* Robot head */}
      <circle cx="50" cy="57" r="24" fill="var(--brand-navy)" />
      <circle cx="50" cy="55" r="22" fill="var(--brand-blue)" />

      {/* Face highlight */}
      <ellipse cx="50" cy="58" rx="15" ry="13" fill="var(--brand-light)" />

      {/* Eyes */}
      <circle cx="44" cy="54" r="4.5" fill="white" />
      <circle cx="56" cy="54" r="4.5" fill="white" />
      <circle cx="44" cy="54" r="2.5" fill="var(--brand-navy)" />
      <circle cx="56" cy="54" r="2.5" fill="var(--brand-navy)" />
      <circle cx="45" cy="53" r="1" fill="white" />
      <circle cx="57" cy="53" r="1" fill="white" />

      {/* Smile */}
      <path
        d="M 43 63 Q 50 70 57 63"
        stroke="var(--brand-navy)"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />

      {/* Mic connector */}
      <rect x="12" y="68" width="4" height="9" rx="2" fill="var(--brand-blue)" />
      <circle cx="14" cy="79" r="3.5" fill="var(--brand-light)" />
    </svg>
  )
}
