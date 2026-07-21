"use client";

// Scene chrome + choreography: lights, fog, reflective ground, glowing box
// dividers, idle sway, cell-wrong shake, constrained orbit controls and a
// gentle camera-target drift toward the selected cell.

import { useEffect, useMemo, useRef, type ComponentRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { MeshReflectorMaterial, OrbitControls } from "@react-three/drei";
import { useGameStore } from "@/lib/store/gameStore";
import { fxBus } from "@/lib/fx/bus";
import type { FxEvent } from "@/lib/types";
import BoardTiles from "./BoardTiles";
import { ShakeManager, nowSeconds } from "./cellFx";
import { BOARD_SPAN, cellPosition, GAP_CENTERS, TILE_HEIGHT } from "./layout";

const BG = "#060a13";

/** Home viewing direction (matches the Canvas' initial camera position). */
const HOME_DIR = new THREE.Vector3(0, 9.5, 10.5).normalize();

/**
 * Camera distance that frames the whole board with margin. Landscape uses
 * the base distance; portrait pulls back proportionally so the 9×9 grid
 * never overflows a phone screen.
 */
function fittedDistance(width: number, height: number): number {
  const aspect = width / Math.max(1, height);
  const base = 14.2;
  if (aspect >= 1) return base;
  return Math.min(32, (base * 1.07) / Math.max(0.42, Math.pow(aspect, 0.95)));
}

function Ground() {
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={-1.15}>
      <planeGeometry args={[70, 70]} />
      <MeshReflectorMaterial
        mirror={0.45}
        blur={[300, 90]}
        resolution={512}
        mixBlur={0.9}
        mixStrength={14}
        depthScale={1.1}
        minDepthThreshold={0.4}
        maxDepthThreshold={1.4}
        roughness={0.85}
        metalness={0.6}
        color="#0b1120"
      />
    </mesh>
  );
}

function Dividers() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#04141c",
        emissive: new THREE.Color("#22d3ee"),
        emissiveIntensity: 1.5,
        roughness: 0.4,
        metalness: 0.2,
        transparent: true,
        opacity: 0.85,
      }),
    []
  );
  const geo = useMemo(() => new THREE.BoxGeometry(BOARD_SPAN + 0.4, 0.05, 0.06), []);
  useEffect(() => {
    return () => {
      mat.dispose();
      geo.dispose();
    };
  }, [mat, geo]);
  return (
    <group position-y={-TILE_HEIGHT / 2 - 0.03}>
      {GAP_CENTERS.map((c) => (
        <mesh key={`h${c}`} geometry={geo} material={mat} position={[0, 0, c]} />
      ))}
      {GAP_CENTERS.map((c) => (
        <mesh
          key={`v${c}`}
          geometry={geo}
          material={mat}
          position={[c, 0, 0]}
          rotation={[0, Math.PI / 2, 0]}
        />
      ))}
    </group>
  );
}

export default function SudokuScene() {
  const swayRef = useRef<THREE.Group>(null);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const shake = useMemo(() => new ShakeManager(), []);
  const shakeOut = useRef({ x: 0, z: 0 });
  /** While in the future, useFrame damps the camera back to the home view. */
  const recenterUntil = useRef(0);

  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  useEffect(() => {
    return fxBus.on((e: FxEvent) => {
      if (e.type === "cell-wrong") shake.trigger(0.5);
    });
  }, [shake]);

  /* Auto-fit: frame the whole board on mount and on viewport changes
   * (portrait phones need a longer camera distance than landscape). */
  useEffect(() => {
    const dist = fittedDistance(size.width, size.height);
    camera.position.copy(HOME_DIR).multiplyScalar(dist);
    camera.lookAt(0, 0, 0);
  }, [size.width, size.height, camera]);

  /* Double-tap (or double-click) anywhere on the canvas re-centers the
   * camera — an easy escape hatch after orbiting/zooming into a mess. */
  useEffect(() => {
    const el = gl.domElement;
    let lastTap = 0;
    let lastX = 0;
    let lastY = 0;
    const onPointerDown = (e: PointerEvent) => {
      const now = performance.now();
      const isDouble =
        now - lastTap < 320 && Math.hypot(e.clientX - lastX, e.clientY - lastY) < 40;
      lastTap = now;
      lastX = e.clientX;
      lastY = e.clientY;
      if (isDouble) recenterUntil.current = now + 900;
    };
    el.addEventListener("pointerdown", onPointerDown);
    return () => el.removeEventListener("pointerdown", onPointerDown);
  }, [gl]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const dt = Math.min(delta, 0.1);
    const sway = swayRef.current;
    if (sway) {
      // Gentle idle sway + decaying shake offset.
      sway.rotation.x = Math.sin(t * 0.35) * 0.018;
      sway.rotation.z = Math.cos(t * 0.28) * 0.014;
      shake.sample(nowSeconds(), shakeOut.current);
      sway.position.x = shakeOut.current.x;
      sway.position.z = shakeOut.current.z;
    }
    // Double-tap recenter: damp the camera back to the fitted home view.
    if (performance.now() < recenterUntil.current) {
      const dist = fittedDistance(state.size.width, state.size.height);
      const cam = state.camera;
      cam.position.x = THREE.MathUtils.damp(cam.position.x, HOME_DIR.x * dist, 5, dt);
      cam.position.y = THREE.MathUtils.damp(cam.position.y, HOME_DIR.y * dist, 5, dt);
      cam.position.z = THREE.MathUtils.damp(cam.position.z, HOME_DIR.z * dist, 5, dt);
    }
    // Subtle camera-target drift toward the selected cell.
    const controls = controlsRef.current;
    if (controls) {
      const selected = useGameStore.getState().selectedCell;
      let tx = 0;
      let tz = 0;
      if (selected !== null) {
        const [x, z] = cellPosition(selected);
        tx = x * 0.22;
        tz = z * 0.22;
      }
      controls.target.x = THREE.MathUtils.damp(controls.target.x, tx, 3, dt);
      controls.target.z = THREE.MathUtils.damp(controls.target.z, tz, 3, dt);
      controls.target.y = THREE.MathUtils.damp(controls.target.y, 0, 3, dt);
    }
  });

  return (
    <>
      <color attach="background" args={[BG]} />
      {/* Far enough that the pulled-back portrait camera isn't fogged out. */}
      <fog attach="fog" args={[BG, 26, 64]} />

      {/* Soft key + cool rim lighting */}
      <ambientLight intensity={0.55} />
      <directionalLight position={[6, 12, 5]} intensity={1.5} color="#e2ecff" />
      <pointLight position={[-9, 5, -7]} intensity={0.9} decay={0} distance={40} color="#22d3ee" />
      <pointLight position={[9, 6, -4]} intensity={0.8} decay={0} distance={38} color="#a855f7" />

      <group ref={swayRef}>
        <BoardTiles />
        <Dividers />
      </group>
      <Ground />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.6}
        minDistance={7.5}
        maxDistance={32}
        minPolarAngle={0.3}
        maxPolarAngle={1.25}
      />
    </>
  );
}
