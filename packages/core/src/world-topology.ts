export interface IWorldTopologySummaryField {
  readonly columns: number;
  readonly depth: number;
  readonly flow: ArrayLike<number>;
  readonly heights: ArrayLike<number>;
  readonly rows: number;
  readonly width: number;
}

export interface IWorldTopologySummary {
  readonly directionalAnisotropy: number;
  readonly effectiveVertexDensityPerKm2: number;
  readonly maxHortonStrahlerOrder: number;
  readonly median64mRelief: number;
  readonly powerSpectrumSlope: number;
  readonly profileCurvatureExcessKurtosis: number;
  readonly reliefFieldEdge: number;
  readonly slopeTailAbove30Degrees: number;
}

function height(field: IWorldTopologySummaryField, row: number, column: number): number {
  const clampedRow = Math.max(0, Math.min(field.rows - 1, row));
  const clampedColumn = Math.max(0, Math.min(field.columns - 1, column));
  const value = field.heights[clampedRow * field.columns + clampedColumn];
  if (value === undefined || !Number.isFinite(value))
    throw new Error("World topology height sample is missing or not finite.");
  return value;
}

function gradient(
  field: IWorldTopologySummaryField,
  row: number,
  column: number,
): [number, number] {
  const dx = field.width / (field.columns - 1);
  const dz = field.depth / (field.rows - 1);
  return [
    (height(field, row, column + 1) - height(field, row, column - 1)) / (2 * dx),
    (height(field, row + 1, column) - height(field, row - 1, column)) / (2 * dz),
  ];
}

function variance(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
}

function directionalAnisotropy(field: IWorldTopologySummaryField): number {
  const x: number[] = [];
  const z: number[] = [];
  for (let row = 0; row < field.rows; row += 1) {
    for (let column = 0; column < field.columns; column += 1) {
      const [gradientX, gradientZ] = gradient(field, row, column);
      x.push(gradientX);
      z.push(gradientZ);
    }
  }
  const xVariance = variance(x);
  const zVariance = variance(z);
  if (xVariance === 0 || zVariance === 0) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.log(xVariance / zVariance));
}

function powerSpectrumSlope(field: IWorldTopologySummaryField): number {
  const average: number[] = [];
  for (let column = 0; column < field.columns; column += 1) {
    let total = 0;
    for (let row = 0; row < field.rows; row += 1) total += height(field, row, column);
    average.push(total / field.rows);
  }
  const wavelengths: number[] = [];
  const powers: number[] = [];
  for (let frequency = 1; frequency <= Math.floor(field.columns / 2); frequency += 1) {
    const wavelength = field.width / frequency;
    if (wavelength < 8 || wavelength > 256) continue;
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < field.columns; index += 1) {
      const angle = (2 * Math.PI * frequency * index) / field.columns;
      real += (average[index] as number) * Math.cos(angle);
      imaginary -= (average[index] as number) * Math.sin(angle);
    }
    const power = real * real + imaginary * imaginary;
    if (power > 0) {
      wavelengths.push(Math.log(wavelength));
      powers.push(Math.log(power));
    }
  }
  if (wavelengths.length < 2) return Number.POSITIVE_INFINITY;
  const meanWavelength =
    wavelengths.reduce((total, value) => total + value, 0) / wavelengths.length;
  const meanPower = powers.reduce((total, value) => total + value, 0) / powers.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < wavelengths.length; index += 1) {
    numerator +=
      ((wavelengths[index] as number) - meanWavelength) * ((powers[index] as number) - meanPower);
    denominator += ((wavelengths[index] as number) - meanWavelength) ** 2;
  }
  return denominator === 0 ? Number.POSITIVE_INFINITY : numerator / denominator;
}

function reliefFieldEdge(field: IWorldTopologySummaryField): number {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let edgeTotal = 0;
  let edgeCount = 0;
  for (let row = 0; row < field.rows; row += 1) {
    for (let column = 0; column < field.columns; column += 1) {
      const value = height(field, row, column);
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
      if (row === 0 || column === 0 || row === field.rows - 1 || column === field.columns - 1) {
        edgeTotal += value;
        edgeCount += 1;
      }
    }
  }
  const relief = maximum - minimum;
  if (relief === 0) return 0;
  const edgeMean = edgeTotal / edgeCount;
  const center = height(field, Math.floor(field.rows / 2), Math.floor(field.columns / 2));
  return Math.abs(center - edgeMean) / relief;
}

