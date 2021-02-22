import * as Path from "path";
import TOML from "@iarna/toml";
import ini from "ini";
import yaml from "js-yaml";
import Ajv from "ajv";
import { normalize } from "./normalize";
import { Options } from "./Options";
import { Confyglot } from "./confyglot";

export const getAjv = (() => {
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

export const parseConfigurations = <T extends Record<string, unknown>>(
  instance: Confyglot<T>,
  configPaths: string[]
): Promise<Record<string, unknown>[]> => {
  const { fs } = instance._options;
  const validate = instance._validate;
  return Promise.all(
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
        const result = parse(text, instance._options);

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
};
