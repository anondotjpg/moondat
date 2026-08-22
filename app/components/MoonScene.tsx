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
  ThreeEvent,
  useFrame,
  useThree,
} from "@react-three/fiber";
import {
  Html,
  Sparkles,
} from "@react-three/drei";
import * as THREE from "three";

type Holder = {
  address: string;
  balance: number;

  verified?: boolean;
  message?: string | null;
  verifiedAt?: string | null;
};

type MoonSceneProps = {
  holders: Holder[];
};

type Territory = {
  holder: Holder;

  rank: number;
  share: number;
  ring: number;

  /*
   * Angular position.
   *
   * Can intentionally go above 1 because
   * the mapping wraps naturally around 2π.
   */
  u0: number;
  u1: number;

  /*
   * Normalized cumulative REAL hill
   * surface area from summit -> base.
   *
   * 0 = summit
   * 1 = bottom edge
   */
  a0: number;
  a1: number;
};

/* -------------------------------------------------------------------------- */
/*                                  CONFIG                                    */
/* -------------------------------------------------------------------------- */

const HILL_RADIUS = 5.15;
const HILL_HEIGHT = 3.05;
const HILL_BASE_Y = -2.5;

const PATCH_LIFT = 0.014;
const BORDER_LIFT = 0.031;
const LABEL_LIFT = 0.048;
const TOOLTIP_LIFT = 0.22;

const PUMP_GREEN = "#55f58a";
const PUMP_GREEN_BRIGHT = "#adffc4";
const PUMP_GREEN_DARK = "#153c24";
const PUMP_GREEN_DEEP = "#06130a";

/*
 * 99 holders below #1.
 *
 * Each row becomes one clean concentric
 * band around the hill.
 *
 * 4 + 6 + 9 + 12 + 16 + 22 + 30 = 99
 */
const RING_COUNTS = [
  4,
  6,
  9,
  12,
  16,
  22,
  30,
];

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

