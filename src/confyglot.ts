import * as Path from "path";
import { BaseEncodingOptions, promises as defaultPromiseBasedFs } from "fs";
import TOML from "@iarna/toml";
import ini from "ini";
import yaml from "js-yaml";
import { strict as assert } from "assert";
import Ajv, { JSONSchemaType, AnySchema } from "ajv";

const getAjv = (() => {
  let ajv: Ajv | undefined = undefined;
  return (): Ajv => {
    if (ajv === undefined) {
      ajv = new Ajv();
    }
    return ajv;
  };
})();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SomeObject = Record<string, any>;

type ParseFunction = (text: string) => SomeObject;
type ParseWithOptionsFunction = (text: string, options: Options) => SomeObject;

// Different formats have various support for dates, bool, number, etc.
// Normalize them all here.
const normalize = (object: SomeObject, options: Options): SomeObject => {
  if (!options.normalize) {
    return object;
  }
  return JSON.parse(JSON.stringify(object));
};

const normalized = (parse: ParseFunction): ParseWithOptionsFunction => {
  return (text, options): SomeObject => normalize(parse(text), options);
};

const parseYaml: ParseFunction = (text) => {
  const result = yaml.load(text);
  if (typeof result !== "object") {
    throw new Error(`yaml file does not contain an object`);
  }
  return result as Record<string, unknown>;
};

const parsers: {
  [extension: string]: ParseWithOptionsFunction;
} = {
  ".ini"(text, options) {
    const parsed = ini.parse(text);
    if (!options.normalize) {
      return parsed;
    }
    let json = JSON.stringify(parsed);
    // Replace json number-like strings with their numeric equivalents
    // unless they are used in a key.
    // See https://www.json.org/ for supported number types.
    json = json.replace(
      /([:[,]?)"(-?(?:[1-9]\d*|0)(?:\.\d+)?(?:[Ee][+-]?\d+)?)"([^:])/g,
      "$1$2$3"
    );
    return JSON.parse(json);
  },
  ".json"(text) {
    return JSON.parse(text);
  },
  ".toml"(text, options) {
    const parsed = TOML.parse(text);
    if (!options.normalize) {
      return parsed;
    }
    let json = JSON.stringify(parsed);
    if (options.transformNullStringToNull) {
      // Find "null" as object value or array element, but not as object key,
      // and replace with `null`.
      json = json.replace(/([:[,]?)"null"([^:])/g, "$1null$2");
    }
    return JSON.parse(json);
  },
  ".yaml": normalized(parseYaml),
  ".yml": normalized(parseYaml),
};

// Everything confyglot needs from the fs
export interface SomePromiseBasedFs {
  readdir(
    path: string,
    options?:
      | (BaseEncodingOptions & { withFileTypes?: false })
      | BufferEncoding
      | null
  ): Promise<string[]>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
}

export interface Options {
  fs?: SomePromiseBasedFs;
  root?: string;
  transformNullStringToNull?: boolean;
  normalize?: boolean;
}

const defaultOptions: Options = {
  fs: defaultPromiseBasedFs,
  normalize: true,
};

const findConfig = async (
  directoryPath: string,
  fs: SomePromiseBasedFs
): Promise<string | undefined> => {
  const list = await fs.readdir(directoryPath);
  const configs = list
    .filter((file) => {
      return /^\.project\.(js|json|ya?ml|toml|ini)$/i.test(file);
    })
    .map((file) => Path.join(directoryPath, file));
  if (configs.length > 1) {
    throw new Error(
      `multiple possible configurations found in '${directoryPath}': ${configs.join(
        ", "
      )}`
    );
  }
  return configs[0];
};

/**
  Loads any configuration files within the given directory path.

  @param directoryPath - The starting path to find configurations in.
*/
export const load = async <ConfigOut = SomeObject>(
  directoryPath: string,
  options?: Options & {
    defaults?: ConfigOut;
    schema?: AnySchema | JSONSchemaType<ConfigOut>;
  }
): Promise<ConfigOut> => {
  const c = { ...defaultOptions, ...(options ?? {}) };
  const { fs } = c;
  assert(fs !== undefined);

  const root = Path.resolve(Path.join(c.root ?? Path.sep, Path.sep));
  const relativeFromRoot = Path.relative(root, directoryPath);
  if (/^\.\./.test(relativeFromRoot)) {
    throw new Error(
      `root '${root}' is not related to given directory ${directoryPath}`
    );
  }

  // Build up the configuration from the root of the hierarchy. Allow later
  // configurations to override earlier ones.
  const segments = relativeFromRoot.split(Path.sep);
  let path = Path.resolve(root);
  const configPaths = (
    await Promise.all(
      segments.map((segment) => {
        path = Path.join(path, segment);
        return findConfig(path, fs);
      })
    )
  ).filter((pathOrUndefined) => pathOrUndefined !== undefined) as string[];

  const validate =
    c.schema !== undefined ? getAjv().compile(c.schema) : undefined;

  const configurations = await Promise.all(
    configPaths.map(async (configPath) => {
      try {
        const text = await fs.readFile(configPath, "utf8");
        const extension = Path.extname(configPath).toLowerCase();
        const parse = parsers[extension];
        if (parse === undefined) {
          // This should never happen
          throw new Error(
            `Parser for extension '${extension}' undefined! This should never happen. Please file a bug: https://github.com/cbush/confyglot/issues/new`
          );
        }
        const result = parse(text, c);
        if (validate !== undefined && !validate(result)) {
          throw new Error(
            getAjv().errorsText(validate.errors, {
              separator: "\n",
              dataVar: "",
            })
          );
        }
        return result;
      } catch (error) {
        error.message = `error with configuration '${configPath}': ${error.message}`;
        throw error;
      }
    })
  );

  const configuration = configurations.reduce((acc, cur) => {
    return {
      ...acc,
      ...cur,
    };
  }, c.defaults ?? {});

  return configuration as ConfigOut;
};
