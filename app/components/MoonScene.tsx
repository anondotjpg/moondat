"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
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

  /*
   * Exact percentage of all displayed
   * top-100 holder tokens.
   *
   * Example:
   *
   * 0.12 = 12%
   */
  share: number;

  u0: number;
  u1: number;

  s0: number;
  s1: number;
};

const MOON_RADIUS = 2;
const LABEL_RADIUS = 2.025;

/* -------------------------------------------------------------------------- */
/*                                  HELPERS                                   */
/* -------------------------------------------------------------------------- */

function clamp(
  value: number,
  min: number,
  max: number
) {
  return Math.min(
    max,
    Math.max(
      min,
      value
    )
  );
}

function seededRandom(
  seed: number
) {
  const x =
    Math.sin(
      seed * 9999.91
    ) * 43758.5453;

  return (
    x -
    Math.floor(x)
  );
}

function abbreviateAddress(
  address: string
) {
  return `${address.slice(
    0,
    4
  )}…${address.slice(-4)}`;
}

/* -------------------------------------------------------------------------- */
/*                                MOON TEXTURE                                */
/* -------------------------------------------------------------------------- */

function createMoonTexture(
  mobile: boolean
) {
  if (
    typeof document ===
    "undefined"
  ) {
    return null;
  }

  const size =
    mobile
      ? 1024
      : 2048;

  const canvas =
    document.createElement(
      "canvas"
    );

  canvas.width =
    size;

  canvas.height =
    size;

  const ctx =
    canvas.getContext(
      "2d"
    );

  if (!ctx) {
    return null;
  }

  /*
   * Neutral lunar base.
   */
  ctx.fillStyle =
    "#999999";

  ctx.fillRect(
    0,
    0,
    size,
    size
  );

  /*
   * Fine natural lunar grain.
   */
  const noiseSize =
    mobile
      ? 256
      : 512;

  const noiseCanvas =
    document.createElement(
      "canvas"
    );

  noiseCanvas.width =
    noiseSize;

  noiseCanvas.height =
    noiseSize;

  const noiseCtx =
    noiseCanvas.getContext(
      "2d"
    );

  if (noiseCtx) {
    const image =
      noiseCtx.createImageData(
        noiseSize,
        noiseSize
      );

    for (
      let i = 0;
      i <
      image.data.length;
      i += 4
    ) {
      const value =
        105 +
        Math.random() *
          65;

      image.data[i] =
        value;

      image.data[
        i + 1
      ] = value;

      image.data[
        i + 2
      ] = value;

      image.data[
        i + 3
      ] = 255;
    }

    noiseCtx.putImageData(
      image,
      0,
      0
    );

    ctx.globalAlpha =
      0.34;

    ctx.drawImage(
      noiseCanvas,
      0,
      0,
      size,
      size
    );

    ctx.globalAlpha =
      1;
  }

  /*
   * Lunar maria.
   */
  for (
    let i = 0;
    i < 24;
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
      "rgba(35,35,35,0.16)"
    );

    gradient.addColorStop(
      0.65,
      "rgba(55,55,55,0.07)"
    );

    gradient.addColorStop(
      1,
      "rgba(70,70,70,0)"
    );

    ctx.fillStyle =
      gradient;

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
    mobile
      ? 220
      : 400;

  for (
    let i = 0;
    i <
    craterCount;
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
        x -
          radius *
            0.18,
        y -
          radius *
            0.18,
        radius *
          0.05,
        x,
        y,
        radius
      );

    gradient.addColorStop(
      0,
      "rgba(45,45,45,0.55)"
    );

    gradient.addColorStop(
      0.58,
      "rgba(80,80,80,0.30)"
    );

    gradient.addColorStop(
      0.78,
      "rgba(190,190,190,0.24)"
    );

    gradient.addColorStop(
      1,
      "rgba(120,120,120,0)"
    );

    ctx.fillStyle =
      gradient;

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
    mobile
      ? 4
      : 8;

  return texture;
}

/* -------------------------------------------------------------------------- */
/*                     PROPORTIONAL HOLDER ALLOCATION                         */
/* -------------------------------------------------------------------------- */

