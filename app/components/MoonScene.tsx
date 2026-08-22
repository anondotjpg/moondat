"use client";

import { useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";

type Holder = {
  address: string;
  balance: number;
};

type MoonSceneProps = {
  holders: Holder[];
};

const MOON_RADIUS = 2;
const LABEL_RADIUS = 2.018;

function seededRandom(seed: number) {
  const x = Math.sin(seed * 9999.91) * 43758.5453;
  return x - Math.floor(x);
}

function createMoonTexture() {
  if (typeof document === "undefined") return null;

  const size = 2048;
  const canvas = document.createElement("canvas");

  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");

  if (!ctx) return null;

  ctx.fillStyle = "#9d9d9d";
  ctx.fillRect(0, 0, size, size);

  const noiseSize = 512;
  const noiseCanvas = document.createElement("canvas");

  noiseCanvas.width = noiseSize;
  noiseCanvas.height = noiseSize;

  const noiseCtx = noiseCanvas.getContext("2d");

  if (noiseCtx) {
    const image = noiseCtx.createImageData(noiseSize, noiseSize);

    for (let i = 0; i < image.data.length; i += 4) {
      const value = 105 + Math.random() * 65;

      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }

    noiseCtx.putImageData(image, 0, 0);

    ctx.globalAlpha = 0.36;
    ctx.drawImage(noiseCanvas, 0, 0, size, size);
    ctx.globalAlpha = 1;
  }

  for (let i = 0; i < 24; i++) {
    const x = seededRandom(i * 4 + 1) * size;
    const y = seededRandom(i * 4 + 2) * size;

    const radius = 80 + seededRandom(i * 4 + 3) * 260;

    const gradient = ctx.createRadialGradient(
      x,
      y,
      0,
      x,
      y,
      radius
    );

    gradient.addColorStop(
      0,
      `rgba(40,40,40,${0.07 + seededRandom(i * 5) * 0.09})`
    );

    gradient.addColorStop(0.65, "rgba(55,55,55,0.05)");
    gradient.addColorStop(1, "rgba(70,70,70,0)");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 350; i++) {
    const x = seededRandom(i * 11 + 5) * size;
    const y = seededRandom(i * 11 + 7) * size;

    const importance = seededRandom(i * 17 + 2);

    const radius =
      importance > 0.94
        ? 28 + seededRandom(i + 20) * 80
        : 3 + seededRandom(i + 21) * 24;

    const gradient = ctx.createRadialGradient(
      x - radius * 0.18,
      y - radius * 0.18,
      radius * 0.05,
      x,
      y,
      radius
    );

    gradient.addColorStop(0, "rgba(60,60,60,0.55)");
    gradient.addColorStop(0.55, "rgba(80,80,80,0.35)");
    gradient.addColorStop(0.76, "rgba(170,170,170,0.30)");
    gradient.addColorStop(0.88, "rgba(195,195,195,0.18)");
    gradient.addColorStop(1, "rgba(120,120,120,0)");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);

  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;

  return texture;
}

function makeLabelTexture(text: string) {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");

  canvas.width = 1024;
  canvas.height = 256;

  const ctx = canvas.getContext("2d");

  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.font =
    "600 92px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 22;

  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  return texture;
}

function abbreviateAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

type HolderLabelProps = {
  holder: Holder;
  position: THREE.Vector3;
  maxBalance: number;
  mobile: boolean;
};

function HolderLabel({
  holder,
  position,
  maxBalance,
  mobile,
}: HolderLabelProps) {
  const label = abbreviateAddress(holder.address);

  const texture = useMemo(
    () => makeLabelTexture(label),
    [label]
  );

  const quaternion = useMemo(() => {
    const normal = position.clone().normalize();

    const q = new THREE.Quaternion();

    q.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      normal
    );

    return q;
  }, [position]);

  const normalizedHolding = Math.max(
    0,
    Math.min(1, holder.balance / maxBalance)
  );

  const linearScale =
    0.42 + Math.sqrt(normalizedHolding) * 1.45;

  /*
   * Slightly smaller labels on phones so they don't
   * overwhelm the moon.
   */
  const responsiveScale = mobile ? 0.82 : 1;

  const width =
    0.64 * linearScale * responsiveScale;

  const height =
    0.16 * linearScale * responsiveScale;

  if (!texture) return null;

  return (
    <mesh
      position={position}
      quaternion={quaternion}
      renderOrder={2}
    >
      <planeGeometry args={[width, height]} />

      <meshBasicMaterial
        map={texture}
        transparent
        alphaTest={0.05}
        side={THREE.DoubleSide}
        depthTest
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

function getSpherePosition(
  index: number,
  total: number
) {
  const goldenAngle =
    Math.PI * (3 - Math.sqrt(5));

  const y =
    1 -
    (index / Math.max(total - 1, 1)) * 2;

  const radiusAtY = Math.sqrt(
    Math.max(0, 1 - y * y)
  );

  const theta =
    goldenAngle * index + Math.PI * 0.37;

  const x =
    Math.cos(theta) * radiusAtY;

  const z =
    Math.sin(theta) * radiusAtY;

  return new THREE.Vector3(
    x * LABEL_RADIUS,
    y * LABEL_RADIUS,
    z * LABEL_RADIUS
  );
}

function ResponsiveCamera() {
  const { camera, size } = useThree();

  useEffect(() => {
    const perspectiveCamera =
      camera as THREE.PerspectiveCamera;

    const mobile = size.width < 640;

    /*
     * Desktop was previously around 6.6.
     *
     * 7.4 = a little more zoomed out.
     * 8.1 = mobile so the whole moon has breathing room.
     */
    perspectiveCamera.position.set(
      0,
      0,
      mobile ? 8.1 : 7.4
    );

    perspectiveCamera.fov =
      mobile ? 43 : 38;

    perspectiveCamera.updateProjectionMatrix();
  }, [camera, size.width]);

  return null;
}

function Moon({
  holders,
}: MoonSceneProps) {
  const { size } = useThree();

  const mobile = size.width < 640;

  const [moonTexture, setMoonTexture] =
    useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    const texture = createMoonTexture();

    setMoonTexture(texture);

    return () => {
      texture?.dispose();
    };
  }, []);

  const sortedHolders = useMemo(
    () =>
      [...holders].sort(
        (a, b) => b.balance - a.balance
      ),
    [holders]
  );

  const maxBalance =
    sortedHolders[0]?.balance ?? 1;

  const positions = useMemo(
    () =>
      sortedHolders.map((_, index) =>
        getSpherePosition(
          index,
          sortedHolders.length
        )
      ),
    [sortedHolders]
  );

  return (
    <group rotation={[0.08, -0.4, 0.03]}>
      <mesh>
        <sphereGeometry
          args={[
            MOON_RADIUS,
            mobile ? 96 : 160,
            mobile ? 96 : 160,
          ]}
        />

        <meshStandardMaterial
          map={moonTexture ?? undefined}
          bumpMap={moonTexture ?? undefined}
          bumpScale={0.045}
          roughness={1}
          metalness={0}
          color="#b6b6b6"
        />
      </mesh>

      {sortedHolders.map(
        (holder, index) => (
          <HolderLabel
            key={holder.address}
            holder={holder}
            position={positions[index]}
            maxBalance={maxBalance}
            mobile={mobile}
          />
        )
      )}
    </group>
  );
}

