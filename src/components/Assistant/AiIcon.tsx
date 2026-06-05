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
        stroke="#CC7A00"
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
      />

      {/* Left ear cup */}
      <circle cx="18" cy="56" r="14" fill="#F5A623" />
      <circle cx="18" cy="56" r="9" fill="#E8920A" />
      <circle cx="18" cy="49" r="3" fill="#E84040" />

      {/* Right ear cup */}
      <circle cx="82" cy="56" r="14" fill="#F5A623" />
      <circle cx="82" cy="56" r="9" fill="#E8920A" />
      <circle cx="82" cy="49" r="3" fill="#E84040" />

      {/* Robot head */}
      <circle cx="50" cy="57" r="24" fill="#4A5980" />
      <circle cx="50" cy="55" r="22" fill="#6B7FC4" />

      {/* Face highlight */}
      <ellipse cx="50" cy="58" rx="15" ry="13" fill="#8A9DD4" />

      {/* Eyes */}
      <circle cx="44" cy="54" r="4.5" fill="white" />
      <circle cx="56" cy="54" r="4.5" fill="white" />
      <circle cx="44" cy="54" r="2.5" fill="#1E2A50" />
      <circle cx="56" cy="54" r="2.5" fill="#1E2A50" />
      <circle cx="45" cy="53" r="1" fill="white" />
      <circle cx="57" cy="53" r="1" fill="white" />

      {/* Smile */}
      <path
        d="M 43 63 Q 50 70 57 63"
        stroke="#1E2A50"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />

      {/* Mic connector */}
      <rect x="12" y="68" width="4" height="9" rx="2" fill="#E8920A" />
      <circle cx="14" cy="79" r="3.5" fill="#F5A623" />
    </svg>
  )
}
