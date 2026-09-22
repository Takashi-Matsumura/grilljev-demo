/**
 * 開閉（`<details>`）の印。ブラウザ既定の三角マーカーの代わりに使う。
 * 親の `<details>` に `group` クラスを付けると、開いているときに 90° 回って倒れる
 * （閉: ▷ 相当 / 開: ▽ 相当）。
 */
export function DisclosureIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`inline shrink-0 align-middle transition-transform duration-150 group-open:rotate-90 ${className}`}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