function SceneContent({
  holders,
}: MoonSceneProps) {
  const { size } = useThree();

  const mobile = size.width < 640;

  return (
    <>
      <ResponsiveCamera />

      <ambientLight intensity={0.075} />

      <directionalLight
        position={[-4, 3, 5]}
        intensity={3.2}
      />

      <directionalLight
        position={[4, -1, -3]}
        intensity={0.12}
      />

      <Moon holders={holders} />

      <Stars
        radius={60}
        depth={30}
        count={mobile ? 650 : 1200}
        factor={mobile ? 1.15 : 1.4}
        saturation={0}
        fade
        speed={0.05}
      />

      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom={false}
        enableDamping
        dampingFactor={0.045}
        rotateSpeed={mobile ? 0.6 : 0.45}
        autoRotate
        autoRotateSpeed={0.22}
      />
    </>
  );
}

export default function MoonScene({
  holders,
}: MoonSceneProps) {
  return (
    <Canvas
      className="touch-none"
      dpr={[1, 1.75]}
      camera={{
        position: [0, 0, 7.4],
        fov: 38,
        near: 0.1,
        far: 100,
      }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      }}
    >
      <color
        attach="background"
        args={["#000000"]}
      />

      <SceneContent holders={holders} />
    </Canvas>
  );
}