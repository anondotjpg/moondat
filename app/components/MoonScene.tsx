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
    Math.max(min, value)
  );
}

function seededRandom(seed: number) {
  const x =
    Math.sin(seed * 9999.91) *
    43758.5453;

  return x - Math.floor(x);
}

function abbreviateAddress(
  address: string
) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/* -------------------------------------------------------------------------- */
/*                            8-BIT MOON TEXTURE                              */
/* -------------------------------------------------------------------------- */

const MOON_PALETTE = {
  darkest: "#4d4d4d",
  dark: "#636363",
  midDark: "#777777",
  mid: "#929292",
  light: "#ababab",
  brightest: "#c4c4c4",
};

/*
 * Draws a hard-edged pixel crater.
 *
 * There are NO gradients here.
 * Every crater is made from individual canvas pixels.
 */
function drawPixelCrater(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  seed: number,
  canvasWidth: number
) {
  const minX = Math.floor(
    centerX - radius - 1
  );

  const maxX = Math.ceil(
    centerX + radius + 1
  );

  const minY = Math.floor(
    centerY - radius - 1
  );

  const maxY = Math.ceil(
    centerY + radius + 1
  );

  for (
    let y = minY;
    y <= maxY;
    y++
  ) {
    for (
      let x = minX;
      x <= maxX;
      x++
    ) {
      /*
       * Wrap horizontally so craters crossing
       * the UV seam don't get chopped.
       */
      const wrappedX =
        ((x % canvasWidth) +
          canvasWidth) %
        canvasWidth;

      const dx =
        x - centerX;

      const dy =
        y - centerY;

      /*
       * Slightly irregular crater shape.
       */
      const angle =
        Math.atan2(dy, dx);

      const irregularity =
        1 +
        Math.sin(
          angle * 5 +
            seed
        ) *
          0.05 +
        Math.sin(
          angle * 9 +
            seed * 0.7
        ) *
          0.025;

      const distance =
        Math.sqrt(
          dx * dx +
            dy * dy
        ) /
        (radius *
          irregularity);

      if (distance > 1) {
        continue;
      }

      /*
       * Dark crater floor.
       */
      if (distance < 0.52) {
        const noise =
          seededRandom(
            seed * 1000 +
              x * 19 +
              y * 31
          );

        ctx.fillStyle =
          noise > 0.78
            ? MOON_PALETTE.dark
            : MOON_PALETTE.darkest;

        ctx.fillRect(
          wrappedX,
          y,
          1,
          1
        );

        continue;
      }

      /*
       * Inner wall.
       */
      if (distance < 0.7) {
        ctx.fillStyle =
          MOON_PALETTE.dark;

        ctx.fillRect(
          wrappedX,
          y,
          1,
          1
        );

        continue;
      }

      /*
       * Pixel rim.
       *
       * Upper-left gets highlighted.
       * Bottom-right gets shadowed.
       */
      const lightDirection =
        -dx - dy;

      if (distance < 0.9) {
        ctx.fillStyle =
          lightDirection > 0
            ? MOON_PALETTE.brightest
            : MOON_PALETTE.midDark;

        ctx.fillRect(
          wrappedX,
          y,
          1,
          1
        );

        continue;
      }

      if (distance <= 1) {
        ctx.fillStyle =
          lightDirection > 0
            ? MOON_PALETTE.light
            : MOON_PALETTE.dark;

        ctx.fillRect(
          wrappedX,
          y,
          1,
          1
        );
      }
    }
  }
}

/*
 * Large dark 8-bit lunar regions.
 */
