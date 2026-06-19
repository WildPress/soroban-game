const { colorize } = require('@jscad/modeling').colors;
const { cuboid, cylinder, polyhedron } = require('@jscad/modeling').primitives;
const { rotateX, scale, translate } = require('@jscad/modeling').transforms;

const defaultConfig = {
  columns: 13,
  rodSpacing: 0.72,
  beadWidth: 0.46,
  beadHeight: 0.4,
  beadDepth: 0.24,
  beadStep: 0.45,
  inactiveGap: 0.65,
  upperRestY: 0.98,
  upperActiveY: 0.33,
  lowerActiveStartY: -0.34,
  framePaddingX: 0.52,
  frameTopY: 1.48,
  frameBottomY: -2.85,
  frameThickness: 0.14,
  beamThickness: 0.18
};

function getParameterDefinitions() {
  return [
    { name: 'columns', type: 'slider', initial: 13, min: 1, max: 21, step: 1, caption: 'Columns' },
    { name: 'value', type: 'text', initial: '0000000000000', caption: 'Column values' },
    { name: 'tipRadius', type: 'slider', initial: 0.045, min: 0.01, max: 0.18, step: 0.005, caption: 'Tip radius' },
    { name: 'shoulderRadius', type: 'slider', initial: 0.33, min: 0.22, max: 0.48, step: 0.005, caption: 'Shoulder radius' },
    { name: 'waistRadius', type: 'slider', initial: 0.5, min: 0.36, max: 0.6, step: 0.005, caption: 'Waist radius' },
    { name: 'beadHeight', type: 'slider', initial: 0.4, min: 0.28, max: 0.56, step: 0.01, caption: 'Bead height' },
    { name: 'beadDepth', type: 'slider', initial: 1, min: 0.5, max: 1.4, step: 0.025, caption: 'Bead depth' },
    { name: 'roundness', type: 'slider', initial: 0.25, min: 0, max: 1, step: 0.025, caption: 'Roundness' },
    { name: 'smoothness', type: 'slider', initial: 8, min: 1, max: 16, step: 1, caption: 'Smoothness' }
  ];
}

function main(params) {
  const beadHeight = clampNumber(params.beadHeight, 0.28, 0.56, defaultConfig.beadHeight);
  const config = createConfig(params, beadHeight);
  const values = normalizeValues(params.value, config.columns);
  const model = createModel(config, values);
  const frameDepth = 0.24;
  const beamDepth = frameDepth * 0.8;
  const frameThickness = model.frame.thickness * 1.9;
  const beamThickness = model.frame.beamThickness * 1.15;
  const beadCenterZ = 0;
  const rodCenterZ = beadCenterZ;
  const beadHalfHeight = config.beadHeight * 1.28 * 0.5;
  const placeDotDepth = beamDepth + 0.012;
  const outputScale = 18;
  const modelBottomY = model.frame.bottomY - frameThickness / 2;
  const beadShape = {
    tipRadius: clampNumber(params.tipRadius, 0.01, 0.18, 0.045),
    shoulderRadius: clampNumber(params.shoulderRadius, 0.22, 0.48, 0.33),
    waistRadius: clampNumber(params.waistRadius, 0.36, 0.6, 0.5),
    depthScale: clampNumber(params.beadDepth, 0.5, 1.4, 1),
    roundness: clampNumber(params.roundness, 0, 1, 0.25),
    smoothness: clampInt(params.smoothness, 1, 16)
  };
  const parts = [];

  parts.push(
    uprightPart(cuboid({ size: [1, 1, 1] }), [0.55, 0.43, 0.3, 1], [0, 0, model.frame.topY - modelBottomY], [model.frame.width + frameThickness, frameDepth, frameThickness], outputScale),
    uprightPart(cuboid({ size: [1, 1, 1] }), [0.55, 0.43, 0.3, 1], [0, 0, model.frame.bottomY - modelBottomY], [model.frame.width + frameThickness, frameDepth, frameThickness], outputScale),
    uprightPart(cuboid({ size: [1, 1, 1] }), [0.55, 0.43, 0.3, 1], [model.frame.leftX, 0, (model.frame.topY + model.frame.bottomY) / 2 - modelBottomY], [frameThickness, frameDepth, model.frame.height], outputScale),
    uprightPart(cuboid({ size: [1, 1, 1] }), [0.55, 0.43, 0.3, 1], [model.frame.rightX, 0, (model.frame.topY + model.frame.bottomY) / 2 - modelBottomY], [frameThickness, frameDepth, model.frame.height], outputScale),
    uprightPart(cuboid({ size: [1, 1, 1] }), [0.5, 0.35, 0.24, 1], [0, 0, model.frame.beamY - modelBottomY], [model.frame.width + frameThickness * 0.45, beamDepth, beamThickness], outputScale)
  );

  for (const column of model.columns) {
    const rodStartY = model.frame.bottomY - frameThickness / 2;
    const rodEndY = model.frame.topY + frameThickness / 2;
    const rodSegments = getVisibleRodSegments(
      model.beads.filter((bead) => bead.column === column.index),
      rodStartY,
      rodEndY,
      model.frame,
      frameThickness,
      beamThickness,
      beadHalfHeight
    );

    for (const segment of rodSegments) {
      parts.push(
        colorize(
          [0.6, 0.63, 0.64, 1],
          translate(
            [column.x * outputScale, rodCenterZ * outputScale, (segment.centerY - modelBottomY) * outputScale],
            scale([outputScale, outputScale, segment.length * outputScale], cylinder({ height: 1, radius: 0.018, segments: 28 }))
          )
        )
      );
    }

    if (isPlaceColumn(column.index, config.columns)) {
      parts.push(
        colorize(
          [0.86, 0.64, 0.24, 1],
          translate(
            [column.x * outputScale, 0, (model.frame.beamY - modelBottomY) * outputScale],
            rotateX(Math.PI / 2, scale([outputScale, outputScale, outputScale], cylinder({ height: placeDotDepth, radius: 0.055, segments: 32 })))
          )
        )
      );
    }
  }

  const bead = createBicone(beadShape);
  for (const beadModel of model.beads) {
    const placeBead = beadModel.section === 'lower' && beadModel.index === 0 && isPlaceColumn(beadModel.column, config.columns);
    parts.push(
      uprightPart(
        bead,
        placeBead ? [0.72, 0.54, 0.34, 1] : [0.44, 0.3, 0.2, 1],
        [beadModel.position.x, beadCenterZ, beadModel.position.y - modelBottomY],
        [beadModel.scale.x * 1.35, beadModel.scale.x * 1.35 * beadShape.depthScale, beadModel.scale.y * 1.28],
        outputScale
      )
    );
  }

  return parts;
}

