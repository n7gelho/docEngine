export function AviatorBrandMark({ size = 34 }: { size?: number }) {
  return (
    <span
      className="brand-mark inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg viewBox="0 0 40 40" width={size * 0.65} height={size * 0.65}>
        <g
          fill="none"
          stroke="var(--primary)"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 27 L20 11 L33 27" />
          <path d="M13 30 L20 21 L27 30" />
        </g>
      </svg>
    </span>
  );
}