function drawPixelMaria(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  seed: number,
  canvasWidth: number
) {
  const minX = Math.floor(
    centerX - radiusX
  );

  const maxX = Math.ceil(
    centerX + radiusX
  );

  const minY = Math.floor(
    centerY - radiusY
  );

  const maxY = Math.ceil(
    centerY + radiusY
  );

  for (
    let y = minY;
    y <= maxY;
    y++
  ) {
    for (
      let x = minX;
      x <= maxX;
      x++
    ) {
      const dx =
        (x - centerX) /
        radiusX;

      const dy =
        (y - centerY) /
        radiusY;

      const distortion =
        Math.sin(
          x * 0.31 +
            seed
        ) *
          0.07 +
        Math.cos(
          y * 0.37 +
            seed
        ) *
          0.07;

      const distance =
        dx * dx +
        dy * dy +
        distortion;

      if (distance > 1) {
        continue;
      }

      const wrappedX =
        ((x % canvasWidth) +
          canvasWidth) %
        canvasWidth;

      const noise =
        seededRandom(
          seed * 700 +
            x * 11 +
            y * 23
        );

      /*
       * Don't overwrite every pixel.
       * This lets the lunar base texture show through.
       */
      if (noise < 0.3) {
        continue;
      }

      ctx.fillStyle =
        noise > 0.82
          ? MOON_PALETTE.midDark
          : MOON_PALETTE.dark;

      ctx.fillRect(
        wrappedX,
        y,
        1,
        1
      );
    }
  }
}