function slidingExtrema(
  read: (index: number) => number,
  length: number,
  radius: number,
  write: (index: number, minimum: number, maximum: number) => void,
): void {
  const minimumDeque: number[] = [];
  const maximumDeque: number[] = [];
  let minimumHead = 0;
  let maximumHead = 0;
  let right = -1;
  for (let index = 0; index < length; index += 1) {
    const desiredRight = Math.min(length - 1, index + radius);
    while (right < desiredRight) {
      right += 1;
      const value = read(right);
      while (
        minimumDeque.length > minimumHead &&
        read(minimumDeque[minimumDeque.length - 1] as number) >= value
      )
        minimumDeque.pop();
      minimumDeque.push(right);
      while (
        maximumDeque.length > maximumHead &&
        read(maximumDeque[maximumDeque.length - 1] as number) <= value
      )
        maximumDeque.pop();
      maximumDeque.push(right);
    }
    const left = Math.max(0, index - radius);
    while (minimumHead < minimumDeque.length && (minimumDeque[minimumHead] as number) < left)
      minimumHead += 1;
    while (maximumHead < maximumDeque.length && (maximumDeque[maximumHead] as number) < left)
      maximumHead += 1;
    const minimumIndex = minimumDeque[minimumHead];
    const maximumIndex = maximumDeque[maximumHead];
    if (minimumIndex === undefined || maximumIndex === undefined)
      throw new Error("World topology sliding window is empty.");
    write(index, read(minimumIndex), read(maximumIndex));
    if (minimumHead > 64 && minimumHead * 2 > minimumDeque.length) {
      minimumDeque.splice(0, minimumHead);
      minimumHead = 0;
    }
    if (maximumHead > 64 && maximumHead * 2 > maximumDeque.length) {
      maximumDeque.splice(0, maximumHead);
      maximumHead = 0;
    }
  }
}

function median64mRelief(field: IWorldTopologySummaryField): number {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < field.heights.length; index += 1) {
    const value = field.heights[index];
    if (value === undefined || !Number.isFinite(value))
      throw new Error("World topology height sample is missing or not finite.");
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const globalRelief = maximum - minimum;
  if (globalRelief === 0) return 0;
  const radiusX = Math.max(1, Math.round(64 / (field.width / (field.columns - 1))));
  const radiusZ = Math.max(1, Math.round(64 / (field.depth / (field.rows - 1))));
  const local: number[] = [];
  const horizontalMinimum = new Float64Array(field.rows * field.columns);
  const horizontalMaximum = new Float64Array(field.rows * field.columns);
  for (let row = 0; row < field.rows; row += 1)
    slidingExtrema(
      (column) => height(field, row, column),
      field.columns,
      radiusX,
      (column, lineMinimum, lineMaximum) => {
        horizontalMinimum[row * field.columns + column] = lineMinimum;
        horizontalMaximum[row * field.columns + column] = lineMaximum;
      },
    );
  for (let column = 0; column < field.columns; column += 1) {
    const localMinimum = new Float64Array(field.rows);
    const localMaximum = new Float64Array(field.rows);
    slidingExtrema(
      (row) => horizontalMinimum[row * field.columns + column] as number,
      field.rows,
      radiusZ,
      (row, lineMinimum) => {
        localMinimum[row] = lineMinimum;
      },
    );
    slidingExtrema(
      (row) => horizontalMaximum[row * field.columns + column] as number,
      field.rows,
      radiusZ,
      (row, _lineMinimum, lineMaximum) => {
        localMaximum[row] = lineMaximum;
      },
    );
    for (let row = 0; row < field.rows; row += 1)
      local.push(((localMaximum[row] as number) - (localMinimum[row] as number)) / globalRelief);
  }
  local.sort((a, b) => a - b);
  return local[Math.floor(local.length / 2)] as number;
}

function downhill(field: IWorldTopologySummaryField, index: number): number {
  const row = Math.floor(index / field.columns);
  const column = index % field.columns;
  const current = height(field, row, column);
  let destination = index;
  let lowest = current;
  for (const [rowOffset, columnOffset] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    const nextRow = row + rowOffset;
    const nextColumn = column + columnOffset;
    if (nextRow < 0 || nextRow >= field.rows || nextColumn < 0 || nextColumn >= field.columns)
      continue;
    const candidate = height(field, nextRow, nextColumn);
    if (candidate < lowest) {
      lowest = candidate;
      destination = nextRow * field.columns + nextColumn;
    }
  }
  return destination;
}

