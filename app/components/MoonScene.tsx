"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Canvas,
  useFrame,
  useThree,
} from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import * as THREE from "three";

type Holder = {
  address: string;
  balance: number;
};

type MoonSceneProps = {
  holders: Holder[];
};

type Territory = {
  holder: Holder;
  share: number;
  startU: number;
  endU: number;
  centerU: number;
  index: number;
};

const MOON_RADIUS = 2;
const TERRITORY_RADIUS = 2.004;
const LABEL_RADIUS = 2.025;

function clamp(
  value: number,
  min: number,
  max: number
) {
  return Math.min(max, Math.max(min, value));
}

function seededRandom(seed: number) {
  const x =
    Math.sin(seed * 9999.91) * 43758.5453;

  return x - Math.floor(x);
}

function hashString(value: string) {
  let hash = 2166136261;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);

    hash = Math.imul(
      hash,
      16777619
    );
  }

  return Math.abs(hash >>> 0);
}

function abbreviateAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/* -------------------------------------------------------------------------- */
/*                               MOON TEXTURE                                 */
/* -------------------------------------------------------------------------- */

function createMoonTexture(
  mobile: boolean
) {
  if (typeof document === "undefined") {
    return null;
  }

  const size = mobile ? 1024 : 2048;

  const canvas =
    document.createElement("canvas");

  canvas.width = size;
  canvas.height = size;

  const ctx =
    canvas.getContext("2d");

  if (!ctx) {
    return null;
  }

  ctx.fillStyle = "#999999";

  ctx.fillRect(
    0,
    0,
    size,
    size
  );

  /*
   * Base lunar noise.
   */
  const noiseSize =
    mobile ? 256 : 512;

  const noiseCanvas =
    document.createElement("canvas");

  noiseCanvas.width = noiseSize;
  noiseCanvas.height = noiseSize;

  const noiseCtx =
    noiseCanvas.getContext("2d");

  if (noiseCtx) {
    const image =
      noiseCtx.createImageData(
        noiseSize,
        noiseSize
      );

    for (
      let i = 0;
      i < image.data.length;
      i += 4
    ) {
      const value =
        104 + Math.random() * 68;

      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }

    noiseCtx.putImageData(
      image,
      0,
      0
    );

    ctx.globalAlpha = 0.38;

    ctx.drawImage(
      noiseCanvas,
      0,
      0,
      size,
      size
    );

    ctx.globalAlpha = 1;
  }

  /*
   * Large maria.
   */
  for (
    let i = 0;
    i < 28;
    i++
  ) {
    const x =
      seededRandom(
        i * 4 + 1
      ) * size;

    const y =
      seededRandom(
        i * 4 + 2
      ) * size;

    const radius =
      size *
      (
        0.035 +
        seededRandom(
          i * 4 + 3
        ) *
          0.12
      );

    const gradient =
      ctx.createRadialGradient(
        x,
        y,
        0,
        x,
        y,
        radius
      );

    gradient.addColorStop(
      0,
      "rgba(35,35,35,0.18)"
    );

    gradient.addColorStop(
      0.65,
      "rgba(55,55,55,0.08)"
    );

    gradient.addColorStop(
      1,
      "rgba(70,70,70,0)"
    );

    ctx.fillStyle = gradient;

    ctx.beginPath();

    ctx.arc(
      x,
      y,
      radius,
      0,
      Math.PI * 2
    );

    ctx.fill();
  }

  /*
   * Craters.
   */
  const craterCount =
    mobile ? 220 : 400;

  for (
    let i = 0;
    i < craterCount;
    i++
  ) {
    const x =
      seededRandom(
        i * 11 + 5
      ) * size;

    const y =
      seededRandom(
        i * 11 + 7
      ) * size;

    const importance =
      seededRandom(
        i * 17 + 2
      );

    const radius =
      importance > 0.95
        ? size *
          (
            0.015 +
            seededRandom(
              i + 20
            ) *
              0.035
          )
        : size *
          (
            0.0015 +
            seededRandom(
              i + 21
            ) *
              0.011
          );

    const gradient =
      ctx.createRadialGradient(
        x - radius * 0.18,
        y - radius * 0.18,
        radius * 0.05,
        x,
        y,
        radius
      );

    gradient.addColorStop(
      0,
      "rgba(45,45,45,0.58)"
    );

    gradient.addColorStop(
      0.58,
      "rgba(80,80,80,0.33)"
    );

    gradient.addColorStop(
      0.78,
      "rgba(190,190,190,0.26)"
    );

    gradient.addColorStop(
      1,
      "rgba(120,120,120,0)"
    );

    ctx.fillStyle = gradient;

    ctx.beginPath();

    ctx.arc(
      x,
      y,
      radius,
      0,
      Math.PI * 2
    );

    ctx.fill();
  }

  const texture =
    new THREE.CanvasTexture(
      canvas
    );

  texture.colorSpace =
    THREE.SRGBColorSpace;

  texture.wrapS =
    THREE.RepeatWrapping;

  texture.wrapT =
    THREE.ClampToEdgeWrapping;

  texture.anisotropy =
    mobile ? 4 : 8;

  return texture;
}

