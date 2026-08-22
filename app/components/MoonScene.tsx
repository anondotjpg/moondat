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
   * Angular ownership around the hill.
   * May exceed 1 because it naturally wraps.
   */
  u0: number;
  u1: number;

  /*
   * Cumulative REAL hill surface area.
   *
   * 0 = summit
   * 1 = bottom
   */
  a0: number;
  a1: number;
};

/* -------------------------------------------------------------------------- */
/*                                   CONFIG                                   */
/* -------------------------------------------------------------------------- */

const HILL_RADIUS = 5.15;
const HILL_HEIGHT = 3.15;
const HILL_BASE_Y = -2.55;

const PATCH_LIFT = 0.012;
const LINE_LIFT = 0.033;
const LABEL_LIFT = 0.052;
const TOOLTIP_LIFT = 0.2;

const PUMP_GREEN =
  "#54f287";

const PUMP_GREEN_BRIGHT =
  "#b0ffc7";

const PUMP_GREEN_DEEP =
  "#041109";

const PIXEL_GREEN_PALETTE = [
  "#4be47b",
  "#3acb6b",
  "#2daf5d",
  "#258f50",
  "#1d7442",
  "#175b35",
  "#12482b",
  "#0e3923",
  "#0b2d1c",
];

/* -------------------------------------------------------------------------- */
/*                                   HELPERS                                  */
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

function makeAddressLabel(
  address: string,
  availableWidth: number,
  king: boolean
) {
  if (
    king ||
    availableWidth >
      1.25
  ) {
    return `${address.slice(
      0,
      6
    )}…${address.slice(-6)}`;
  }

  if (
    availableWidth >
    0.9
  ) {
    return `${address.slice(
      0,
      5
    )}…${address.slice(-5)}`;
  }

  if (
    availableWidth >
    0.55
  ) {
    return `${address.slice(
      0,
      4
    )}…${address.slice(-4)}`;
  }

  return `${address.slice(
    0,
    3
  )}…${address.slice(-3)}`;
}

/* -------------------------------------------------------------------------- */
/*                              REAL HILL PROFILE                             */
/* -------------------------------------------------------------------------- */

/*
 * Smooth game-level hill:
 *
 *
 *                       ___
 *                   ___/   \___
 *                __/           \__
 *             __/                 \__
 *         ___/                       \___
 * _______/                               \_______
 *
 *
 * It's NOT spherical.
 *
 * Smoothstep gives:
 *
 * - flat-ish summit
 * - curved shoulder
 * - broad slope
 * - flattening at base
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

  const smoothstep =
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
        smoothstep
      )
  );
}

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
      6 *
        t *
        t
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
/*                        REAL SURFACE AREA LOOKUP                            */
/* -------------------------------------------------------------------------- */

/*
 * Surface of revolution:
 *
 * dA ∝ r * sqrt(1 + y'(r)^2) dr
 *
 * This lookup lets us allocate the REAL curved
 * hill surface proportionally instead of just
 * splitting a flat 2D circle.
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
    radius:
      0,

    area:
      0,
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

  const span =
    upper.fraction -
    lower.fraction;

  const t =
    span > 0
      ? (
          target -
          lower.fraction
        ) /
        span
      : 0;

  return THREE.MathUtils.lerp(
    lower.radius,
    upper.radius,
    t
  );
}

function radiusToAreaFraction(
  radius: number
) {
  const normalizedRadius =
    clamp(
      radius,
      0,
      HILL_RADIUS
    );

  const approximateIndex =
    Math.round(
      (
        normalizedRadius /
        HILL_RADIUS
      ) *
        AREA_STEPS
    );

  return AREA_LOOKUP[
    clamp(
      approximateIndex,
      0,
      AREA_LOOKUP.length -
        1
    )
  ].fraction;
}

/* -------------------------------------------------------------------------- */
/*                             SURFACE POSITION                               */
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
/*                          FLAT-ON-HILL ORIENTATION                          */
/* -------------------------------------------------------------------------- */

/*
 * X = around the hill
 * Y = uphill
 * Z = normal out of terrain
 *
 * Labels use this instead of billboarding toward
 * the camera, so they actually look printed onto
 * the hill surface.
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
/*                         ADAPTIVE TERRITORY RINGS                           */
/* -------------------------------------------------------------------------- */