function abbreviateAddress(
  address: string
) {
  if (
    address.length < 10
  ) {
    return address;
  }

  return `${address.slice(
    0,
    4
  )}…${address.slice(-4)}`;
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
/*                              ACTUAL HILL                                   */
/* -------------------------------------------------------------------------- */

/*
 * This is a real smooth mound profile.
 *
 * Not a sphere / hemisphere.
 *
 * smoothstep gives:
 *
 * - flat rounded summit
 * - natural shoulder
 * - smooth broad slope
 * - slope approaches zero at the base
 *
 *
 * side silhouette:
 *
 *                  ______
 *              ___/      \___
 *           __/              \__
 *        __/                    \__
 * _____/                          \_____
 */
function hillHeightAtRadius(
  radius: number
) {
  const t =
    clamp(
      radius /
        HILL_RADIUS,
      0,
      1
    );

  const smooth =
    t *
    t *
    (
      3 -
      2 * t
    );

  return (
    HILL_BASE_Y +
    HILL_HEIGHT *
      (
        1 -
        smooth
      )
  );
}

/*
 * derivative of:
 *
 * H * (1 - 3t² + 2t³)
 */
function hillDerivative(
  radius: number
) {
  const t =
    clamp(
      radius /
        HILL_RADIUS,
      0,
      1
    );

  return (
    HILL_HEIGHT *
    (
      -6 * t +
      6 * t * t
    ) /
    HILL_RADIUS
  );
}

function hillNormal(
  radius: number,
  angle: number
) {
  const derivative =
    hillDerivative(
      radius
    );

  return new THREE.Vector3(
    -derivative *
      Math.sin(
        angle
      ),

    1,

    -derivative *
      Math.cos(
        angle
      )
  ).normalize();
}

/* -------------------------------------------------------------------------- */
/*                        REAL SURFACE AREA MAPPING                           */
/* -------------------------------------------------------------------------- */

/*
 * For a radial surface:
 *
 * dA = 2π r sqrt(1 + y'(r)^2) dr
 *
 * We numerically integrate it once.
 *
 * This is important:
 *
 * A holder with 5% ownership gets
 * EXACTLY 5% of the hill's curved
 * surface area.
 */

const AREA_STEPS = 1800;

type AreaLookupItem = {
  radius: number;
  fraction: number;
};

function buildAreaLookup() {
  const raw: Array<{
    radius: number;
    area: number;
  }> = [];

  let cumulative =
    0;

  let previousIntegrand =
    0;

  raw.push({
    radius: 0,
    area: 0,
  });

  for (
    let index = 1;
    index <=
    AREA_STEPS;
    index++
  ) {
    const radius =
      (
        index /
        AREA_STEPS
      ) *
      HILL_RADIUS;

    const derivative =
      hillDerivative(
        radius
      );

    const integrand =
      radius *
      Math.sqrt(
        1 +
          derivative *
            derivative
      );

    const previousRadius =
      (
        (
          index -
          1
        ) /
        AREA_STEPS
      ) *
      HILL_RADIUS;

    const dr =
      radius -
      previousRadius;

    cumulative +=
      (
        previousIntegrand +
        integrand
      ) *
      0.5 *
      dr;

    raw.push({
      radius,
      area:
        cumulative,
    });

    previousIntegrand =
      integrand;
  }

  const total =
    cumulative;

  return raw.map(
    (
      item
    ): AreaLookupItem => ({
      radius:
        item.radius,

      fraction:
        total > 0
          ? item.area /
            total
          : 0,
    })
  );
}

const AREA_LOOKUP =
  buildAreaLookup();

function areaFractionToRadius(
  areaFraction: number
) {
  const target =
    clamp(
      areaFraction,
      0,
      1
    );

  if (
    target <= 0
  ) {
    return 0;
  }

  if (
    target >= 1
  ) {
    return HILL_RADIUS;
  }

  let low =
    0;

  let high =
    AREA_LOOKUP.length -
    1;

  while (
    low <= high
  ) {
    const middle =
      Math.floor(
        (
          low +
          high
        ) /
          2
      );

    if (
      AREA_LOOKUP[
        middle
      ].fraction <
      target
    ) {
      low =
        middle +
        1;
    } else {
      high =
        middle -
        1;
    }
  }

  const upperIndex =
    clamp(
      low,
      1,
      AREA_LOOKUP.length -
        1
    );

  const lowerIndex =
    upperIndex -
    1;

  const lower =
    AREA_LOOKUP[
      lowerIndex
    ];

  const upper =
    AREA_LOOKUP[
      upperIndex
    ];

  const range =
    upper.fraction -
    lower.fraction;

  const t =
    range > 0
      ? (
          target -
          lower.fraction
        ) /
        range
      : 0;

  return THREE.MathUtils.lerp(
    lower.radius,
    upper.radius,
    t
  );
}

/* -------------------------------------------------------------------------- */
/*                           SURFACE POSITION                                 */
/* -------------------------------------------------------------------------- */

function hillSurfacePosition(
  u: number,
  area: number,
  lift = 0
) {
  const angle =
    (
      u -
      0.5
    ) *
    Math.PI *
    2;

  const radius =
    areaFractionToRadius(
      area
    );

  const point =
    new THREE.Vector3(
      radius *
        Math.sin(
          angle
        ),

      hillHeightAtRadius(
        radius
      ),

      radius *
        Math.cos(
          angle
        )
    );

  if (
    lift !== 0
  ) {
    point.addScaledVector(
      hillNormal(
        radius,
        angle
      ),
      lift
    );
  }

  return point;
}

/* -------------------------------------------------------------------------- */
/*                            TANGENT FRAME                                   */
/* -------------------------------------------------------------------------- */

/*
 * Builds a local coordinate frame directly
 * against the hill.
 *
 * X = across the hill
 * Y = uphill
 * Z = outward normal
 *
 * This is what makes the address text lie
 * FLAT against the terrain instead of
 * floating / billboard-facing the camera.
 */
function hillSurfaceQuaternion(
  u: number,
  area: number
) {
  const angle =
    (
      u -
      0.5
    ) *
    Math.PI *
    2;

  const radius =
    areaFractionToRadius(
      area
    );

  const derivative =
    hillDerivative(
      radius
    );

  const right =
    new THREE.Vector3(
      Math.cos(
        angle
      ),
      0,
      -Math.sin(
        angle
      )
    ).normalize();

  /*
   * Negative radial tangent =
   * direction pointing uphill.
   */
  const uphill =
    new THREE.Vector3(
      -Math.sin(
        angle
      ),

      -derivative,

      -Math.cos(
        angle
      )
    ).normalize();

  const normal =
    right
      .clone()
      .cross(
        uphill
      )
      .normalize();

  const matrix =
    new THREE.Matrix4();

  matrix.makeBasis(
    right,
    uphill,
    normal
  );

  return new THREE.Quaternion()
    .setFromRotationMatrix(
      matrix
    );
}

/* -------------------------------------------------------------------------- */
/*                         CLEAN SURFACE DIVISION                             */
/* -------------------------------------------------------------------------- */

/*
 * Instead of recursive random rectangles,
 * the hill is now divided like a clean
 * topographical / land-ownership map.
 *
 *
 *           [ #1 summit cap ]
 *
 *       [ #2 ][ #3 ][ #4 ][ #5 ]
 *
 *     [        next clean ring        ]
 *
 *   [             next ring             ]
 *
 * [                 base ring               ]
 *
 *
 * Every ring receives exactly the combined
 * surface-area share of its holders.
 *
 * Within that ring, angular width is
 * proportional to each holder balance.
 *
 * Therefore:
 *
 * ring area × angular share
 *
 * = exact holder surface area.
 */
function buildTerritories(
  holders: Holder[]
): Territory[] {
  const sorted =
    [...holders]
      .filter(
        (
          holder
        ) =>
          holder.balance >
          0
      )
      .sort(
        (
          a,
          b
        ) =>
          b.balance -
          a.balance
      )
      .slice(
        0,
        100
      );

  if (
    sorted.length === 0
  ) {
    return [];
  }

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
    total <= 0
  ) {
    return [];
  }

  const territories:
    Territory[] = [];

  /* ---------------------------------------------------------------------- */
  /* King                                                                   */
  /* ---------------------------------------------------------------------- */

  const king =
    sorted[0];

  const kingShare =
    king.balance /
    total;

  /*
   * #1 gets a true circular summit.
   */
  territories.push({
    holder:
      king,

    rank:
      1,

    share:
      kingShare,

    ring:
      0,

    u0:
      0,

    u1:
      1,

    a0:
      0,

    a1:
      kingShare,
  });

  let holderCursor =
    1;

  let areaCursor =
    kingShare;

  /* ---------------------------------------------------------------------- */
  /* Rings                                                                  */
  /* ---------------------------------------------------------------------- */

  for (
    let ringIndex = 0;
    ringIndex <
    RING_COUNTS.length;
    ringIndex++
  ) {
    if (
      holderCursor >=
      sorted.length
    ) {
      break;
    }

    const desiredCount =
      RING_COUNTS[
        ringIndex
      ];

    const ringHolders =
      sorted.slice(
        holderCursor,
        Math.min(
          holderCursor +
            desiredCount,
          sorted.length
        )
      );

    if (
      ringHolders.length ===
      0
    ) {
      break;
    }

    const ringBalance =
      ringHolders.reduce(
        (
          sum,
          holder
        ) =>
          sum +
          holder.balance,
        0
      );

    const ringShare =
      ringBalance /
      total;

    const ringA0 =
      areaCursor;

    const ringA1 =
      Math.min(
        1,
        areaCursor +
          ringShare
      );

    /*
     * Stagger every ring so boundaries
     * don't line up into ugly vertical
     * longitude seams.
     */
    const angularOffset =
      (
        0.08 +
        ringIndex *
          0.137
      ) %
      1;

    let angularCursor =
      angularOffset;

    for (
      let localIndex = 0;
      localIndex <
      ringHolders.length;
      localIndex++
    ) {
      const holder =
        ringHolders[
          localIndex
        ];

      const angularShare =
        ringBalance > 0
          ? holder.balance /
            ringBalance
          : 0;

      territories.push({
        holder,

        rank:
          holderCursor +
          localIndex +
          1,

        share:
          holder.balance /
          total,

        ring:
          ringIndex +
          1,

        u0:
          angularCursor,

        u1:
          angularCursor +
          angularShare,

        a0:
          ringA0,

        a1:
          ringA1,
      });

      angularCursor +=
        angularShare;
    }

    holderCursor +=
      ringHolders.length;

    areaCursor =
      ringA1;
  }

  /*
   * Safety fallback in case holder count
   * ever exceeds the current ring plan.
   */
  if (
    holderCursor <
    sorted.length
  ) {
    const leftovers =
      sorted.slice(
        holderCursor
      );

    const leftoverBalance =
      leftovers.reduce(
        (
          sum,
          holder
        ) =>
          sum +
          holder.balance,
        0
      );

    let u =
      0.11;

    leftovers.forEach(
      (
        holder,
        index
      ) => {
        const angularShare =
          holder.balance /
          leftoverBalance;

        territories.push({
          holder,

          rank:
            holderCursor +
            index +
            1,

          share:
            holder.balance /
            total,

          ring:
            8,

          u0:
            u,

          u1:
            u +
            angularShare,

          a0:
            areaCursor,

          a1:
            1,
        });

        u +=
          angularShare;
      }
    );
  }

  return territories;
}

