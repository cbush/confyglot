import * as Path from "path";
import { BaseEncodingOptions, promises as defaultPromiseBasedFs } from "fs";
import TOML from "@iarna/toml";
import ini from "ini";
import yaml from "js-yaml";
import { strict as assert } from "assert";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SomeObject = Record<string, any>;

type ParseFunction = (text: string) => SomeObject;

const parseYaml: ParseFunction = (text) => {
  const result = yaml.load(text);
  if (typeof result !== "object") {
    throw new Error(`yaml file does not contain an object`);
  }
  return result as Record<string, unknown>;
};

const parsers: {
  [extension: string]: ParseFunction;
} = {
  ".ini": ini.parse,
  ".json": JSON.parse,
  ".toml": TOML.parse,
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

export interface ConfigIn {
  fs?: SomePromiseBasedFs;
  root?: string;
}

const defaultConfigIn: ConfigIn = {
  fs: defaultPromiseBasedFs,
};

const findConfigs = async (
  directoryPath: string,
  fs: SomePromiseBasedFs
): Promise<string[]> => {
  const list = await fs.readdir(directoryPath);
  const configs = list
    .filter((file) => {
      return /^\.project\.(js|json|ya?ml|toml|ini)$/i.test(file);
    })
    .map((file) => Path.join(directoryPath, file));
  return configs;
};

export const load = async <ConfigOut = SomeObject>(
  directoryPath: string,
  configIn?: ConfigIn & { defaults?: ConfigOut }
): Promise<ConfigOut> => {
  const c = { ...defaultConfigIn, ...(configIn ?? {}) };
  const { fs } = c;
  assert(fs !== undefined);

  const root = Path.resolve(Path.join(c.root ?? Path.sep, Path.sep));
  const relativeFromRoot = Path.relative(root, directoryPath);
  if (/^\.\./.test(relativeFromRoot)) {
    throw new Error(
      `root '${root}' is not related to given directory ${directoryPath}`
    );
  }

  const segments = relativeFromRoot.split(Path.sep);
  let path = Path.resolve(root);
  const configPaths = (
    await Promise.all(
      segments.map((segment) => {
        path = Path.join(path, segment);
        return findConfigs(path, fs);
      })
    )
  ).flat();

  const configurations = await Promise.all(
    configPaths.map(async (configPath) => {
      const text = await fs.readFile(configPath, "utf8");
      const extension = Path.extname(configPath).toLowerCase();
      const parse = parsers[extension];
      if (parse === undefined) {
        throw new Error(`Parser for extension '${extension}' undefined!`);
      }
      return parse(text);
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
