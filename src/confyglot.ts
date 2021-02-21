import * as Path from "path";
import { BaseEncodingOptions, promises as defaultPromiseBasedFs } from "fs";
import TOML from "@iarna/toml";
import ini from "ini";
import yaml from "js-yaml";
import { strict as assert } from "assert";
import Ajv, { JSONSchemaType, AnySchema } from "ajv";
import { normalize } from "./normalize";

const getAjv = (() => {
  let ajv: Ajv | undefined = undefined;
  return (): Ajv => {
    if (ajv === undefined) {
      ajv = new Ajv();
    }
    return ajv;
  };
})();

export type Format = "toml" | "yaml" | "ini" | "json";

export type SomeObject = Record<string, unknown>;

type ParseFunction = (text: string, options: Options) => SomeObject;

const parseYaml: ParseFunction = (text, options) => {
  const result = yaml.load(text);
  if (typeof result !== "object") {
    throw new Error(`yaml file does not contain an object`);
  }
  return normalize("yaml", result as Record<string, unknown>, options);
};

const parsers: {
  [extension: string]: ParseFunction;
} = {
  ".ini"(text, options) {
    return normalize("ini", ini.parse(text), options);
  },
  ".json"(text, options) {
    return normalize("json", JSON.parse(text), options);
  },
  ".toml"(text, options) {
    return normalize("toml", TOML.parse(text), options);
  },
  ".yaml": parseYaml,
  ".yml": parseYaml,
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

  // TOML does not allow mixed-type arrays. Set to true to enforce this behavior
  // across all configuration formats.
  forbidMixedArrays?: boolean;
}

const defaultOptions: Options = {
  fs: defaultPromiseBasedFs,
  normalize: true,
  forbidMixedArrays: true,
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