function createConfig(params, beadHeight) {
  const beadStep = beadHeight * 1.12;
  const inactiveGap = beadHeight * 1.62;
  const upperActiveY = defaultConfig.upperActiveY;
  const lowerActiveStartY = defaultConfig.lowerActiveStartY;

  return {
    ...defaultConfig,
    columns: clampInt(params.columns, 1, 21),
    beadHeight,
    beadStep,
    inactiveGap,
    upperRestY: upperActiveY + inactiveGap,
    upperActiveY,
    lowerActiveStartY,
    frameTopY: upperActiveY + inactiveGap + beadHeight * 1.25,
    frameBottomY: lowerActiveStartY - beadStep * 3 - inactiveGap - beadHeight * 1.25
  };
}

function uprightPart(shape, color, position, partScale, outputScale) {
  return colorize(
    color,
    translate(
      position.map((coordinate) => coordinate * outputScale),
      scale(partScale.map((coordinate) => coordinate * outputScale), shape)
    )
  );
}

function createModel(config, values) {
  const width = (config.columns - 1) * config.rodSpacing + config.framePaddingX * 2;
  const leftX = -width / 2;
  const rightX = width / 2;
  const height = config.frameTopY - config.frameBottomY;
  const columns = [];
  const beads = [];

  for (let column = 0; column < config.columns; column += 1) {
    const x = getColumnX(column, config);
    const value = values[column] || 0;
    const upperActive = value >= 5;
    const lowerActiveCount = value % 5;

    columns.push({ index: column, x, value });
    beads.push({
      column,
      section: 'upper',
      index: 0,
      position: { x, y: upperActive ? config.upperActiveY : config.upperRestY },
      scale: beadScale(config)
    });

    for (let index = 0; index < 4; index += 1) {
      const active = index < lowerActiveCount;
      const activeY = config.lowerActiveStartY - index * config.beadStep;
      const inactiveY = activeY - config.inactiveGap;

      beads.push({
        column,
        section: 'lower',
        index,
        position: { x, y: active ? activeY : inactiveY },
        scale: beadScale(config)
      });
    }
  }

  return {
    columns,
    beads,
    frame: {
      width,
      height,
      leftX,
      rightX,
      topY: config.frameTopY,
      bottomY: config.frameBottomY,
      beamY: 0,
      thickness: config.frameThickness,
      beamThickness: config.beamThickness
    }
  };
}