function buildTreemap(
  holders: Holder[]
): Territory[] {
  /*
   * Defensive limit here too.
   *
   * Even if the API somehow sends more,
   * the moon will never render >100.
   */
  const sorted =
    [...holders]
      .filter(
        (holder) =>
          holder.balance >
          0
      )
      .sort(
        (a, b) =>
          b.balance -
          a.balance
      )
      .slice(
        0,
        100
      );

  const total =
    sorted.reduce(
      (
        sum,
        holder
      ) =>
        sum +
        holder.balance,
      0
    );

  if (
    sorted.length ===
      0 ||
    total <= 0
  ) {
    return [];
  }

  const result:
    Territory[] = [];

  function recurse(
    items: Holder[],
    u0: number,
    u1: number,
    s0: number,
    s1: number
  ) {
    if (
      items.length ===
      0
    ) {
      return;
    }

    const groupTotal =
      items.reduce(
        (
          sum,
          holder
        ) =>
          sum +
          holder.balance,
        0
      );

    /*
     * Once only one wallet remains,
     * this entire box belongs to it.
     */
    if (
      items.length ===
      1
    ) {
      result.push({
        holder:
          items[0],

        /*
         * Exact percentage of
         * displayed holder holdings.
         */
        share:
          items[0]
            .balance /
          total,

        u0,
        u1,
        s0,
        s1,
      });

      return;
    }

    /*
     * Divide holdings into two groups whose
     * balances are as close to 50/50 as possible.
     */
    const half =
      groupTotal / 2;

    let running = 0;

    let splitIndex =
      1;

    let closest =
      Number.POSITIVE_INFINITY;

    for (
      let i = 1;
      i <
      items.length;
      i++
    ) {
      running +=
        items[
          i - 1
        ].balance;

      const distance =
        Math.abs(
          running -
            half
        );

      if (
        distance <
        closest
      ) {
        closest =
          distance;

        splitIndex =
          i;
      }
    }

    const first =
      items.slice(
        0,
        splitIndex
      );

    const second =
      items.slice(
        splitIndex
      );

    const firstTotal =
      first.reduce(
        (
          sum,
          holder
        ) =>
          sum +
          holder.balance,
        0
      );

    const ratio =
      firstTotal /
      groupTotal;

    /*
     * Split along the longer physical dimension
     * to keep regions compact rather than strips.
     */
    const physicalWidth =
      (
        u1 -
        u0
      ) *
      Math.PI *
      2;

    const physicalHeight =
      (
        s1 -
        s0
      ) * 2;

    if (
      physicalWidth >=
      physicalHeight
    ) {
      const cut =
        u0 +
        (
          u1 -
          u0
        ) *
          ratio;

      recurse(
        first,
        u0,
        cut,
        s0,
        s1
      );

      recurse(
        second,
        cut,
        u1,
        s0,
        s1
      );
    } else {
      const cut =
        s0 +
        (
          s1 -
          s0
        ) *
          ratio;

      recurse(
        first,
        u0,
        u1,
        s0,
        cut
      );

      recurse(
        second,
        u0,
        u1,
        cut,
        s1
      );
    }
  }

  recurse(
    sorted,
    0,
    1,
    0,
    1
  );

  return result;
}

/* -------------------------------------------------------------------------- */
/*                           SPHERE POSITIONING                               */
/* -------------------------------------------------------------------------- */

function equalAreaToLatitude(
  s: number
) {
  /*
   * Equal-area latitude mapping.
   *
   * This is what makes each holder's conceptual
   * surface area actually correspond to its %.
   */
  const sinLatitude =
    clamp(
      s * 2 - 1,
      -1,
      1
    );

  return Math.asin(
    sinLatitude
  );
}

function territoryCenterPosition(
  territory: Territory
) {
  const u =
    (
      territory.u0 +
      territory.u1
    ) / 2;

  const s =
    (
      territory.s0 +
      territory.s1
    ) / 2;

  const latitude =
    equalAreaToLatitude(
      s
    );

  const longitude =
    u *
    Math.PI *
    2;

  const cosLatitude =
    Math.cos(
      latitude
    );

  return new THREE.Vector3(
    -LABEL_RADIUS *
      Math.cos(
        longitude
      ) *
      cosLatitude,

    LABEL_RADIUS *
      Math.sin(
        latitude
      ),

    LABEL_RADIUS *
      Math.sin(
        longitude
      ) *
      cosLatitude
  );
}