/* -------------------------------------------------------------------------- */
/*                             HOLDER TERRITORIES                             */
/* -------------------------------------------------------------------------- */

function calculateTerritories(
  holders: Holder[]
): Territory[] {
  const sorted = [...holders]
    .filter(
      (holder) =>
        holder.balance > 0
    )
    .sort(
      (a, b) =>
        b.balance - a.balance
    );

  const total =
    sorted.reduce(
      (sum, holder) =>
        sum + holder.balance,
      0
    );

  if (total <= 0) {
    return [];
  }

  let cursor = 0;

  return sorted.map(
    (holder, index) => {
      const share =
        holder.balance / total;

      const startU =
        cursor;

      const endU =
        cursor + share;

      cursor = endU;

      return {
        holder,
        share,
        startU,
        endU,
        centerU:
          startU +
          share / 2,
        index,
      };
    }
  );
}

/*
 * IMPORTANT:
 *
 * These are not arbitrary rectangular shares.
 *
 * Three.js SphereGeometry maps U directly around longitude.
 *
 * A full north-to-south longitude lune with angular width Δλ
 * has spherical area:
 *
 *     A = 2 R² Δλ
 *
 * The whole sphere is:
 *
 *     4 π R²
 *
 * Therefore:
 *
 *     A / sphere = Δλ / 2π
 *
 * Since each wallet's U width is exactly:
 *
 *     holder balance / total balance
 *
 * its territory occupies that exact fraction of the sphere.
 */
function createTerritoryTexture(
  territories: Territory[],
  mobile: boolean
) {
  if (
    typeof document ===
    "undefined"
  ) {
    return null;
  }

  const width =
    mobile ? 4096 : 8192;

  const height =
    mobile ? 1024 : 2048;

  const canvas =
    document.createElement(
      "canvas"
    );

  canvas.width = width;
  canvas.height = height;

  const ctx =
    canvas.getContext("2d");

  if (!ctx) {
    return null;
  }

  ctx.clearRect(
    0,
    0,
    width,
    height
  );

  territories.forEach(
    (territory) => {
      const x0 =
        territory.startU *
        width;

      const x1 =
        territory.endU *
        width;

      const territoryWidth =
        Math.max(
          0,
          x1 - x0
        );

      /*
       * Slight alternating shading makes each holder's
       * real territory visible without destroying the
       * lunar surface underneath.
       */
      const hash =
        hashString(
          territory.holder
            .address
        );

      const light =
        hash % 2 === 0;

      ctx.fillStyle = light
        ? "rgba(255,255,255,0.055)"
        : "rgba(0,0,0,0.075)";

      ctx.fillRect(
        x0,
        0,
        territoryWidth,
        height
      );

      /*
       * Territory border.
       */
      if (
        territoryWidth >
        0.8
      ) {
        ctx.beginPath();

        ctx.moveTo(
          Math.round(x0) +
            0.5,
          0
        );

        ctx.lineTo(
          Math.round(x0) +
            0.5,
          height
        );

        ctx.strokeStyle =
          territory.share >
          0.01
            ? "rgba(255,255,255,0.28)"
            : "rgba(255,255,255,0.13)";

        ctx.lineWidth =
          territory.share >
          0.03
            ? 1.5
            : 1;

        ctx.stroke();
      }
    }
  );

  const texture =
    new THREE.CanvasTexture(
      canvas
    );

  texture.colorSpace =
    THREE.SRGBColorSpace;

  texture.wrapS =
    THREE.RepeatWrapping;

  texture.wrapT =
    THREE.ClampToEdgeWrapping;

  texture.minFilter =
    THREE.LinearFilter;

  texture.magFilter =
    THREE.LinearFilter;

  return texture;
}

/* -------------------------------------------------------------------------- */
/*                                LABELS                                      */
/* -------------------------------------------------------------------------- */