function streamOrder(field: IWorldTopologySummaryField): number {
  const count = field.rows * field.columns;
  const targets = new Int32Array(count);
  targets.fill(-1);
  const order = Array.from({ length: count }, (_, index) => index).sort(
    (a, b) =>
      height(field, Math.floor(b / field.columns), b % field.columns) -
        height(field, Math.floor(a / field.columns), a % field.columns) || a - b,
  );
  for (let source = 0; source < count; source += 1) {
    const destination = downhill(field, source);
    targets[source] = destination === source ? -1 : destination;
  }
  const accumulation = new Float64Array(count);
  for (const source of order) {
    accumulation[source] = (accumulation[source] as number) + 1;
    const destination = targets[source];
    if (destination !== undefined && destination >= 0)
      accumulation[destination] =
        (accumulation[destination] as number) + (accumulation[source] as number);
  }
  const cellArea = (field.width / (field.columns - 1)) * (field.depth / (field.rows - 1));
  const minimumFlow = Math.log1p(2_048 / cellArea) / Math.log1p(count);
  const orders = new Int32Array(count);
  let maximum = 0;
  for (const index of order) {
    if ((field.flow[index] as number) < minimumFlow) continue;
    const row = Math.floor(index / field.columns);
    const column = index % field.columns;
    const upstream: number[] = [];
    for (const [rowOffset, columnOffset] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      const upstreamRow = row + rowOffset;
      const upstreamColumn = column + columnOffset;
      if (
        upstreamRow < 0 ||
        upstreamRow >= field.rows ||
        upstreamColumn < 0 ||
        upstreamColumn >= field.columns
      )
        continue;
      const candidate = upstreamRow * field.columns + upstreamColumn;
      if (targets[candidate] === index && (field.flow[candidate] as number) >= minimumFlow)
        upstream.push(orders[candidate] as number);
    }
    const highest = Math.max(1, ...upstream);
    const ties = upstream.filter((value) => value === highest).length;
    orders[index] = ties > 1 ? highest + 1 : highest;
    maximum = Math.max(maximum, orders[index] as number);
  }
  return maximum;
}

function curvatureExcessKurtosis(field: IWorldTopologySummaryField): number {
  const values: number[] = [];
  for (let row = 0; row < field.rows; row += 1) {
    for (let column = 0; column < field.columns; column += 1) {
      const center = height(field, row, column);
      values.push(
        height(field, row, column - 1) +
          height(field, row, column + 1) +
          height(field, row - 1, column) +
          height(field, row + 1, column) -
          4 * center,
      );
    }
  }
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const second = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
  if (second === 0) return Number.NEGATIVE_INFINITY;
  const fourth = values.reduce((total, value) => total + (value - mean) ** 4, 0) / values.length;
  return fourth / (second * second) - 3;
}

function slopeTail(field: IWorldTopologySummaryField): number {
  let steep = 0;
  for (let row = 0; row < field.rows; row += 1) {
    for (let column = 0; column < field.columns; column += 1) {
      const [x, z] = gradient(field, row, column);
      if (Math.atan(Math.hypot(x, z)) > Math.PI / 6) steep += 1;
    }
  }
  return steep / (field.rows * field.columns);
}

/** Summarize an exact game-owned field before sending the result over a bounded bridge. */
export function summarizeWorldTopology(field: IWorldTopologySummaryField): IWorldTopologySummary {
  if (!Number.isInteger(field.rows) || field.rows < 2)
    throw new Error("World topology rows must be integers of at least 2.");
  if (!Number.isInteger(field.columns) || field.columns < 2)
    throw new Error("World topology columns must be integers of at least 2.");
  if (field.heights.length !== field.rows * field.columns)
    throw new Error("World topology heights must contain rows times columns samples.");
  if (field.flow.length !== field.rows * field.columns)
    throw new Error("World topology flow must contain rows times columns samples.");
  for (let index = 0; index < field.flow.length; index += 1) {
    const value = field.flow[index];
    if (value === undefined || !Number.isFinite(value) || value < 0 || value > 1)
      throw new Error("World topology flow samples must be finite values from 0 through 1.");
  }
  return {
    directionalAnisotropy: directionalAnisotropy(field),
    effectiveVertexDensityPerKm2:
      (field.rows * field.columns * 1_000_000) / (field.width * field.depth),
    maxHortonStrahlerOrder: streamOrder(field),
    median64mRelief: median64mRelief(field),
    powerSpectrumSlope: powerSpectrumSlope(field),
    profileCurvatureExcessKurtosis: curvatureExcessKurtosis(field),
    reliefFieldEdge: reliefFieldEdge(field),
    slopeTailAbove30Degrees: slopeTail(field),
  };
}
