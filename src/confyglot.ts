import { strict as assert } from "assert";
import * as Path from "path";
import TOML from "@iarna/toml";
import ini from "ini";
import yaml from "js-yaml";
import Ajv, { JSONSchemaType, AnySchema, ValidateFunction } from "ajv";
import { Options, defaultOptions } from "./Options";
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

export interface LoadOptions {
  root?: string;
}

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

const findConfig = async (
  directoryPath: string,
  options: Options
): Promise<string | undefined> => {
  const { fs, configPrefix } = options;
  assert(fs !== undefined);
  assert(configPrefix !== undefined);

  const reConfigPrefix = (configPrefix ?? defaultOptions.configPrefix).replace(
    ".",
    "\\."
  );

  const re = new RegExp(`^${reConfigPrefix}\\.(js|json|ya?ml|toml|ini)$`, "i");
  const list = await fs.readdir(directoryPath);
  const configs = list
    .filter((file) => {
      return re.test(file);
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

export class Confyglot<
  YourConfiguration extends Record<string, unknown> = Record<string, unknown>
> {
  constructor(options?: Options<YourConfiguration>) {
    this._options = {
      ...(defaultOptions as Options<YourConfiguration>),
      ...(options ?? {}),
    };

    const { schema } = this._options;
    if (schema !== undefined) {
      this._validate = getAjv().compile(schema);
    }
  }

  load = async (
    directoryPath: string,
    options?: LoadOptions
  ): Promise<YourConfiguration | undefined> => {
    const c = this._options;
    const { fs } = c;
    assert(fs !== undefined);

    const root = Path.resolve(Path.join(options?.root ?? Path.sep, Path.sep));
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
          return findConfig(path, c);
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

    if (configurations.length === 0) {
      return c.defaults;
    }

    const configuration = configurations.reduce((acc, cur) => {
      return {
        ...acc,
        ...cur,
      };
    }, c.defaults ?? {});

    return configuration as YourConfiguration;
  };

  _options: Options<YourConfiguration>;
  _validate?: ValidateFunction<YourConfiguration>;
}

export const load = <ConfigOut extends Record<string, unknown> = SomeObject>(
  directoryPath: string,
  options?: Options<ConfigOut> & LoadOptions
): Promise<ConfigOut | undefined> => {
  const instance = new Confyglot<ConfigOut>(options);
  return instance.load(directoryPath, { root: options?.root });
};
