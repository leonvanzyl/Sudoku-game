"use client";

import { memo } from "react";

export interface NumberPadProps {
  /** Called with 1-9 for digits, 0 for erase. */
  onInput: (value: number) => void;
  disabled?: boolean;
}

const btnBase =
  "btn-ghost tap-scale aspect-square min-h-11 rounded-xl font-mono text-xl font-bold sm:text-2xl";

/**
 * Touch-friendly digit pad: 1-9 plus erase. Press feedback is the pure-CSS
 * .tap-scale rule; memoized because both props are referentially stable, so
 * parent re-renders (timer, opponent traffic) skip all ten buttons.
 */
const NumberPad = memo(function NumberPad({ onInput, disabled = false }: NumberPadProps) {
  return (
    <div className="grid w-full max-w-md grid-cols-5 gap-2">
      {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onInput(n)}
          className={`${btnBase} text-cyan-100 hover:text-white disabled:opacity-30`}
          aria-label={`Enter ${n}`}
        >
          {n}
        </button>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onInput(0)}
        className={`${btnBase} text-pink-300 hover:text-pink-200 disabled:opacity-30`}
        aria-label="Erase"
        title="Erase (Backspace)"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mx-auto h-6 w-6"
        >
          <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z" />
          <path d="m12 9 6 6" />
          <path d="m18 9-6 6" />
        </svg>
      </button>
    </div>
  );
});

export default NumberPad;
