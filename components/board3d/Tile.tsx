"use client";

// One sudoku tile: rounded box + floating digit. Deliberately dumb —
// all animation (lift, pulse, emissive) is driven imperatively through the
// TileHandle it registers with BoardTiles, so selection/hover/fx never
// cause React re-renders. A tile only re-renders when its value or the
// color of its digit changes.

import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { RoundedBox, Text } from "@react-three/drei";
import { useGameStore } from "@/lib/store/gameStore";
import { cellPosition, TILE_HEIGHT, TILE_SIZE } from "./layout";

export interface TileHandle {
  group: THREE.Group | null;
  mat: THREE.MeshStandardMaterial | null;
  hovered: boolean;
}

export interface TileProps {
  index: number;
  value: number;
  given: boolean;
  /** Digit tint: white for givens, player color for entries. */
  textColor: string;
  register: (index: number, handle: TileHandle | null) => void;
}

const Tile = memo(function Tile({ index, value, given, textColor, register }: TileProps) {
  const handle = useRef<TileHandle>({ group: null, mat: null, hovered: false });

  useEffect(() => {
    const h = handle.current;
    register(index, h);
    return () => register(index, null);
  }, [index, register]);

  const [x, z] = useMemo(() => cellPosition(index), [index]);

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    useGameStore.getState().selectCell(index);
  };
  const onPointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    handle.current.hovered = true;
    document.body.style.cursor = "pointer";
  };
  const onPointerOut = () => {
    handle.current.hovered = false;
    document.body.style.cursor = "auto";
  };

  return (
    <group
      position={[x, 0, z]}
      ref={(g) => {
        handle.current.group = g;
      }}
    >
      <RoundedBox
        args={[TILE_SIZE, TILE_HEIGHT, TILE_SIZE]}
        radius={0.07}
        smoothness={3}
        onPointerDown={onPointerDown}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
      >
        <meshStandardMaterial
          ref={(m) => {
            handle.current.mat = m;
          }}
          color={value === 0 ? "#151d2e" : given ? "#2a3852" : "#1f2b42"}
          roughness={0.35}
          metalness={0.4}
          emissive="#0f172a"
          emissiveIntensity={0.05}
        />
      </RoundedBox>
      {value !== 0 && (
        <Text
          position={[0, TILE_HEIGHT / 2 + 0.02, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.52}
          color={textColor}
          anchorX="center"
          anchorY="middle"
          // Same-color outline fakes a bold weight without loading extra fonts.
          outlineWidth={given ? 0.024 : 0.014}
          outlineColor={textColor}
          characters="123456789"
        >
          {String(value)}
        </Text>
      )}
    </group>
  );
});

export default Tile;
