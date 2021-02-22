import { Format } from "./parse";
import { Options } from "./Options";
import { strict as assert } from "assert";

type Transformer = (
  value: unknown,
  propertyNameBreadcrumbs: string[]
) => unknown;

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

type TomlishType =
  | "string"
  | "array"
  | "object"
  | "float"
  | "integer"
  | "boolean"
  | "null"
  | "other";

// TOML has "strong but shallow" typing with the following types: String,
// Integer, Float, Boolean, Datetime, Array, Inline Table. (See
// https://github.com/toml-lang/toml/issues/553#issuecomment-410117682)
// "Tomlish" types are those types representable by confyglot.
const getTomlishType = (v: unknown): TomlishType => {
  if (Array.isArray(v)) {
    return "array";
  }
  if (v === null) {
    return "null";
  }
  const type = typeof v;
  switch (type) {
    case "number":
      return Number.isInteger(v) ? "integer" : "float";
    case "bigint":
      return "integer";
    case "function":
    case "symbol":
    case "undefined":
      return "other";
  }
  return type;
};

const forbidMixedArrays: Transformer = (
  maybeArray,
  propertyNameBreadcrumbs
) => {
  if (!Array.isArray(maybeArray)) {
    return maybeArray;
  }
  const array = maybeArray;
  let firstType: TomlishType | undefined;
  array.forEach((v) => {
    const type = getTomlishType(v);
    if (firstType === undefined) {
      firstType = type;
    }
    if (type !== firstType) {
      // Unfortunately, we don't know the location in the original configuration
      // file, but we can give a good hint using the property name breadcrumbs.
      throw new Error(
        `with forbidMixedArrays=true, arrays must be of a single type, not a mix of ${type} and ${firstType}: value of '${propertyNameBreadcrumbs.join(
          "."
        )}' is approximately ${JSON.stringify(array)}`
      );
    }
  });
  return array;
};

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
  if (options.forbidMixedArrays) {
    transformers.push(forbidMixedArrays);
  }
  return transformers;
};

// Run through tree and apply transformers.
const transform = (
  value: unknown,
  transformers: Transformer[],
  breadcrumbs: string[]
): unknown => {
  assert(transform.length > 0, "pointless call to transform()");
  const applyTransformers = (v: unknown) =>
    transformers.reduce((v, transform) => transform(v, breadcrumbs), v);

  if (Array.isArray(value)) {
    value = value.map((v, i) =>
      transform(v, transformers, [...breadcrumbs, i.toString()])
    );
    // Give transformers an opportunity to work on the array itself
    return applyTransformers(value);
  }
  if (value === null || typeof value !== "object") {
    return applyTransformers(value);
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, value]) => {
      const newBreadcrumbs = [...breadcrumbs, key];
      const transformedValue = transform(value, transformers, newBreadcrumbs);
      return [key, transformedValue];
    })
  );
};

// Different formats have various support for dates, bool, number, etc.
// Normalize them all here.
export const normalize = (
  format: Format,
  parsedObject: Record<string, unknown>,
  options: Options
): Record<string, unknown> => {
  try {
    if (!options.normalize) {
      return parsedObject;
    }

    if (format !== "json") {
      parsedObject = JSON.parse(JSON.stringify(parsedObject));
    }

    const transformers = getTransformersForFormat(format, options);
    if (transformers.length > 0) {
      parsedObject = transform(parsedObject, transformers, []) as Record<
        string,
        unknown
      >;
    }
    return parsedObject;
  } catch (error) {
    error.message = `normalization failed: ${error.message}`;
    throw error;
  }
};
