"use client";

import { motion } from "framer-motion";

export interface NumberPadProps {
  /** Called with 1-9 for digits, 0 for erase. */
  onInput: (value: number) => void;
  disabled?: boolean;
}

/** Touch-friendly digit pad: 1-9 plus erase. */
export default function NumberPad({ onInput, disabled = false }: NumberPadProps) {
  return (
    <div className="grid w-full max-w-md grid-cols-5 gap-2">
      {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
        <motion.button
          key={n}
          type="button"
          whileTap={{ scale: 0.9 }}
          disabled={disabled}
          onClick={() => onInput(n)}
          className="btn-ghost aspect-square min-h-11 rounded-xl font-mono text-xl font-bold text-cyan-100 transition hover:text-white disabled:opacity-30 sm:text-2xl"
          aria-label={`Enter ${n}`}
        >
          {n}
        </motion.button>
      ))}
      <motion.button
        type="button"
        whileTap={{ scale: 0.9 }}
        disabled={disabled}
        onClick={() => onInput(0)}
        className="btn-ghost aspect-square min-h-11 rounded-xl text-pink-300 transition hover:text-pink-200 disabled:opacity-30"
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
      </motion.button>
    </div>
  );
}