/* -------------------------------------------------------------------------- */
/*                              HILL GEOMETRY                                 */
/* -------------------------------------------------------------------------- */

function createHillGeometry() {
  const radialSegments =
    100;

  const angularSegments =
    200;

  const positions:
    number[] = [];

  const normals:
    number[] = [];

  const indices:
    number[] = [];

  for (
    let radial = 0;
    radial <=
    radialSegments;
    radial++
  ) {
    const radius =
      (
        radial /
        radialSegments
      ) *
      HILL_RADIUS;

    for (
      let angular = 0;
      angular <=
      angularSegments;
      angular++
    ) {
      const u =
        angular /
        angularSegments;

      const angle =
        (
          u -
          0.5
        ) *
        Math.PI *
        2;

      const normal =
        hillNormal(
          radius,
          angle
        );

      positions.push(
        radius *
          Math.sin(
            angle
          ),

        hillHeightAtRadius(
          radius
        ),

        radius *
          Math.cos(
            angle
          )
      );

      normals.push(
        normal.x,
        normal.y,
        normal.z
      );
    }
  }

  for (
    let radial = 0;
    radial <
    radialSegments;
    radial++
  ) {
    for (
      let angular = 0;
      angular <
      angularSegments;
      angular++
    ) {
      const a =
        radial *
          (
            angularSegments +
            1
          ) +
        angular;

      const b =
        a + 1;

      const c =
        a +
        (
          angularSegments +
          1
        );

      const d =
        c + 1;

      indices.push(
        a,
        c,
        b,

        b,
        c,
        d
      );
    }
  }

  const geometry =
    new THREE.BufferGeometry();

  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      positions,
      3
    )
  );

  geometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(
      normals,
      3
    )
  );

  geometry.setIndex(
    indices
  );

  geometry.computeBoundingSphere();

  return geometry;
}

/* -------------------------------------------------------------------------- */
/*                          TERRITORY GEOMETRY                                */
/* -------------------------------------------------------------------------- */