function makeLabelTexture(
  address: string
) {
  if (
    typeof document ===
    "undefined"
  ) {
    return null;
  }

  const text =
    abbreviateAddress(address);

  const canvas =
    document.createElement(
      "canvas"
    );

  canvas.width = 1024;
  canvas.height = 256;

  const ctx =
    canvas.getContext("2d");

  if (!ctx) {
    return null;
  }

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.font =
    "600 92px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

  ctx.shadowColor =
    "rgba(0,0,0,0.95)";

  ctx.shadowBlur = 24;

  ctx.fillStyle =
    "rgba(255,255,255,0.97)";

  ctx.fillText(
    text,
    canvas.width / 2,
    canvas.height / 2
  );

  const texture =
    new THREE.CanvasTexture(
      canvas
    );

  texture.colorSpace =
    THREE.SRGBColorSpace;

  texture.minFilter =
    THREE.LinearFilter;

  texture.magFilter =
    THREE.LinearFilter;

  return texture;
}

function territoryPosition(
  territory: Territory
) {
  /*
   * Spread labels vertically so hundreds of wallets
   * aren't all sitting around the equator.
   *
   * Longitude still stays inside that holder's
   * actual territory.
   */
  const seed =
    hashString(
      territory.holder.address
    );

  const random =
    seededRandom(seed);

  /*
   * Keep labels away from the extreme poles because
   * those areas compress visually.
   */
  const latitudeDegrees =
    -58 + random * 116;

  const latitude =
    THREE.MathUtils.degToRad(
      latitudeDegrees
    );

  const phi =
    territory.centerU *
    Math.PI *
    2;

  const cosLat =
    Math.cos(latitude);

  /*
   * Matches THREE.SphereGeometry's UV orientation.
   */
  return new THREE.Vector3(
    -LABEL_RADIUS *
      Math.cos(phi) *
      cosLat,

    LABEL_RADIUS *
      Math.sin(latitude),

    LABEL_RADIUS *
      Math.sin(phi) *
      cosLat
  );
}

type HolderLabelProps = {
  territory: Territory;
  largestShare: number;
  mobile: boolean;
};

function HolderLabel({
  territory,
  largestShare,
  mobile,
}: HolderLabelProps) {
  const texture = useMemo(
    () =>
      makeLabelTexture(
        territory.holder
          .address
      ),
    [
      territory.holder
        .address,
    ]
  );

  const position =
    useMemo(
      () =>
        territoryPosition(
          territory
        ),
      [territory]
    );

  const quaternion =
    useMemo(() => {
      const normal =
        position
          .clone()
          .normalize();

      const q =
        new THREE.Quaternion();

      q.setFromUnitVectors(
        new THREE.Vector3(
          0,
          0,
          1
        ),
        normal
      );

      return q;
    }, [position]);

  if (!texture) {
    return null;
  }

  /*
   * Territory itself contains the TRUE proportional
   * area.
   *
   * Label scale just reinforces that visually.
   *
   * sqrt() is used because we're scaling both width
   * and height — therefore label AREA grows roughly
   * linearly with holder share.
   */
  const relativeShare =
    largestShare > 0
      ? territory.share /
        largestShare
      : 0;

  const proportionalScale =
    Math.sqrt(
      clamp(
        relativeShare,
        0,
        1
      )
    );

  const mobileScale =
    mobile ? 0.8 : 1;

  const scale =
    (
      0.25 +
      proportionalScale *
        1.25
    ) * mobileScale;

  const width =
    clamp(
      0.48 * scale,
      mobile ? 0.11 : 0.13,
      mobile ? 0.82 : 1
    );

  const height =
    width * 0.25;

  return (
    <mesh
      position={position}
      quaternion={quaternion}
      renderOrder={5}
    >
      <planeGeometry
        args={[
          width,
          height,
        ]}
      />

      <meshBasicMaterial
        map={texture}
        transparent
        alphaTest={0.03}
        depthTest
        depthWrite={false}
        side={
          THREE.DoubleSide
        }
        toneMapped={false}
      />
    </mesh>
  );
}

/* -------------------------------------------------------------------------- */
/*                             NATURAL AUTO SPIN                              */
/* -------------------------------------------------------------------------- */

