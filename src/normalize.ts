import { Format, SomeObject, Options } from "./confyglot";
import { strict as assert } from "assert";

type Transformer = (value: unknown) => unknown;

const convertNumberStrings: Transformer = (v) => {
  if (typeof v !== "string") {
    return v;
  }
  // Number() is overly generous about what it considers a number. This
  // regex restricts it to JSON-compatible types.
  const result = /^-?(?:[1-9]\d*|0)(?:\.\d+)?(?:[Ee][+-]?\d+)?$/.test(v)
    ? Number(v)
    : v;
  if (Number.isNaN(result)) {
    // If this happened something is terribly wrong with my code
    throw new Error(
      `kickflip on a rake failure: attempted to convert '${v}' to number, got NaN`
    );
  }
  return result;
};

const convertNullStrings: Transformer = (v) => (v === "null" ? null : v);

const getTransformersForFormat = (
  format: Format,
  options: Options
): Transformer[] => {
  const transformers: Transformer[] = [];
  switch (format) {
    case "ini":
      transformers.push(convertNumberStrings);
      break;
    case "toml":
      if (options.transformNullStringToNull) {
        transformers.push(convertNullStrings);
      }
      break;
  }
  return transformers;
};

const transform = (value: unknown, transformers: Transformer[]): unknown => {
  assert(transform.length > 0, "pointless call to transform()");
  const applyTransformers = (v: unknown) =>
    transformers.reduce((v, transform) => transform(v), v);

  if (Array.isArray(value)) {
    value = value.map((v) => transform(v, transformers));
    // Give transformers an opportunity to work on the array itself
    return applyTransformers(value);
  }
  if (value === null || typeof value !== "object") {
    return applyTransformers(value);
  }
  return Object.fromEntries(
    Object.entries(value as SomeObject).map(([k, v]) => [
      k,
      applyTransformers(transform(v, transformers)),
    ])
  );
};

// Different formats have various support for dates, bool, number, etc.
// Normalize them all here.
export const normalize = (
  format: Format,
  parsedObject: SomeObject,
  options: Options
): SomeObject => {
  try {
    if (!options.normalize) {
      return parsedObject;
    }

    if (format !== "json") {
      parsedObject = JSON.parse(JSON.stringify(parsedObject));
    }

    const transformers = getTransformersForFormat(format, options);
    if (transformers.length > 0) {
      parsedObject = transform(parsedObject, transformers) as SomeObject;
    }
    return parsedObject;
  } catch (error) {
    error.message = `normalization failed: ${error.message}`;
    throw error;
  }
};