function createTerritoryGeometry(
  territory: Territory
) {
  const uRange =
    territory.u1 -
    territory.u0;

  const aRange =
    territory.a1 -
    territory.a0;

  const angularSegments =
    Math.max(
      5,
      Math.ceil(
        uRange *
          100
      )
    );

  const radialSegments =
    Math.max(
      4,
      Math.ceil(
        aRange *
          90
      )
    );

  const positions:
    number[] = [];

  const normals:
    number[] = [];

  const indices:
    number[] = [];

  for (
    let radial = 0;
    radial <=
    radialSegments;
    radial++
  ) {
    const radialT =
      radial /
      radialSegments;

    const area =
      territory.a0 +
      (
        territory.a1 -
        territory.a0
      ) *
        radialT;

    const radius =
      areaFractionToRadius(
        area
      );

    for (
      let angular = 0;
      angular <=
      angularSegments;
      angular++
    ) {
      const angularT =
        angular /
        angularSegments;

      const u =
        territory.u0 +
        (
          territory.u1 -
          territory.u0
        ) *
          angularT;

      const angle =
        (
          u -
          0.5
        ) *
        Math.PI *
        2;

      const point =
        hillSurfacePosition(
          u,
          area,
          PATCH_LIFT
        );

      const normal =
        hillNormal(
          radius,
          angle
        );

      positions.push(
        point.x,
        point.y,
        point.z
      );

      normals.push(
        normal.x,
        normal.y,
        normal.z
      );
    }
  }

  for (
    let radial = 0;
    radial <
    radialSegments;
    radial++
  ) {
    for (
      let angular = 0;
      angular <
      angularSegments;
      angular++
    ) {
      const a =
        radial *
          (
            angularSegments +
            1
          ) +
        angular;

      const b =
        a + 1;

      const c =
        a +
        (
          angularSegments +
          1
        );

      const d =
        c + 1;

      indices.push(
        a,
        c,
        b,

        b,
        c,
        d
      );
    }
  }

  const geometry =
    new THREE.BufferGeometry();

  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      positions,
      3
    )
  );

  geometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(
      normals,
      3
    )
  );

  geometry.setIndex(
    indices
  );

  geometry.computeBoundingSphere();

  return geometry;
}

/* -------------------------------------------------------------------------- */
/*                           TERRITORY BORDER                                 */
/* -------------------------------------------------------------------------- */

function createTerritoryBorder(
  territory: Territory
) {
  const positions:
    number[] = [];

  function add(
    a: THREE.Vector3,
    b: THREE.Vector3
  ) {
    positions.push(
      a.x,
      a.y,
      a.z,

      b.x,
      b.y,
      b.z
    );
  }

  /*
   * Summit cap only needs outer circle.
   */
  if (
    territory.rank ===
    1
  ) {
    const segments =
      150;

    for (
      let index = 0;
      index <
      segments;
      index++
    ) {
      const u0 =
        index /
        segments;

      const u1 =
        (
          index +
          1
        ) /
        segments;

      add(
        hillSurfacePosition(
          u0,
          territory.a1,
          BORDER_LIFT
        ),

        hillSurfacePosition(
          u1,
          territory.a1,
          BORDER_LIFT
        )
      );
    }

    const geometry =
      new THREE.BufferGeometry();

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        positions,
        3
      )
    );

    return geometry;
  }

  const angularSegments =
    Math.max(
      6,
      Math.ceil(
        (
          territory.u1 -
          territory.u0
        ) *
          100
      )
    );

  const radialSegments =
    Math.max(
      5,
      Math.ceil(
        (
          territory.a1 -
          territory.a0
        ) *
          75
      )
    );

  /* inner curved edge */

  for (
    let index = 0;
    index <
    angularSegments;
    index++
  ) {
    const t0 =
      index /
      angularSegments;

    const t1 =
      (
        index +
        1
      ) /
      angularSegments;

    add(
      hillSurfacePosition(
        THREE.MathUtils.lerp(
          territory.u0,
          territory.u1,
          t0
        ),
        territory.a0,
        BORDER_LIFT
      ),

      hillSurfacePosition(
        THREE.MathUtils.lerp(
          territory.u0,
          territory.u1,
          t1
        ),
        territory.a0,
        BORDER_LIFT
      )
    );
  }

  /* outer curved edge */

  for (
    let index = 0;
    index <
    angularSegments;
    index++
  ) {
    const t0 =
      index /
      angularSegments;

    const t1 =
      (
        index +
        1
      ) /
      angularSegments;

    add(
      hillSurfacePosition(
        THREE.MathUtils.lerp(
          territory.u0,
          territory.u1,
          t0
        ),
        territory.a1,
        BORDER_LIFT
      ),

      hillSurfacePosition(
        THREE.MathUtils.lerp(
          territory.u0,
          territory.u1,
          t1
        ),
        territory.a1,
        BORDER_LIFT
      )
    );
  }

  /*
   * Only two clean radial separators.
   */

  for (
    let index = 0;
    index <
    radialSegments;
    index++
  ) {
    const t0 =
      index /
      radialSegments;

    const t1 =
      (
        index +
        1
      ) /
      radialSegments;

    const a0 =
      THREE.MathUtils.lerp(
        territory.a0,
        territory.a1,
        t0
      );

    const a1 =
      THREE.MathUtils.lerp(
        territory.a0,
        territory.a1,
        t1
      );

    add(
      hillSurfacePosition(
        territory.u0,
        a0,
        BORDER_LIFT
      ),

      hillSurfacePosition(
        territory.u0,
        a1,
        BORDER_LIFT
      )
    );

    add(
      hillSurfacePosition(
        territory.u1,
        a0,
        BORDER_LIFT
      ),

      hillSurfacePosition(
        territory.u1,
        a1,
        BORDER_LIFT
      )
    );
  }

  const geometry =
    new THREE.BufferGeometry();

  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      positions,
      3
    )
  );

  return geometry;
}

