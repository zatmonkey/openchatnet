import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="OpenChatNet home">
      <svg
        className="brand-mark"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M11 4 7 28M23 4l-4 24M3 11h26M1 21h26"
          stroke="currentColor"
          strokeWidth="4"
        />
      </svg>
      <span>
        openchatnet<span className="brand-period">.</span>
      </span>
    </Link>
  );
}