function createBicone(beadShape) {
  const radialSegments = Math.max(12, beadShape.smoothness * 8);
  const profileSegments = Math.max(2, beadShape.smoothness + 2);
  const rings = [];
  const points = [[0, 0, 0.5]];
  const topPoint = 0;
  const ringStarts = [];
  const faces = [];

  for (let index = 1; index <= profileSegments; index += 1) {
    const t = index / (profileSegments + 1);
    const linearCone = 1 - Math.abs(t * 2 - 1);
    const oval = Math.sin(Math.PI * t);
    const shoulderStop = 0.66;
    const shoulderAmount = Math.min(1, linearCone / shoulderStop);
    const waistAmount = Math.max(0, (linearCone - shoulderStop) / (1 - shoulderStop));
    const coneRadius = linearCone < shoulderStop
      ? mix(beadShape.tipRadius, beadShape.shoulderRadius, shoulderAmount)
      : mix(beadShape.shoulderRadius, beadShape.waistRadius, waistAmount);
    const ovalRadius = mix(beadShape.tipRadius, beadShape.waistRadius, oval);

    rings.push({
      z: 0.5 - t,
      radius: mix(coneRadius, ovalRadius, beadShape.roundness)
    });
  }

  for (const ring of rings) {
    ringStarts.push(points.length);

    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = (segment / radialSegments) * Math.PI * 2;
      points.push([Math.cos(angle) * ring.radius, Math.sin(angle) * ring.radius, ring.z]);
    }
  }

  const bottomPoint = points.length;
  points.push([0, 0, -0.5]);

  for (let segment = 0; segment < radialSegments; segment += 1) {
    const next = (segment + 1) % radialSegments;
    faces.push([topPoint, ringStarts[0] + segment, ringStarts[0] + next]);
  }

  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const next = (segment + 1) % radialSegments;
      const a = ringStarts[ringIndex] + segment;
      const b = ringStarts[ringIndex] + next;
      const c = ringStarts[ringIndex + 1] + segment;
      const d = ringStarts[ringIndex + 1] + next;
      faces.push([a, c, d, b]);
    }
  }

  const bottomRingStart = ringStarts[ringStarts.length - 1];

  for (let segment = 0; segment < radialSegments; segment += 1) {
    const next = (segment + 1) % radialSegments;
    faces.push([bottomPoint, bottomRingStart + next, bottomRingStart + segment]);
  }

  return polyhedron({ points, faces, orientation: 'outward' });
}

function mix(from, to, amount) {
  return from + (to - from) * amount;
}

function beadScale(config) {
  return {
    x: config.beadWidth,
    y: config.beadHeight,
    z: config.beadDepth
  };
}

function getColumnX(column, config) {
  return (column - (config.columns - 1) / 2) * config.rodSpacing;
}

function normalizeValues(value, columns) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, columns).split('').map(Number);

  while (digits.length < columns) {
    digits.push(0);
  }

  return digits.map((digit) => Math.min(9, Math.max(0, digit)));
}

function getVisibleRodSegments(beads, rodStartY, rodEndY, frame, frameThickness, beamThickness, beadHalfHeight) {
  const hiddenIntervals = [
    { min: frame.bottomY - frameThickness / 2, max: frame.bottomY + frameThickness / 2 },
    { min: frame.beamY - beamThickness / 2, max: frame.beamY + beamThickness / 2 },
    { min: frame.topY - frameThickness / 2, max: frame.topY + frameThickness / 2 },
    ...beads.map((bead) => ({
      min: bead.position.y - beadHalfHeight * 1.06,
      max: bead.position.y + beadHalfHeight * 1.06
    }))
  ].sort((a, b) => a.min - b.min);

  const segments = [];
  let cursor = rodStartY;

  for (const interval of hiddenIntervals) {
    const min = Math.max(rodStartY, interval.min);
    const max = Math.min(rodEndY, interval.max);

    if (min - cursor > 0.012) {
      segments.push(toRodSegment(cursor, min));
    }

    cursor = Math.max(cursor, max);
  }

  if (rodEndY - cursor > 0.012) {
    segments.push(toRodSegment(cursor, rodEndY));
  }

  return segments;
}

function toRodSegment(fromY, toY) {
  return {
    centerY: (fromY + toY) / 2,
    length: toY - fromY
  };
}

function isPlaceColumn(column, columns) {
  return (columns - column) % 3 === 0;
}

function clampInt(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(Number(value) || min)));
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

module.exports = { main, getParameterDefinitions };
