"use client";

// 3D sudoku board — default export, no props. Reads the exact same
// useGameStore state as the 2D board; GameShell mounts this via
// next/dynamic (ssr: false) when viewMode === "3d". Number entry stays with
// GameShell's keyboard handler + number pad outside this canvas — the 3D
// board only handles cell selection and rendering.

import { Canvas } from "@react-three/fiber";
import SudokuScene from "./SudokuScene";

export default function Board3D() {
  return (
    <div className="relative h-full min-h-[420px] w-full overflow-hidden rounded-2xl">
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 9.5, 10.5], fov: 40 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        style={{ background: "#060a13", touchAction: "none" }}
      >
        <SudokuScene />
      </Canvas>
    </div>
  );
}
