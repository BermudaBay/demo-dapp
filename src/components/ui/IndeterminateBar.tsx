"use client";

type IndeterminateBarProps = {
  className?: string;
  label?: string;
};

/** Indeterminate progress track for dashboard loading states. */
export default function IndeterminateBar({ className = "", label }: IndeterminateBarProps) {
  return (
    <div
      className={`h-1 rounded-full bg-[var(--border)] overflow-hidden ${className}`}
      role="progressbar"
      aria-valuetext={label ?? "Loading"}
      aria-busy="true"
    >
      <div className="h-full w-[42%] rounded-full bg-[var(--primary)] animate-indeterminate-slide" />
    </div>
  );
}