/* -------------------------------------------------------------------------- */
/*                                  LABELS                                    */
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
    abbreviateAddress(
      address
    );

  const canvas =
    document.createElement(
      "canvas"
    );

  canvas.width =
    1024;

  canvas.height =
    256;

  const ctx =
    canvas.getContext(
      "2d"
    );

  if (!ctx) {
    return null;
  }

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  ctx.textAlign =
    "center";

  ctx.textBaseline =
    "middle";

  ctx.font =
    "600 90px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

  ctx.shadowColor =
    "rgba(0,0,0,0.95)";

  ctx.shadowBlur =
    22;

  ctx.fillStyle =
    "rgba(255,255,255,0.96)";

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
  const texture =
    useMemo(
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
        territoryCenterPosition(
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
   * If the #1 displayed wallet has 20%
   * and another has 5%, the second wallet
   * gets 25% of its relative visual importance.
   *
   * sqrt is used because width AND height change.
   */
  const relativeShare =
    territory.share /
    Math.max(
      largestShare,
      0.000001
    );

  const linearScale =
    Math.sqrt(
      relativeShare
    );

  const responsiveScale =
    mobile
      ? 0.78
      : 1;

  const width =
    clamp(
      (
        0.14 +
        linearScale *
          0.72
      ) *
        responsiveScale,

      mobile
        ? 0.09
        : 0.11,

      mobile
        ? 0.7
        : 0.9
    );

  const height =
    width *
    0.25;

  return (
    <mesh
      position={
        position
      }
      quaternion={
        quaternion
      }
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
        alphaTest={
          0.03
        }
        depthTest
        depthWrite={
          false
        }
        side={
          THREE.DoubleSide
        }
        toneMapped={
          false
        }
      />
    </mesh>
  );
}

/* -------------------------------------------------------------------------- */
/*                              AUTOMATIC SPIN                                */
/* -------------------------------------------------------------------------- */

function AutoSpin({
  children,
}: {
  children:
    ReactNode;
}) {
  const group =
    useRef<THREE.Group>(
      null
    );

  const elapsed =
    useRef(0);

  useFrame(
    (_, delta) => {
      if (
        !group.current
      ) {
        return;
      }

      elapsed.current +=
        delta;

      const t =
        elapsed.current;

      /*
       * Main rotation.
       *
       * Slow enough to read addresses,
       * fast enough that all 100 holders
       * naturally cycle into view.
       */
      group.current.rotation.y =
        t * 0.115;

      /*
       * North / south precession.
       */
      group.current.rotation.x =
        0.08 +
        Math.sin(
          t * 0.09
        ) *
          0.82;

      /*
       * Small additional wobble.
       */
      group.current.rotation.z =
        Math.sin(
          t * 0.057
        ) *
        0.09;
    }
  );

  return (
    <group
      ref={group}
    >
      {children}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  CAMERA                                    */
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
      size.width <
      640;

    perspective.position.set(
      0,
      0,
      mobile
        ? 8.3
        : 7.5
    );

    perspective.fov =
      mobile
        ? 44
        : 38;

    perspective.updateProjectionMatrix();
  }, [
    camera,
    size.width,
  ]);

  return null;
}

/* -------------------------------------------------------------------------- */
/*                                   MOON                                     */
/* -------------------------------------------------------------------------- */

function Moon({
  holders,
}: MoonSceneProps) {
  const {
    size,
  } = useThree();

  const mobile =
    size.width <
    640;

  /*
   * Only the first 100 holders ever participate.
   */
  const territories =
    useMemo(
      () =>
        buildTreemap(
          holders.slice(
            0,
            100
          )
        ),
      [holders]
    );

  const largestShare =
    useMemo(
      () =>
        Math.max(
          ...territories.map(
            (
              territory
            ) =>
              territory.share
          ),
          0
        ),
      [territories]
    );

  const [
    moonTexture,
    setMoonTexture,
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

  const segments =
    mobile
      ? 96
      : 160;

  return (
    <AutoSpin>
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
          bumpScale={
            0.04
          }
          roughness={1}
          metalness={0}
          color="#b6b6b6"
        />
      </mesh>

      {territories.map(
        (
          territory
        ) => (
          <HolderLabel
            key={
              territory
                .holder
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
/*                                   SCENE                                    */
/* -------------------------------------------------------------------------- */

function SceneContent({
  holders,
}: MoonSceneProps) {
  const {
    size,
  } = useThree();

  const mobile =
    size.width <
    640;

  return (
    <>
      <ResponsiveCamera />

      <ambientLight
        intensity={
          0.08
        }
      />

      <directionalLight
        position={[
          -4,
          3,
          5,
        ]}
        intensity={
          3.15
        }
      />

      <directionalLight
        position={[
          4,
          -1,
          -3,
        ]}
        intensity={
          0.12
        }
      />

      <Moon
        holders={
          holders
        }
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
        speed={
          0.025
        }
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  EXPORT                                    */
/* -------------------------------------------------------------------------- */

export default function MoonScene({
  holders,
}: MoonSceneProps) {
  return (
    <Canvas
      dpr={[
        1,
        1.6,
      ]}
      camera={{
        position: [
          0,
          0,
          7.5,
        ],
        fov: 38,
        near: 0.1,
        far: 100,
      }}
      gl={{
        antialias:
          true,
        alpha:
          false,
        powerPreference:
          "high-performance",
      }}
    >
      <color
        attach="background"
        args={[
          "#000000",
        ]}
      />

      <SceneContent
        holders={
          holders
        }
      />
    </Canvas>
  );
}