function AutoSpin({
  children,
}: {
  children:
    React.ReactNode;
}) {
  const group =
    useRef<THREE.Group>(
      null
    );

  const elapsed =
    useRef(0);

  useFrame(
    (_, delta) => {
      const moon =
        group.current;

      if (!moon) {
        return;
      }

      elapsed.current += delta;

      const t =
        elapsed.current;

      /*
       * Continuous longitude rotation.
       *
       * ~45 sec per full turn.
       */
      moon.rotation.y =
        t * 0.14;

      /*
       * Slowly precess the moon north/south.
       *
       * This is the important part missing from simple
       * OrbitControls autoRotate.
       *
       * It brings high northern and southern territories
       * naturally toward the camera over time.
       */
      moon.rotation.x =
        0.12 +
        Math.sin(
          t * 0.105
        ) *
          0.92;

      /*
       * Tiny secondary wobble keeps the movement from
       * feeling like a mechanical globe.
       */
      moon.rotation.z =
        Math.sin(
          t * 0.071
        ) *
        0.11;
    }
  );

  return (
    <group ref={group}>
      {children}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 CAMERA                                     */
/* -------------------------------------------------------------------------- */

function ResponsiveCamera() {
  const {
    camera,
    size,
  } = useThree();

  useEffect(() => {
    const perspective =
      camera as THREE.PerspectiveCamera;

    const mobile =
      size.width < 640;

    perspective.position.set(
      0,
      0,
      mobile ? 8.25 : 7.45
    );

    perspective.fov =
      mobile ? 44 : 38;

    perspective.updateProjectionMatrix();
  }, [
    camera,
    size.width,
  ]);

  return null;
}

/* -------------------------------------------------------------------------- */
/*                                  MOON                                      */
/* -------------------------------------------------------------------------- */

function Moon({
  holders,
}: MoonSceneProps) {
  const { size } =
    useThree();

  const mobile =
    size.width < 640;

  const territories =
    useMemo(
      () =>
        calculateTerritories(
          holders
        ),
      [holders]
    );

  const largestShare =
    territories[0]?.share ??
    1;

  const [
    moonTexture,
    setMoonTexture,
  ] =
    useState<THREE.CanvasTexture | null>(
      null
    );

  const [
    territoryTexture,
    setTerritoryTexture,
  ] =
    useState<THREE.CanvasTexture | null>(
      null
    );

  useEffect(() => {
    const texture =
      createMoonTexture(
        mobile
      );

    setMoonTexture(
      texture
    );

    return () => {
      texture?.dispose();
    };
  }, [mobile]);

  useEffect(() => {
    const texture =
      createTerritoryTexture(
        territories,
        mobile
      );

    setTerritoryTexture(
      texture
    );

    return () => {
      texture?.dispose();
    };
  }, [
    territories,
    mobile,
  ]);

  const segments =
    mobile ? 96 : 160;

  return (
    <AutoSpin>
      {/* Actual moon */}
      <mesh>
        <sphereGeometry
          args={[
            MOON_RADIUS,
            segments,
            segments,
          ]}
        />

        <meshStandardMaterial
          map={
            moonTexture ??
            undefined
          }
          bumpMap={
            moonTexture ??
            undefined
          }
          bumpScale={0.04}
          roughness={1}
          metalness={0}
          color="#b6b6b6"
        />
      </mesh>

      {/* Exact proportional holder territories */}
      {territoryTexture && (
        <mesh
          renderOrder={2}
        >
          <sphereGeometry
            args={[
              TERRITORY_RADIUS,
              segments,
              segments,
            ]}
          />

          <meshBasicMaterial
            map={
              territoryTexture
            }
            transparent
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* Wallet labels */}
      {territories.map(
        (territory) => (
          <HolderLabel
            key={
              territory.holder
                .address
            }
            territory={
              territory
            }
            largestShare={
              largestShare
            }
            mobile={
              mobile
            }
          />
        )
      )}
    </AutoSpin>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 SCENE                                      */
/* -------------------------------------------------------------------------- */

function SceneContent({
  holders,
}: MoonSceneProps) {
  const { size } =
    useThree();

  const mobile =
    size.width < 640;

  return (
    <>
      <ResponsiveCamera />

      <ambientLight
        intensity={0.08}
      />

      <directionalLight
        position={[
          -4,
          3,
          5,
        ]}
        intensity={3.15}
      />

      <directionalLight
        position={[
          4,
          -1,
          -3,
        ]}
        intensity={0.13}
      />

      <Moon
        holders={holders}
      />

      <Stars
        radius={60}
        depth={30}
        count={
          mobile
            ? 550
            : 1100
        }
        factor={
          mobile
            ? 1.1
            : 1.35
        }
        saturation={0}
        fade
        speed={0.025}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 EXPORT                                     */
/* -------------------------------------------------------------------------- */

export default function MoonScene({
  holders,
}: MoonSceneProps) {
  return (
    <Canvas
      dpr={[1, 1.6]}
      camera={{
        position: [
          0,
          0,
          7.45,
        ],
        fov: 38,
        near: 0.1,
        far: 100,
      }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference:
          "high-performance",
      }}
    >
      <color
        attach="background"
        args={["#000000"]}
      />

      <SceneContent
        holders={holders}
      />
    </Canvas>
  );
}