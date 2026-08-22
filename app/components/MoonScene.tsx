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
import {
  Html,
  Stars,
} from "@react-three/drei";
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
const TOOLTIP_RADIUS = 2.13;

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

function seededRandom(
  seed: number
) {
  const x =
    Math.sin(
      seed * 9999.91
    ) * 43758.5453;

  return x - Math.floor(x);
}

function abbreviateAddress(
  address: string
) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function formatTokenAmount(
  value: number
) {
  if (
    value >=
    1_000_000_000
  ) {
    return `${(
      value /
      1_000_000_000
    ).toFixed(2)}B`;
  }

  if (
    value >=
    1_000_000
  ) {
    return `${(
      value /
      1_000_000
    ).toFixed(2)}M`;
  }

  if (
    value >=
    1_000
  ) {
    return `${(
      value /
      1_000
    ).toFixed(1)}K`;
  }

  return Math.round(
    value
  ).toLocaleString();
}

/* -------------------------------------------------------------------------- */
/*                             8-BIT MOON TEXTURE                             */
/* -------------------------------------------------------------------------- */

const MOON_PALETTE = {
  darkest: "#4d4d4d",
  dark: "#636363",
  midDark: "#777777",
  mid: "#929292",
  light: "#ababab",
  brightest: "#c4c4c4",
};