/*
 * This is the important divvy-up improvement.
 *
 * #1:
 *      owns a circular summit cap.
 *
 * Everyone else:
 *      sorted largest -> smallest downhill.
 *
 * Instead of arbitrary counts like:
 *
 *      4 / 6 / 9 / 12 / ...
 *
 * we create physically even terrain bands first.
 *
 * Then we choose the holder boundary closest to
 * each desired terrain-band boundary.
 *
 * That means:
 *
 * - bands remain visually balanced
 * - larger holders remain uphill
 * - tiny holders naturally accumulate lower
 * - no insane giant/thin random rectangles
 *
 * Within every band:
 *
 * angularWidth =
 * holderBalance / totalBalanceInBand
 *
 * Because the band's surface area equals the
 * exact combined share of those holders:
 *
 * bandArea × angularShare
 * = holder's exact overall share.
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
    sorted.length ===
    0
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

  const result:
    Territory[] = [];

  /* ---------------------------------------------------------------------- */
  /* King                                                                   */
  /* ---------------------------------------------------------------------- */

  const king =
    sorted[0];

  const kingShare =
    king.balance /
    total;

  result.push({
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

  const remaining =
    sorted.slice(
      1
    );

  if (
    remaining.length ===
    0
  ) {
    return result;
  }

  /*
   * Adaptive number of terrain bands.
   */
  const desiredRingCount =
    clamp(
      Math.ceil(
        remaining.length /
          13
      ),
      4,
      8
    );

  const kingRadius =
    areaFractionToRadius(
      kingShare
    );

  /*
   * Create physically evenly-spaced target
   * radii between king cap and outer base.
   */
  const targetAreaBoundaries:
    number[] = [];

  for (
    let index = 1;
    index <=
    desiredRingCount;
    index++
  ) {
    if (
      index ===
      desiredRingCount
    ) {
      targetAreaBoundaries.push(
        1
      );

      continue;
    }

    const t =
      index /
      desiredRingCount;

    /*
     * Slight ease makes inner bands a bit
     * thicker, which gives top wallets more
     * room for their address.
     */
    const eased =
      Math.pow(
        t,
        0.88
      );

    const radius =
      THREE.MathUtils.lerp(
        kingRadius,
        HILL_RADIUS,
        eased
      );

    targetAreaBoundaries.push(
      radiusToAreaFraction(
        radius
      )
    );
  }

  let holderCursor =
    0;

  let currentArea =
    kingShare;

  for (
    let ringIndex = 0;
    ringIndex <
    desiredRingCount;
    ringIndex++
  ) {
    if (
      holderCursor >=
      remaining.length
    ) {
      break;
    }

    const lastRing =
      ringIndex ===
      desiredRingCount -
        1;

    const ringsAfter =
      desiredRingCount -
      ringIndex -
      1;

    const targetArea =
      targetAreaBoundaries[
        ringIndex
      ];

    const ringHolders:
      Holder[] = [];

    let ringShare =
      0;

    if (
      lastRing
    ) {
      while (
        holderCursor <
        remaining.length
      ) {
        const holder =
          remaining[
            holderCursor
          ];

        ringHolders.push(
          holder
        );

        ringShare +=
          holder.balance /
          total;

        holderCursor++;
      }
    } else {
      while (
        holderCursor <
        remaining.length
      ) {
        /*
         * Always leave at least one wallet
         * for every future ring.
         */
        const holdersRemaining =
          remaining.length -
          holderCursor;

        if (
          holdersRemaining <=
          ringsAfter
        ) {
          break;
        }

        const next =
          remaining[
            holderCursor
          ];

        const nextShare =
          next.balance /
          total;

        /*
         * First wallet always goes into ring.
         */
        if (
          ringHolders.length ===
          0
        ) {
          ringHolders.push(
            next
          );

          ringShare +=
            nextShare;

          holderCursor++;

          continue;
        }

        const before =
          Math.abs(
            (
              currentArea +
              ringShare
            ) -
              targetArea
          );

        const after =
          Math.abs(
            (
              currentArea +
              ringShare +
              nextShare
            ) -
              targetArea
          );

        /*
         * Once adding the next holder makes the
         * physical band boundary worse, stop.
         */
        if (
          currentArea +
            ringShare >=
            targetArea ||
          after > before
        ) {
          break;
        }

        ringHolders.push(
          next
        );

        ringShare +=
          nextShare;

        holderCursor++;
      }
    }

    /*
     * Safety fallback.
     */
    if (
      ringHolders.length ===
      0 &&
      holderCursor <
        remaining.length
    ) {
      const next =
        remaining[
          holderCursor
        ];

      ringHolders.push(
        next
      );

      ringShare =
        next.balance /
        total;

      holderCursor++;
    }

    const a0 =
      currentArea;

    const a1 =
      Math.min(
        1,
        currentArea +
          ringShare
      );

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

    /*
     * Golden-ratio-ish rotation means neighboring
     * bands do not stack their seams vertically.
     *
     * Looks much more like game-world land plots.
     */
    const offset =
      (
        0.09 +
        ringIndex *
          0.173
      ) %
      1;

    let u =
      offset;

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
        holder.balance /
        ringBalance;

      result.push({
        holder,

        rank:
          result.length +
          1,

        share:
          holder.balance /
          total,

        ring:
          ringIndex +
          1,

        u0:
          u,

        u1:
          u +
          angularShare,

        a0,
        a1,
      });

      u +=
        angularShare;
    }

    currentArea =
      a1;
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/*                         RETRO HILL GEOMETRY                                */
/* -------------------------------------------------------------------------- */

/*
 * Deliberately lower segment counts + flat shading.
 *
 * The shape is still smooth enough to read as a hill,
 * but each polygon catches light separately like
 * PS1 / voxel-era terrain.
 */
function createHillGeometry() {
  const radialSegments =
    44;

  const angularSegments =
    96;

  const positions:
    number[] = [];

  const indices:
    number[] = [];

  const colors:
    number[] = [];

  const palette =
    PIXEL_GREEN_PALETTE.map(
      (
        color
      ) =>
        new THREE.Color(
          color
        )
    );

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

    const height =
      hillHeightAtRadius(
        radius
      );

    const elevation =
      clamp(
        (
          height -
          HILL_BASE_Y
        ) /
          HILL_HEIGHT,
        0,
        1
      );

    const paletteIndex =
      clamp(
        Math.floor(
          elevation *
            palette.length
        ),
        0,
        palette.length -
          1
      );

    const color =
      palette[
        paletteIndex
      ];

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

      positions.push(
        radius *
          Math.sin(
            angle
          ),

        height,

        radius *
          Math.cos(
            angle
          )
      );

      colors.push(
        color.r,
        color.g,
        color.b
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
        angularSegments +
        1;

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
    "color",
    new THREE.Float32BufferAttribute(
      colors,
      3
    )
  );

  geometry.setIndex(
    indices
  );

  geometry.computeVertexNormals();
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

  /*
   * Intentionally moderate polygon density.
   *
   * Curved enough to match hill,
   * faceted enough to retain game vibe.
   */
  const angularSegments =
    Math.max(
      3,
      Math.ceil(
        uRange *
          70
      )
    );

  const radialSegments =
    Math.max(
      3,
      Math.ceil(
        aRange *
          55
      )
    );

  const positions:
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
      THREE.MathUtils.lerp(
        territory.a0,
        territory.a1,
        radialT
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
        THREE.MathUtils.lerp(
          territory.u0,
          territory.u1,
          angularT
        );

      const point =
        hillSurfacePosition(
          u,
          area,
          PATCH_LIFT
        );

      positions.push(
        point.x,
        point.y,
        point.z
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
        angularSegments +
        1;

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

  geometry.setIndex(
    indices
  );

  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return geometry;
}

/* -------------------------------------------------------------------------- */
/*                         RADIAL TERRITORY SEAM                              */
/* -------------------------------------------------------------------------- */

/*
 * We only draw ONE radial separator per plot.
 *
 * Ring contours are handled separately.
 *
 * This avoids duplicated glowing edges and makes
 * the divvy-up much cleaner.
 */
function createSeparatorGeometry(
  territory: Territory
) {
  const positions:
    number[] = [];

  const steps =
    Math.max(
      4,
      Math.ceil(
        (
          territory.a1 -
          territory.a0
        ) *
          60
      )
    );

  for (
    let index = 0;
    index < steps;
    index++
  ) {
    const t0 =
      index /
      steps;

    const t1 =
      (
        index +
        1
      ) /
      steps;

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

    const start =
      hillSurfacePosition(
        territory.u0,
        a0,
        LINE_LIFT
      );

    const end =
      hillSurfacePosition(
        territory.u0,
        a1,
        LINE_LIFT
      );

    positions.push(
      start.x,
      start.y,
      start.z,

      end.x,
      end.y,
      end.z
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
/*                         FULL ACTIVE OUTLINE                                */
/* -------------------------------------------------------------------------- */

function createActiveBorder(
  territory: Territory
) {
  const positions:
    number[] = [];

  function add(
    start: THREE.Vector3,
    end: THREE.Vector3
  ) {
    positions.push(
      start.x,
      start.y,
      start.z,

      end.x,
      end.y,
      end.z
    );
  }

  const angularSteps =
    Math.max(
      8,
      Math.ceil(
        (
          territory.u1 -
          territory.u0
        ) *
          90
      )
    );

  const radialSteps =
    Math.max(
      6,
      Math.ceil(
        (
          territory.a1 -
          territory.a0
        ) *
          70
      )
    );

  for (
    const area of [
      territory.a0,
      territory.a1,
    ]
  ) {
    for (
      let index = 0;
      index <
      angularSteps;
      index++
    ) {
      const t0 =
        index /
        angularSteps;

      const t1 =
        (
          index +
          1
        ) /
        angularSteps;

      add(
        hillSurfacePosition(
          THREE.MathUtils.lerp(
            territory.u0,
            territory.u1,
            t0
          ),
          area,
          LINE_LIFT +
            0.012
        ),

        hillSurfacePosition(
          THREE.MathUtils.lerp(
            territory.u0,
            territory.u1,
            t1
          ),
          area,
          LINE_LIFT +
            0.012
        )
      );
    }
  }

  for (
    const u of [
      territory.u0,
      territory.u1,
    ]
  ) {
    for (
      let index = 0;
      index <
      radialSteps;
      index++
    ) {
      const t0 =
        index /
        radialSteps;

      const t1 =
        (
          index +
          1
        ) /
        radialSteps;

      add(
        hillSurfacePosition(
          u,
          THREE.MathUtils.lerp(
            territory.a0,
            territory.a1,
            t0
          ),
          LINE_LIFT +
            0.012
        ),

        hillSurfacePosition(
          u,
          THREE.MathUtils.lerp(
            territory.a0,
            territory.a1,
            t1
          ),
          LINE_LIFT +
            0.012
        )
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

  return geometry;
}

/* -------------------------------------------------------------------------- */
/*                             RING CONTOURS                                  */
/* -------------------------------------------------------------------------- */

function createContourGeometry(
  area: number
) {
  const positions:
    number[] = [];

  const segments =
    128;

  for (
    let index = 0;
    index < segments;
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

    const start =
      hillSurfacePosition(
        u0,
        area,
        LINE_LIFT
      );

    const end =
      hillSurfacePosition(
        u1,
        area,
        LINE_LIFT
      );

    positions.push(
      start.x,
      start.y,
      start.z,

      end.x,
      end.y,
      end.z
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

function ContourLine({
  area,
  strong = false,
}: {
  area: number;
  strong?: boolean;
}) {
  const geometry =
    useMemo(
      () =>
        createContourGeometry(
          area
        ),
      [
        area,
      ]
    );

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [
    geometry,
  ]);

  return (
    <lineSegments
      geometry={
        geometry
      }
      raycast={() => {}}
      renderOrder={5}
    >
      <lineBasicMaterial
        color={
          PUMP_GREEN
        }
        transparent
        opacity={
          strong
            ? 0.46
            : 0.2
        }
        depthWrite={
          false
        }
      />
    </lineSegments>
  );
}

function RingContours({
  territories,
}: {
  territories: Territory[];
}) {
  const boundaries =
    useMemo(
      () => {
        const byRing =
          new Map<
            number,
            number
          >();

        for (
          const territory of
          territories
        ) {
          byRing.set(
            territory.ring,
            territory.a1
          );
        }

        return Array.from(
          byRing.entries()
        )
          .sort(
            (
              a,
              b
            ) =>
              a[0] -
              b[0]
          )
          .map(
            (
              [
                ring,
                area,
              ]
            ) => ({
              ring,
              area,
            })
          );
      },
      [
        territories,
      ]
    );

  return (
    <>
      {boundaries.map(
        (
          boundary
        ) => (
          <ContourLine
            key={
              boundary.ring
            }
            area={
              boundary.area
            }
            strong={
              boundary.ring ===
              0
            }
          />
        )
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                         PHYSICAL TERRITORY SIZE                            */
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

  const sampleCount =
    14;

  let radialLength =
    0;

  let previous =
    hillSurfacePosition(
      (
        territory.u0 +
        territory.u1
      ) /
        2,

      territory.a0
    );

  for (
    let index = 1;
    index <=
    sampleCount;
    index++
  ) {
    const area =
      THREE.MathUtils.lerp(
        territory.a0,
        territory.a1,
        index /
          sampleCount
      );

    const next =
      hillSurfacePosition(
        (
          territory.u0 +
          territory.u1
        ) /
          2,

        area
      );

    radialLength +=
      next.distanceTo(
        previous
      );

    previous =
      next;
  }

  return {
    angularWidth,
    radialLength,
  };
}

/* -------------------------------------------------------------------------- */
/*                              PIXEL LABEL                                   */
/* -------------------------------------------------------------------------- */

function createLabelTexture(
  text: string,
  verified: boolean
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
    192;

  const ctx =
    canvas.getContext(
      "2d"
    );

  if (!ctx) {
    return null;
  }

  ctx.imageSmoothingEnabled =
    false;

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
    `700 82px ${pageFont}`;

  /*
   * Hard pixel-like outline.
   *
   * No soft blur.
   */
  ctx.lineWidth =
    10;

  ctx.strokeStyle =
    "#020704";

  ctx.strokeText(
    text,
    canvas.width /
      2,
    canvas.height /
      2
  );

  ctx.fillStyle =
    verified
      ? "#b0ffc7"
      : "#effff4";

  ctx.fillText(
    text,
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

  /*
   * Crisp / retro.
   */
  texture.minFilter =
    THREE.NearestFilter;

  texture.magFilter =
    THREE.NearestFilter;

  texture.generateMipmaps =
    false;

  return texture;
}

/* -------------------------------------------------------------------------- */
/*                           FLAT TERRAIN LABEL                               */
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
  const physical =
    useMemo(
      () =>
        getTerritoryPhysicalSize(
          territory
        ),
      [
        territory,
      ]
    );

  const relativeShare =
    territory.share /
    Math.max(
      largestShare,
      0.000001
    );

  const desiredWidth =
    (
      0.48 +
      Math.sqrt(
        relativeShare
      ) *
        1.1
    ) *
    (
      mobile
        ? 0.86
        : 1
    );

  /*
   * Allow larger labels wherever their plot
   * physically supports them.
   */
  let availableWidth =
    territory.rank ===
    1
      ? 1.5
      : Math.min(
          physical.angularWidth *
            0.82,

          physical.radialLength *
            3.65
        );

  availableWidth =
    Math.max(
      0,
      availableWidth
    );

  const width =
    Math.min(
      desiredWidth,
      availableWidth,
      mobile
        ? 1.02
        : 1.45
    );

  /*
   * Tiny territory:
   *
   * don't force giant overflowing text.
   * Hover still shows full wallet.
   */
  if (
    width <
    0.115
  ) {
    return null;
  }

  const text =
    makeAddressLabel(
      territory.holder
        .address,
      width,
      territory.rank ===
        1
    );

  const texture =
    useMemo(
      () =>
        createLabelTexture(
          text,
          Boolean(
            territory.holder
              .verified
          )
        ),
      [
        text,
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

  /*
   * King label sits on front side of summit
   * instead of directly on center degeneracy.
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
        0.48
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

  const height =
    width *
    0.19;

  return (
    <mesh
      position={
        position
      }
      quaternion={
        quaternion
      }
      raycast={() => {}}
      renderOrder={9}
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
          0.04
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
          -3
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
      <div className="w-max min-w-[190px] max-w-[280px] border-2 border-[#54f287]/40 bg-black/95 p-3 text-white shadow-[5px_5px_0_rgba(84,242,135,0.12)]">
        <div className="flex items-center justify-between gap-5">
          <span className="text-[9px] uppercase tracking-[0.15em] text-[#54f287]">
            {territory.rank ===
            1
              ? "king of the hill"
              : `rank #${territory.rank}`}
          </span>

          {territory.holder
            .verified && (
            <span className="text-[9px] uppercase tracking-[0.1em] text-[#b0ffc7]">
              ✓ verified
            </span>
          )}
        </div>

        <div className="mt-2 max-w-[245px] break-all text-[11px] leading-4 text-white">
          {
            territory.holder
              .address
          }
        </div>

        {territory.holder
          .verified &&
          territory.holder
            .message && (
            <div className="mt-2 border-t border-[#54f287]/20 pt-2">
              <div className="text-[9px] uppercase tracking-[0.12em] text-white/35">
                holder message
              </div>

              <div className="mt-1.5 text-xs leading-4 text-[#c8ffd7]">
                “
                {
                  territory.holder
                    .message
                }
                ”
              </div>
            </div>
          )}

        <div className="mt-3 grid grid-cols-2 gap-6 border-t border-[#54f287]/20 pt-2">
          <div>
            <div className="text-[9px] uppercase tracking-[0.12em] text-white/35">
              holdings
            </div>

            <div className="mt-0.5 text-xs text-white/80">
              {formatTokenAmount(
                territory.holder
                  .balance
              )}
            </div>
          </div>

          <div className="text-right">
            <div className="text-[9px] uppercase tracking-[0.12em] text-white/35">
              land
            </div>

            <div className="mt-0.5 text-xs text-[#54f287]">
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
/*                           TERRITORY COLORS                                 */
/* -------------------------------------------------------------------------- */

function getTerritoryColor(
  territory: Territory,
  active: boolean
) {
  const paletteIndex =
    clamp(
      territory.ring,
      0,
      PIXEL_GREEN_PALETTE.length -
        1
    );

  const color =
    new THREE.Color(
      PIXEL_GREEN_PALETTE[
        paletteIndex
      ]
    );

  /*
   * Alternate brightness slightly between
   * adjacent land plots.
   */
  if (
    territory.rank %
      2 ===
    0
  ) {
    color.multiplyScalar(
      0.91
    );
  }

  if (
    territory.holder
      .verified
  ) {
    color.lerp(
      new THREE.Color(
        PUMP_GREEN_BRIGHT
      ),
      0.14
    );
  }

  if (
    active
  ) {
    color.lerp(
      new THREE.Color(
        PUMP_GREEN_BRIGHT
      ),
      0.48
    );
  }

  return color;
}

/* -------------------------------------------------------------------------- */
/*                          TERRITORY COMPONENT                               */
/* -------------------------------------------------------------------------- */

function TerritoryPatch({
  territory,
  largestShare,
  active,
  mobile,
  onHover,
  onPin,
}: {
  territory: Territory;

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

  const separator =
    useMemo(
      () =>
        territory.rank ===
        1
          ? null
          : createSeparatorGeometry(
              territory
            ),
      [
        territory,
      ]
    );

  const activeBorder =
    useMemo(
      () =>
        active
          ? createActiveBorder(
              territory
            )
          : null,
      [
        territory,
        active,
      ]
    );

  useEffect(() => {
    return () => {
      geometry.dispose();

      separator?.dispose();

      activeBorder?.dispose();
    };
  }, [
    geometry,
    separator,
    activeBorder,
  ]);

  const color =
    useMemo(
      () =>
        getTerritoryColor(
          territory,
          active
        ),
      [
        territory,
        active,
      ]
    );

  function pointerOver(
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

  function pointerOut(
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
          pointerOver
        }
        onPointerOut={
          pointerOut
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
            0.96
          }
          metalness={
            0
          }
          flatShading
          emissive={
            active ||
            territory.rank ===
              1
              ? PUMP_GREEN
              : PUMP_GREEN_DEEP
          }
          emissiveIntensity={
            active
              ? 0.11
              : territory.rank ===
                  1
                ? 0.05
                : 0
          }
        />
      </mesh>

      {separator && (
        <lineSegments
          geometry={
            separator
          }
          raycast={() => {}}
          renderOrder={6}
        >
          <lineBasicMaterial
            color={
              PUMP_GREEN
            }
            transparent
            opacity={
              0.23
            }
            depthWrite={
              false
            }
          />
        </lineSegments>
      )}

      {activeBorder && (
        <lineSegments
          geometry={
            activeBorder
          }
          raycast={() => {}}
          renderOrder={7}
        >
          <lineBasicMaterial
            color={
              PUMP_GREEN_BRIGHT
            }
            transparent
            opacity={
              0.88
            }
            depthWrite={
              false
            }
          />
        </lineSegments>
      )}

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
/*                          PIXEL KING FLAG                                   */
/* -------------------------------------------------------------------------- */

function KingFlag() {
  const summitY =
    hillHeightAtRadius(
      0
    );

  return (
    <group
      position={[
        0,
        summitY,
        0,
      ]}
    >
      {/* pixel pole */}
      <mesh
        position={[
          0,
          0.38,
          0,
        ]}
        raycast={() => {}}
      >
        <boxGeometry
          args={[
            0.035,
            0.76,
            0.035,
          ]}
        />

        <meshBasicMaterial
          color="#dffff0"
        />
      </mesh>

      {/* pixel flag blocks */}
      <mesh
        position={[
          0.18,
          0.64,
          0,
        ]}
        raycast={() => {}}
      >
        <boxGeometry
          args={[
            0.36,
            0.24,
            0.04,
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
            0.18
          }
          flatShading
        />
      </mesh>

      <mesh
        position={[
          0.315,
          0.56,
          0,
        ]}
        raycast={() => {}}
      >
        <boxGeometry
          args={[
            0.09,
            0.08,
            0.045,
          ]}
        />

        <meshStandardMaterial
          color="#31ba62"
          flatShading
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
          vertexColors
          roughness={1}
          metalness={0}
          flatShading
        />
      </mesh>

      {/* pixel-game base lip */}
      <mesh
        position={[
          0,
          HILL_BASE_Y -
            0.055,
          0,
        ]}
        raycast={() => {}}
      >
        <cylinderGeometry
          args={[
            HILL_RADIUS +
              0.03,
            HILL_RADIUS +
              0.12,
            0.11,
            96,
          ]}
        />

        <meshStandardMaterial
          color="#06100a"
          roughness={1}
          flatShading
        />
      </mesh>

      <ContourLine
        area={1}
        strong
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                                ROTATION                                    */
/* -------------------------------------------------------------------------- */

function SlowRotate({
  children,
  paused,
}: {
  children:
    ReactNode;

  paused:
    boolean;
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
        0.027;
    }
  );

  return (
    <group
      ref={
        group
      }
    >
      {children}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*                               HOLDER HILL                                  */
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
    hovered,
    setHovered,
  ] =
    useState<
      string | null
    >(null);

  const [
    pinned,
    setPinned,
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
    hovered ??
    pinned;

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
                setHovered
              }
              onPin={(
                address
              ) => {
                setPinned(
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

        <RingContours
          territories={
            territories
          }
        />

        {activeTerritory && (
          <HolderTooltip
            territory={
              activeTerritory
            }
          />
        )}
      </SlowRotate>

      {territories.length >
        0 && (
        <KingFlag />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                              GAME LEVEL FLOOR                              */
/* -------------------------------------------------------------------------- */

function LevelFloor() {
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
            0.12,
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
          color="#010402"
        />
      </mesh>

      <gridHelper
        args={[
          30,
          60,
          "#174429",
          "#07170d",
        ]}
        position={[
          0,
          HILL_BASE_Y -
            0.105,
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
        6.4,
        19.5
      );

      perspective.fov =
        46;

      perspective.lookAt(
        0,
        -0.8,
        0
      );
    } else {
      perspective.position.set(
        0,
        5.5,
        13.8
      );

      perspective.fov =
        39;

      perspective.lookAt(
        0,
        -0.55,
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
/*                                   SCENE                                    */
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
          0.88,
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
          -1.02,
          0,
        ]
      : [
          0,
          -0.45,
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
            ? 20
            : 15,
          mobile
            ? 36
            : 29,
        ]}
      />

      <ambientLight
        intensity={
          0.5
        }
      />

      <directionalLight
        position={[
          -5,
          9,
          8,
        ]}
        intensity={
          2
        }
      />

      <directionalLight
        position={[
          5,
          2,
          -5,
        ]}
        intensity={
          0.24
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
          3.2
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
        <LevelFloor />

        <HolderHill
          holders={
            holders
          }
          mobile={
            mobile
          }
        />
      </group>
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
        1.5,
      ]}
      camera={{
        position: [
          0,
          5.5,
          13.8,
        ],

        fov:
          39,

        near:
          0.1,

        far:
          100,
      }}
      gl={{
        /*
         * Important for retro-game look.
         */
        antialias:
          false,

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