/* -------------------------------------------------------------------------- */
/*                            TERRITORY SIZE                                  */
/* -------------------------------------------------------------------------- */

function getTerritoryPhysicalSize(
  territory: Territory
) {
  const middleArea =
    (
      territory.a0 +
      territory.a1
    ) /
      2;

  const radius =
    areaFractionToRadius(
      middleArea
    );

  const angularWidth =
    Math.max(
      0.001,

      (
        territory.u1 -
        territory.u0
      ) *
        Math.PI *
        2 *
        radius
    );

  /*
   * Approximate true radial distance over
   * the curved hill.
   */
  const steps =
    12;

  let radialLength =
    0;

  let previous =
    hillSurfacePosition(
      0.5,
      territory.a0
    );

  for (
    let index = 1;
    index <= steps;
    index++
  ) {
    const area =
      THREE.MathUtils.lerp(
        territory.a0,
        territory.a1,
        index /
          steps
      );

    const point =
      hillSurfacePosition(
        0.5,
        area
      );

    radialLength +=
      point.distanceTo(
        previous
      );

    previous =
      point;
  }

  return {
    angularWidth,
    radialLength,
  };
}

/* -------------------------------------------------------------------------- */
/*                              LABEL TEXTURE                                 */
/* -------------------------------------------------------------------------- */