function createMoonTexture(
  mobile: boolean
) {
  if (
    typeof document ===
    "undefined"
  ) {
    return null;
  }

  /*
   * Intentionally tiny.
   *
   * The texture is enlarged across the sphere using
   * nearest-neighbor filtering, creating the 8-bit look.
   */
  const width =
    mobile ? 192 : 256;

  const height =
    mobile ? 96 : 128;

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

  ctx.imageSmoothingEnabled =
    false;

  /* ---------------------------------------------------------------------- */
  /* Base                                                                   */
  /* ---------------------------------------------------------------------- */

  ctx.fillStyle =
    MOON_PALETTE.mid;

  ctx.fillRect(
    0,
    0,
    width,
    height
  );

  /* ---------------------------------------------------------------------- */
  /* Chunky surface grain                                                   */
  /* ---------------------------------------------------------------------- */

  const grainPalette = [
    MOON_PALETTE.midDark,
    MOON_PALETTE.mid,
    MOON_PALETTE.mid,
    MOON_PALETTE.mid,
    MOON_PALETTE.light,
  ];

  for (
    let y = 0;
    y < height;
    y += 2
  ) {
    for (
      let x = 0;
      x < width;
      x += 2
    ) {
      const noise =
        seededRandom(
          x * 97 +
            y * 131 +
            14
        );

      const index =
        Math.floor(
          noise *
            grainPalette.length
        );

      ctx.fillStyle =
        grainPalette[
          Math.min(
            grainPalette.length -
              1,
            index
          )
        ];

      /*
       * Mostly 2x2 pixel blocks.
       */
      ctx.fillRect(
        x,
        y,
        2,
        2
      );
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Large pixel maria                                                      */
  /* ---------------------------------------------------------------------- */

  const mariaCount = 14;

  for (
    let i = 0;
    i < mariaCount;
    i++
  ) {
    const centerX =
      Math.floor(
        seededRandom(
          i * 13 + 2
        ) * width
      );

    const centerY =
      Math.floor(
        seededRandom(
          i * 17 + 5
        ) * height
      );

    const radiusX =
      8 +
      Math.floor(
        seededRandom(
          i * 23 + 7
        ) * 22
      );

    const radiusY =
      5 +
      Math.floor(
        seededRandom(
          i * 29 + 11
        ) * 13
      );

    drawPixelMaria(
      ctx,
      centerX,
      centerY,
      radiusX,
      radiusY,
      i + 10,
      width
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Large recognizable craters                                             */
  /* ---------------------------------------------------------------------- */

  const largeCraterCount =
    mobile ? 10 : 15;

  for (
    let i = 0;
    i < largeCraterCount;
    i++
  ) {
    const x =
      Math.floor(
        seededRandom(
          i * 41 + 8
        ) * width
      );

    /*
     * Keep centers away from exact poles.
     */
    const y =
      Math.floor(
        height * 0.12 +
          seededRandom(
            i * 43 + 10
          ) *
            height *
            0.76
      );

    const radius =
      4 +
      Math.floor(
        seededRandom(
          i * 47 + 13
        ) * 7
      );

    drawPixelCrater(
      ctx,
      x,
      y,
      radius,
      i + 300,
      width
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Medium craters                                                         */
  /* ---------------------------------------------------------------------- */

  const mediumCraterCount =
    mobile ? 28 : 42;

  for (
    let i = 0;
    i < mediumCraterCount;
    i++
  ) {
    const x =
      Math.floor(
        seededRandom(
          i * 53 + 17
        ) * width
      );

    const y =
      Math.floor(
        seededRandom(
          i * 59 + 19
        ) * height
      );

    const radius =
      2 +
      Math.floor(
        seededRandom(
          i * 61 + 23
        ) * 3
      );

    drawPixelCrater(
      ctx,
      x,
      y,
      radius,
      i + 700,
      width
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Tiny one/two pixel craters                                             */
  /* ---------------------------------------------------------------------- */

  const tinyCraterCount =
    mobile ? 70 : 110;

  for (
    let i = 0;
    i < tinyCraterCount;
    i++
  ) {
    const x =
      Math.floor(
        seededRandom(
          i * 67 + 31
        ) * width
      );

    const y =
      Math.floor(
        seededRandom(
          i * 71 + 37
        ) * height
      );

    const radius =
      seededRandom(
        i * 73 + 41
      ) >
      0.75
        ? 2
        : 1;

    drawPixelCrater(
      ctx,
      x,
      y,
      radius,
      i + 1100,
      width
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Texture                                                                */
  /* ---------------------------------------------------------------------- */

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

  /*
   * CRITICAL:
   *
   * This keeps pixels sharp instead of Three.js
   * smoothing the texture.
   */
  texture.magFilter =
    THREE.NearestFilter;

  texture.minFilter =
    THREE.NearestFilter;

  texture.generateMipmaps =
    false;

  texture.needsUpdate =
    true;

  return texture;
}

/* -------------------------------------------------------------------------- */
/*                     PROPORTIONAL HOLDER ALLOCATION                         */
/* -------------------------------------------------------------------------- */

function buildTreemap(
  holders: Holder[]
): Territory[] {
  const sorted = [...holders]
    .filter(
      (holder) =>
        holder.balance > 0
    )
    .sort(
      (a, b) =>
        b.balance -
        a.balance
    )
    .slice(0, 100);

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
    sorted.length === 0 ||
    total <= 0
  ) {
    return [];
  }

  const result: Territory[] =
    [];

  function recurse(
    items: Holder[],
    u0: number,
    u1: number,
    s0: number,
    s1: number
  ) {
    if (
      items.length === 0
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

    if (
      items.length === 1
    ) {
      result.push({
        holder:
          items[0],

        share:
          items[0].balance /
          total,

        u0,
        u1,
        s0,
        s1,
      });

      return;
    }

    const half =
      groupTotal / 2;

    let running = 0;

    let splitIndex = 1;

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
          running - half
        );

      if (
        distance < closest
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

    const physicalWidth =
      (u1 - u0) *
      Math.PI *
      2;

    const physicalHeight =
      (s1 - s0) * 2;

    if (
      physicalWidth >=
      physicalHeight
    ) {
      const cut =
        u0 +
        (u1 - u0) *
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
        (s1 - s0) *
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

  ctx.textAlign =
    "center";

  ctx.textBaseline =
    "middle";

  ctx.font =
    "600 90px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

  ctx.shadowColor =
    "rgba(0,0,0,0.95)";

  ctx.shadowBlur = 22;

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
    width * 0.25;

  return (
    <mesh
      position={position}
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
/*                              AUTOMATIC SPIN                                */
/* -------------------------------------------------------------------------- */

function AutoSpin({
  children,
}: {
  children: ReactNode;
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

      group.current.rotation.y =
        t * 0.115;

      group.current.rotation.x =
        0.08 +
        Math.sin(
          t * 0.09
        ) *
          0.82;

      group.current.rotation.z =
        Math.sin(
          t * 0.057
        ) *
        0.09;
    }
  );

  return (
    <group ref={group}>
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
      size.width < 640;

    perspective.position.set(
      0,
      0,
      mobile ? 8.3 : 7.5
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
/*                                   MOON                                     */
/* -------------------------------------------------------------------------- */

function Moon({
  holders,
}: MoonSceneProps) {
  const {
    size,
  } = useThree();

  const mobile =
    size.width < 640;

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

  /*
   * Geometry stays smooth.
   * Only the surface art is 8-bit.
   */
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
          bumpScale={0.025}
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
        intensity={0.12}
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
/*                                  EXPORT                                    */
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
          7.5,
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
        args={[
          "#000000",
        ]}
      />

      <SceneContent
        holders={holders}
      />
    </Canvas>
  );
}