function drawPixelCrater(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  seed: number,
  canvasWidth: number
) {
  const minX =
    Math.floor(
      centerX -
        radius -
        1
    );

  const maxX =
    Math.ceil(
      centerX +
        radius +
        1
    );

  const minY =
    Math.floor(
      centerY -
        radius -
        1
    );

  const maxY =
    Math.ceil(
      centerY +
        radius +
        1
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
      const wrappedX =
        ((x % canvasWidth) +
          canvasWidth) %
        canvasWidth;

      const dx =
        x - centerX;

      const dy =
        y - centerY;

      const angle =
        Math.atan2(
          dy,
          dx
        );

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
        (
          radius *
          irregularity
        );

      if (
        distance > 1
      ) {
        continue;
      }

      if (
        distance < 0.52
      ) {
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

      if (
        distance < 0.7
      ) {
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

      const lightDirection =
        -dx - dy;

      if (
        distance < 0.9
      ) {
        ctx.fillStyle =
          lightDirection >
          0
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

function drawPixelMaria(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  seed: number,
  canvasWidth: number
) {
  const minX =
    Math.floor(
      centerX -
        radiusX
    );

  const maxX =
    Math.ceil(
      centerX +
        radiusX
    );

  const minY =
    Math.floor(
      centerY -
        radiusY
    );

  const maxY =
    Math.ceil(
      centerY +
        radiusY
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

      if (
        distance > 1
      ) {
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

      if (
        noise < 0.3
      ) {
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
   * Deliberately low resolution.
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
    canvas.getContext(
      "2d"
    );

  if (!ctx) {
    return null;
  }

  ctx.imageSmoothingEnabled =
    false;

  /* Base */

  ctx.fillStyle =
    MOON_PALETTE.mid;

  ctx.fillRect(
    0,
    0,
    width,
    height
  );

  /* Pixel grain */

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

      ctx.fillRect(
        x,
        y,
        2,
        2
      );
    }
  }

  /* Maria */

  for (
    let i = 0;
    i < 14;
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

  /* Large craters */

  const largeCraterCount =
    mobile
      ? 10
      : 15;

  for (
    let i = 0;
    i <
    largeCraterCount;
    i++
  ) {
    const x =
      Math.floor(
        seededRandom(
          i * 41 + 8
        ) * width
      );

    const y =
      Math.floor(
        height * 0.12 +
          seededRandom(
            i * 43 +
              10
          ) *
            height *
            0.76
      );

    const radius =
      4 +
      Math.floor(
        seededRandom(
          i * 47 +
            13
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

  /* Medium craters */

  const mediumCraterCount =
    mobile
      ? 28
      : 42;

  for (
    let i = 0;
    i <
    mediumCraterCount;
    i++
  ) {
    const x =
      Math.floor(
        seededRandom(
          i * 53 +
            17
        ) * width
      );

    const y =
      Math.floor(
        seededRandom(
          i * 59 +
            19
        ) * height
      );

    const radius =
      2 +
      Math.floor(
        seededRandom(
          i * 61 +
            23
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

  /* Tiny craters */

  const tinyCraterCount =
    mobile
      ? 70
      : 110;

  for (
    let i = 0;
    i <
    tinyCraterCount;
    i++
  ) {
    const x =
      Math.floor(
        seededRandom(
          i * 67 +
            31
        ) * width
      );

    const y =
      Math.floor(
        seededRandom(
          i * 71 +
            37
        ) * height
      );

    const radius =
      seededRandom(
        i * 73 +
          41
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
/*                       PROPORTIONAL HOLDER TREEMAP                          */
/* -------------------------------------------------------------------------- */

function buildTreemap(
  holders: Holder[]
): Territory[] {
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

    if (
      items.length ===
      1
    ) {
      result.push({
        holder:
          items[0],

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
      ) *
      2;

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
/*                          SPHERE POSITION HELPERS                           */
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

function surfacePosition(
  u: number,
  s: number,
  radius: number
) {
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
    -radius *
      Math.cos(
        longitude
      ) *
      cosLatitude,

    radius *
      Math.sin(
        latitude
      ),

    radius *
      Math.sin(
        longitude
      ) *
      cosLatitude
  );
}

function territoryCenterPosition(
  territory: Territory,
  radius =
    LABEL_RADIUS
) {
  return surfacePosition(
    (
      territory.u0 +
      territory.u1
    ) /
      2,

    (
      territory.s0 +
      territory.s1
    ) /
      2,

    radius
  );
}

/* -------------------------------------------------------------------------- */
/*                           UV -> HOLDER LOOKUP                              */
/* -------------------------------------------------------------------------- */

/*
 * SphereGeometry's UV.v is linear latitude.
 *
 * Our treemap's s coordinate is equal-area.
 *
 * Convert:
 *
 * UV v
 *   ↓
 * latitude
 *   ↓
 * sin(latitude)
 *   ↓
 * equal-area s
 */
function uvToEqualAreaS(
  v: number
) {
  const normalizedV =
    clamp(
      v,
      0,
      1
    );

  const latitude =
    normalizedV *
      Math.PI -
    Math.PI / 2;

  return (
    Math.sin(
      latitude
    ) +
    1
  ) / 2;
}

function getTerritoryAtUv(
  u: number,
  v: number,
  territories: Territory[]
) {
  const normalizedU =
    ((u % 1) + 1) %
    1;

  const s =
    uvToEqualAreaS(
      v
    );

  return (
    territories.find(
      (territory) => {
        const insideU =
          normalizedU >=
            territory.u0 &&
          (
            normalizedU <
              territory.u1 ||
            territory.u1 ===
              1
          );

        const insideS =
          s >=
            territory.s0 &&
          (
            s <
              territory.s1 ||
            territory.s1 ===
              1
          );

        return (
          insideU &&
          insideS
        );
      }
    ) ?? null
  );
}

/* -------------------------------------------------------------------------- */
/*                               HOLDER LABEL                                 */
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

  /*
   * Uses the same font currently applied to the page,
   * including Pixelify Sans when your layout applies it.
   */
  const pageFont =
    window.getComputedStyle(
      document.body
    ).fontFamily;

  ctx.font =
    `600 90px ${pageFont}`;

  ctx.shadowColor =
    "rgba(0,0,0,0.95)";

  ctx.shadowBlur = 18;

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
    width *
    0.25;

  return (
    <mesh
      /*
       * Important:
       * labels cannot steal mouse events from
       * the actual moon surface.
       */
      raycast={() => {}}
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
/*                                TOOLTIP                                     */
/* -------------------------------------------------------------------------- */

function HolderTooltip({
  territory,
}: {
  territory: Territory;
}) {
  const position =
    useMemo(
      () =>
        territoryCenterPosition(
          territory,
          TOOLTIP_RADIUS
        ),
      [territory]
    );

  return (
    <Html
      position={
        position
      }
      center
      occlude
      zIndexRange={[
        100,
        0,
      ]}
      style={{
        pointerEvents:
          "none",
      }}
    >
      <div className="w-max min-w-[170px] max-w-[260px] rounded-lg border border-white/10 bg-black/90 px-3 py-2 text-white shadow-xl backdrop-blur-md">
        <div className="text-[9px] uppercase tracking-[0.14em] text-white/35">
          Holder
        </div>

        <div className="mt-1 max-w-[230px] break-all text-[11px] leading-4 text-white">
          {
            territory
              .holder
              .address
          }
        </div>

        <div className="mt-2 flex items-end justify-between gap-6 border-t border-white/10 pt-2">
          <div>
            <div className="text-[9px] uppercase tracking-[0.12em] text-white/30">
              Tokens
            </div>

            <div className="mt-0.5 text-[11px] text-white/70">
              {formatTokenAmount(
                territory
                  .holder
                  .balance
              )}
            </div>
          </div>

          <div className="text-right">
            <div className="text-[9px] uppercase tracking-[0.12em] text-white/30">
              Share
            </div>

            <div className="mt-0.5 text-[11px] text-white/70">
              {(
                territory.share *
                100
              ).toFixed(2)}
              %
            </div>
          </div>
        </div>
      </div>
    </Html>
  );
}

/* -------------------------------------------------------------------------- */
/*                              AUTOMATIC SPIN                                */
/* -------------------------------------------------------------------------- */

function AutoSpin({
  children,
  paused,
}: {
  children: ReactNode;
  paused: boolean;
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

      /*
       * Freeze while inspecting a holder.
       */
      if (paused) {
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
    hovered,
    setHovered,
  ] =
    useState<Territory | null>(
      null
    );

  const [
    pinned,
    setPinned,
  ] =
    useState<Territory | null>(
      null
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

  useEffect(() => {
    return () => {
      document.body.style.cursor =
        "";
    };
  }, []);

  const activeTerritory =
    hovered ?? pinned;

  const segments =
    mobile
      ? 96
      : 160;

  return (
    <AutoSpin
      paused={
        activeTerritory !==
        null
      }
    >
      {/* Actual moon is now the ONLY hover surface */}
      <mesh
        onPointerMove={(
          event
        ) => {
          event.stopPropagation();

          if (!event.uv) {
            return;
          }

          const territory =
            getTerritoryAtUv(
              event.uv.x,
              event.uv.y,
              territories
            );

          setHovered(
            (current) =>
              current?.holder
                .address ===
              territory?.holder
                .address
                ? current
                : territory
          );

          document.body.style.cursor =
            territory
              ? "pointer"
              : "";
        }}
        onPointerOut={() => {
          setHovered(null);

          document.body.style.cursor =
            "";
        }}
        onClick={(
          event
        ) => {
          event.stopPropagation();

          if (!event.uv) {
            return;
          }

          const territory =
            getTerritoryAtUv(
              event.uv.x,
              event.uv.y,
              territories
            );

          if (!territory) {
            setPinned(null);
            return;
          }

          /*
           * Desktop:
           * clicking can pin the tooltip.
           *
           * Mobile:
           * tapping gives the same behavior.
           */
          setPinned(
            (current) =>
              current?.holder
                .address ===
              territory.holder
                .address
                ? null
                : territory
          );
        }}
      >
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

      {/* Tooltip */}
      {activeTerritory && (
        <HolderTooltip
          territory={
            activeTerritory
          }
        />
      )}

      {/* Visible wallet labels */}
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