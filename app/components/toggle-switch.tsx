"use client";

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  title?: string;
  /** ON のときの色（トグルごとに変えて見分けやすくする）。既定は Jev 判定と同じ緑 */
  onColorClass?: string;
  className?: string;
  disabled?: boolean;
};

/** ON/OFF のスイッチ（チェックボックスの代わり）。ラベルは短く、意味は title で補う。 */
export function ToggleSwitch({
  checked,
  onChange,
  label,
  title,
  onColorClass = "bg-emerald-500",
  className = "text-sm text-zinc-600 dark:text-zinc-400",
  disabled = false,
}: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      title={title}
      className={`flex items-center gap-2 disabled:opacity-40 ${className}`}
    >
      <span
        aria-hidden
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? onColorClass : "bg-zinc-300 dark:bg-white/20"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
      {label}
    </button>
  );
}
