export default function Brand() {
  return (
    <a
      className="brand"
      href="https://arbiterforge.com/"
      target="_blank"
      rel="noreferrer"
      aria-label="ArbiterForge home"
    >
      <svg
        className="brand-mark"
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
      >
        <rect width="40" height="40" rx="12" fill="#243d36" />
        <path
          d="M10 29V13l10 12 10-12v16"
          stroke="#b1e7d3"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="20" cy="9" r="1.6" fill="#b1e7d3" />
      </svg>
      <span>
        <strong>Meridian</strong>
        <small>BY ARBITERFORGE</small>
      </span>
    </a>
  );
}