function createLabelTexture(
  holder: Holder
) {
  if (
    typeof document ===
    "undefined"
  ) {
    return null;
  }

  const canvas =
    document.createElement(
      "canvas"
    );

  canvas.width =
    1024;

  canvas.height =
    220;

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

  const pageFont =
    window.getComputedStyle(
      document.body
    ).fontFamily;

  ctx.font =
    `600 78px ${pageFont}`;

  /*
   * Smaller shadow because text now sits
   * directly against the hill instead of
   * floating above it.
   */
  ctx.shadowColor =
    "rgba(0,0,0,0.95)";

  ctx.shadowBlur =
    9;

  ctx.fillStyle =
    holder.verified
      ? "#adffc4"
      : "rgba(240,255,245,0.92)";

  ctx.fillText(
    abbreviateAddress(
      holder.address
    ),
    canvas.width /
      2,
    canvas.height /
      2
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

  texture.generateMipmaps =
    false;

  return texture;
}

/* -------------------------------------------------------------------------- */
/*                             FLAT HILL LABEL                                */
/* -------------------------------------------------------------------------- */

function TerritoryLabel({
  territory,
  largestShare,
  mobile,
}: {
  territory: Territory;
  largestShare: number;
  mobile: boolean;
}) {
  const texture =
    useMemo(
      () =>
        createLabelTexture(
          territory.holder
        ),
      [
        territory.holder
          .address,
        territory.holder
          .verified,
      ]
    );

  useEffect(() => {
    return () => {
      texture?.dispose();
    };
  }, [
    texture,
  ]);

  const physicalSize =
    useMemo(
      () =>
        getTerritoryPhysicalSize(
          territory
        ),
      [
        territory,
      ]
    );

  /*
   * King's label is intentionally moved
   * toward the front half of the summit cap.
   *
   * A full circular cap has no meaningful
   * angular "center".
   */
  const centerU =
    territory.rank ===
    1
      ? 0.5
      : (
          territory.u0 +
          territory.u1
        ) /
          2;

  const centerArea =
    territory.rank ===
    1
      ? territory.a1 *
        0.42
      : (
          territory.a0 +
          territory.a1
        ) /
          2;

  const position =
    useMemo(
      () =>
        hillSurfacePosition(
          centerU,
          centerArea,
          LABEL_LIFT
        ),
      [
        centerU,
        centerArea,
      ]
    );

  const quaternion =
    useMemo(
      () =>
        hillSurfaceQuaternion(
          centerU,
          centerArea
        ),
      [
        centerU,
        centerArea,
      ]
    );

  if (!texture) {
    return null;
  }

  const relative =
    territory.share /
    Math.max(
      largestShare,
      0.000001
    );

  /*
   * Desired label size.
   */
  let width =
    (
      0.36 +
      Math.sqrt(
        relative
      ) *
        0.78
    ) *
    (
      mobile
        ? 0.82
        : 1
    );

  /*
   * CRITICAL:
   *
   * Clamp the address to the actual physical
   * dimensions of its own land plot.
   *
   * This prevents text spilling across
   * boundaries / clipping over neighbors.
   */
  if (
    territory.rank !==
    1
  ) {
    width =
      Math.min(
        width,

        physicalSize.angularWidth *
          0.72,

        physicalSize.radialLength *
          3.15
      );
  }

  width =
    clamp(
      width,
      mobile
        ? 0.12
        : 0.14,
      mobile
        ? 0.72
        : 1.02
    );

  const height =
    width *
    0.215;

  return (
    <mesh
      position={
        position
      }
      quaternion={
        quaternion
      }
      raycast={() => {}}
      renderOrder={7}
    >
      <planeGeometry
        args={[
          width,
          height,
        ]}
      />

      <meshBasicMaterial
        map={
          texture
        }
        transparent
        alphaTest={
          0.025
        }
        depthTest
        depthWrite={
          false
        }
        toneMapped={
          false
        }
        side={
          THREE.FrontSide
        }
        polygonOffset
        polygonOffsetFactor={
          -2
        }
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
  const u =
    territory.rank ===
    1
      ? 0.5
      : (
          territory.u0 +
          territory.u1
        ) /
          2;

  const area =
    territory.rank ===
    1
      ? territory.a1 *
        0.45
      : (
          territory.a0 +
          territory.a1
        ) /
          2;

  const position =
    useMemo(
      () =>
        hillSurfacePosition(
          u,
          area,
          TOOLTIP_LIFT
        ),
      [
        u,
        area,
      ]
    );

  return (
    <Html
      position={
        position
      }
      center
      zIndexRange={[
        100,
        0,
      ]}
      style={{
        pointerEvents:
          "none",
      }}
    >
      <div className="w-max min-w-[190px] max-w-[280px] rounded-xl border border-[#55f58a]/25 bg-black/95 p-3 text-white shadow-[0_14px_50px_rgba(0,0,0,0.65)] backdrop-blur-md">
        <div className="flex items-center justify-between gap-5">
          <span className="text-[9px] uppercase tracking-[0.14em] text-[#55f58a]">
            {territory.rank ===
            1
              ? "king of the hill"
              : `rank #${territory.rank}`}
          </span>

          {territory.holder
            .verified && (
            <span className="text-[9px] uppercase tracking-[0.1em] text-[#adffc4]">
              ✓ verified
            </span>
          )}
        </div>

        <div className="mt-2 max-w-[245px] break-all text-[11px] leading-4 text-white/90">
          {
            territory.holder
              .address
          }
        </div>

        {territory.holder
          .verified &&
          territory.holder
            .message && (
            <div className="mt-2 border-t border-white/10 pt-2">
              <div className="text-[9px] uppercase tracking-[0.12em] text-white/30">
                holder message
              </div>

              <div className="mt-1.5 text-xs leading-4 text-[#c6ffd5]">
                “
                {
                  territory.holder
                    .message
                }
                ”
              </div>
            </div>
          )}

        <div className="mt-3 grid grid-cols-2 gap-6 border-t border-white/10 pt-2">
          <div>
            <div className="text-[9px] uppercase tracking-[0.12em] text-white/30">
              holdings
            </div>

            <div className="mt-0.5 text-xs text-white/70">
              {formatTokenAmount(
                territory.holder
                  .balance
              )}
            </div>
          </div>

          <div className="text-right">
            <div className="text-[9px] uppercase tracking-[0.12em] text-white/30">
              hill share
            </div>

            <div className="mt-0.5 text-xs text-[#55f58a]">
              {(
                territory.share *
                100
              ).toFixed(
                2
              )}
              %
            </div>
          </div>
        </div>
      </div>
    </Html>
  );
}

/* -------------------------------------------------------------------------- */
/*                            TERRITORY COLOR                                 */
/* -------------------------------------------------------------------------- */

function getTerritoryColor(
  territory: Territory,
  count: number,
  active: boolean
) {
  const rankStrength =
    count <= 1
      ? 1
      : 1 -
        (
          territory.rank -
          1
        ) /
          (
            count -
            1
          );

  const low =
    new THREE.Color(
      "#102b1a"
    );

  const high =
    new THREE.Color(
      "#3ebf6b"
    );

  low.lerp(
    high,
    0.08 +
      Math.pow(
        rankStrength,
        1.4
      ) *
        0.55
  );

  /*
   * Very subtle ring alternation.
   *
   * Enough to separate groups without
   * turning the hill into a rainbow.
   */
  if (
    territory.ring %
      2 ===
    0
  ) {
    low.multiplyScalar(
      0.9
    );
  }

  if (
    territory.rank ===
    1
  ) {
    low.set(
      "#51dc7c"
    );
  }

  if (
    territory.holder
      .verified
  ) {
    low.lerp(
      new THREE.Color(
        PUMP_GREEN_BRIGHT
      ),
      0.12
    );
  }

  if (
    active
  ) {
    low.lerp(
      new THREE.Color(
        PUMP_GREEN_BRIGHT
      ),
      0.42
    );
  }

  return low;
}

/* -------------------------------------------------------------------------- */
/*                            TERRITORY PATCH                                 */
/* -------------------------------------------------------------------------- */

function TerritoryPatch({
  territory,
  count,
  largestShare,
  active,
  mobile,
  onHover,
  onPin,
}: {
  territory: Territory;
  count: number;
  largestShare: number;
  active: boolean;
  mobile: boolean;

  onHover: (
    address:
      | string
      | null
  ) => void;

  onPin: (
    address:
      | string
      | null
  ) => void;
}) {
  const geometry =
    useMemo(
      () =>
        createTerritoryGeometry(
          territory
        ),
      [
        territory,
      ]
    );

  const border =
    useMemo(
      () =>
        createTerritoryBorder(
          territory
        ),
      [
        territory,
      ]
    );

  useEffect(() => {
    return () => {
      geometry.dispose();
      border.dispose();
    };
  }, [
    geometry,
    border,
  ]);

  const color =
    useMemo(
      () =>
        getTerritoryColor(
          territory,
          count,
          active
        ),
      [
        territory,
        count,
        active,
      ]
    );

  function handlePointerOver(
    event: ThreeEvent<PointerEvent>
  ) {
    event.stopPropagation();

    onHover(
      territory.holder
        .address
    );

    document.body.style.cursor =
      "pointer";
  }

  function handlePointerOut(
    event: ThreeEvent<PointerEvent>
  ) {
    event.stopPropagation();

    onHover(
      null
    );

    document.body.style.cursor =
      "";
  }

  return (
    <>
      <mesh
        geometry={
          geometry
        }
        onPointerOver={
          handlePointerOver
        }
        onPointerOut={
          handlePointerOut
        }
        onClick={(
          event
        ) => {
          event.stopPropagation();

          onPin(
            active
              ? null
              : territory.holder
                  .address
          );
        }}
      >
        <meshStandardMaterial
          color={
            color
          }
          roughness={
            0.94
          }
          metalness={
            0
          }
          emissive={
            active ||
            territory.rank ===
              1
              ? PUMP_GREEN
              : PUMP_GREEN_DEEP
          }
          emissiveIntensity={
            active
              ? 0.12
              : territory.rank ===
                  1
                ? 0.07
                : 0.004
          }
        />
      </mesh>

      <lineSegments
        geometry={
          border
        }
        raycast={() => {}}
        renderOrder={5}
      >
        <lineBasicMaterial
          color={
            active
              ? PUMP_GREEN_BRIGHT
              : PUMP_GREEN
          }
          transparent
          opacity={
            active
              ? 0.68
              : territory.rank ===
                  1
                ? 0.34
                : 0.14
          }
          depthWrite={
            false
          }
        />
      </lineSegments>

      <TerritoryLabel
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
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                               KING MARKER                                  */
/* -------------------------------------------------------------------------- */

function KingMarker({
  king,
}: {
  king:
    | Territory
    | undefined;
}) {
  if (!king) {
    return null;
  }

  const summitY =
    hillHeightAtRadius(
      0
    );

  return (
    <group>
      {/* tiny pole */}
      <mesh
        position={[
          0,
          summitY +
            0.29,
          0,
        ]}
        raycast={() => {}}
      >
        <cylinderGeometry
          args={[
            0.012,
            0.012,
            0.58,
            8,
          ]}
        />

        <meshBasicMaterial
          color="#d7ffe2"
        />
      </mesh>

      {/* flag */}
      <mesh
        position={[
          0.18,
          summitY +
            0.46,
          0,
        ]}
        raycast={() => {}}
      >
        <planeGeometry
          args={[
            0.36,
            0.2,
          ]}
        />

        <meshStandardMaterial
          color={
            PUMP_GREEN
          }
          emissive={
            PUMP_GREEN
          }
          emissiveIntensity={
            0.22
          }
          side={
            THREE.DoubleSide
          }
        />
      </mesh>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*                                BASE HILL                                   */
/* -------------------------------------------------------------------------- */

function BaseHill() {
  const geometry =
    useMemo(
      () =>
        createHillGeometry(),
      []
    );

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [
    geometry,
  ]);

  return (
    <>
      <mesh
        geometry={
          geometry
        }
        raycast={() => {}}
      >
        <meshStandardMaterial
          color="#09170e"
          roughness={1}
          metalness={0}
        />
      </mesh>

      {/* subtle clean outer edge */}
      <mesh
        rotation={[
          Math.PI /
            2,
          0,
          0,
        ]}
        position={[
          0,
          HILL_BASE_Y +
            0.012,
          0,
        ]}
        raycast={() => {}}
      >
        <torusGeometry
          args={[
            HILL_RADIUS +
              0.012,
            0.018,
            8,
            200,
          ]}
        />

        <meshBasicMaterial
          color={
            PUMP_GREEN
          }
          transparent
          opacity={
            0.42
          }
        />
      </mesh>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                              ROTATION                                      */
/* -------------------------------------------------------------------------- */

function SlowRotate({
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

  useFrame(
    (
      _,
      delta
    ) => {
      if (
        !group.current ||
        paused
      ) {
        return;
      }

      group.current.rotation.y +=
        delta *
        0.032;
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
/*                              HOLDER HILL                                   */
/* -------------------------------------------------------------------------- */

function HolderHill({
  holders,
  mobile,
}: {
  holders: Holder[];
  mobile: boolean;
}) {
  const territories =
    useMemo(
      () =>
        buildTerritories(
          holders
        ),
      [
        holders,
      ]
    );

  const [
    hoveredAddress,
    setHoveredAddress,
  ] =
    useState<
      string | null
    >(null);

  const [
    pinnedAddress,
    setPinnedAddress,
  ] =
    useState<
      string | null
    >(null);

  useEffect(() => {
    return () => {
      document.body.style.cursor =
        "";
    };
  }, []);

  const activeAddress =
    hoveredAddress ??
    pinnedAddress;

  const activeTerritory =
    useMemo(
      () =>
        territories.find(
          (
            territory
          ) =>
            territory.holder
              .address ===
            activeAddress
        ) ??
        null,
      [
        territories,
        activeAddress,
      ]
    );

  const largestShare =
    territories[0]
      ?.share ??
    0;

  return (
    <>
      <BaseHill />

      <SlowRotate
        paused={
          Boolean(
            activeAddress
          )
        }
      >
        {territories.map(
          (
            territory
          ) => (
            <TerritoryPatch
              key={
                territory.holder
                  .address
              }
              territory={
                territory
              }
              count={
                territories.length
              }
              largestShare={
                largestShare
              }
              active={
                territory.holder
                  .address ===
                activeAddress
              }
              mobile={
                mobile
              }
              onHover={
                setHoveredAddress
              }
              onPin={(
                address
              ) => {
                setPinnedAddress(
                  (
                    current
                  ) =>
                    current ===
                    address
                      ? null
                      : address
                );
              }}
            />
          )
        )}

        {activeTerritory && (
          <HolderTooltip
            territory={
              activeTerritory
            }
          />
        )}
      </SlowRotate>

      <KingMarker
        king={
          territories[0]
        }
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  GROUND                                    */
/* -------------------------------------------------------------------------- */

function Ground() {
  return (
    <>
      <mesh
        rotation={[
          -Math.PI /
            2,
          0,
          0,
        ]}
        position={[
          0,
          HILL_BASE_Y -
            0.035,
          0,
        ]}
        raycast={() => {}}
      >
        <planeGeometry
          args={[
            34,
            34,
          ]}
        />

        <meshBasicMaterial
          color="#010302"
        />
      </mesh>

      <gridHelper
        args={[
          28,
          56,
          "#11351e",
          "#06120a",
        ]}
        position={[
          0,
          HILL_BASE_Y -
            0.02,
          0,
        ]}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  CAMERA                                    */
/* -------------------------------------------------------------------------- */

function ResponsiveCamera() {
  const {
    camera,
    size,
  } =
    useThree();

  useEffect(() => {
    const perspective =
      camera as THREE.PerspectiveCamera;

    const mobile =
      size.width <
      640;

    if (
      mobile
    ) {
      perspective.position.set(
        0,
        5.9,
        18
      );

      perspective.fov =
        46;

      /*
       * Slight downward view:
       *
       * whole circular base is visible,
       * but still low enough to read
       * the hill silhouette.
       */
      perspective.lookAt(
        0,
        -0.65,
        0
      );
    } else {
      perspective.position.set(
        0,
        5.6,
        12.9
      );

      perspective.fov =
        40;

      perspective.lookAt(
        0,
        -0.45,
        0
      );
    }

    perspective.updateProjectionMatrix();
  }, [
    camera,
    size.width,
  ]);

  return null;
}

/* -------------------------------------------------------------------------- */
/*                                  SCENE                                     */
/* -------------------------------------------------------------------------- */

function SceneContent({
  holders,
}: MoonSceneProps) {
  const {
    size,
  } =
    useThree();

  const mobile =
    size.width <
    640;

  const scale:
    [
      number,
      number,
      number
    ] =
    mobile
      ? [
          0.72,
          0.82,
          0.72,
        ]
      : [
          1,
          1,
          1,
        ];

  const position:
    [
      number,
      number,
      number
    ] =
    mobile
      ? [
          0,
          -0.95,
          0,
        ]
      : [
          0,
          -0.42,
          0,
        ];

  return (
    <>
      <ResponsiveCamera />

      <fog
        attach="fog"
        args={[
          "#000000",
          mobile
            ? 18
            : 14,
          mobile
            ? 34
            : 27,
        ]}
      />

      <ambientLight
        intensity={
          0.42
        }
      />

      <directionalLight
        position={[
          -5,
          9,
          8,
        ]}
        intensity={
          2.15
        }
      />

      <directionalLight
        position={[
          5,
          2,
          -5,
        ]}
        intensity={
          0.22
        }
        color={
          PUMP_GREEN
        }
      />

      <pointLight
        position={[
          0,
          5,
          5,
        ]}
        intensity={
          4
        }
        distance={
          16
        }
        decay={2}
        color={
          PUMP_GREEN
        }
      />

      <group
        position={
          position
        }
        scale={
          scale
        }
      >
        <Ground />

        <HolderHill
          holders={
            holders
          }
          mobile={
            mobile
          }
        />
      </group>

      <Sparkles
        count={
          mobile
            ? 12
            : 22
        }
        scale={[
          mobile
            ? 9
            : 14,
          8,
          8,
        ]}
        position={[
          0,
          0,
          -3,
        ]}
        size={
          mobile
            ? 0.6
            : 0.85
        }
        speed={
          0.05
        }
        opacity={
          0.1
        }
        color={
          PUMP_GREEN
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
          5.6,
          12.9,
        ],

        fov:
          40,

        near:
          0.1,

        far:
          100,
      }}
      gl={{
        antialias:
          true,

        alpha:
          false,

        powerPreference:
          "high-performance",
      }}
      onPointerMissed={() => {
        document.body.style.cursor =
          "";
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