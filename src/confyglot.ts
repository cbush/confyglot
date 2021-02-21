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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const restoreProto = (value: any): any => {
  if (typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, value]) => {
      if (Array.isArray(value)) {
        return [key, value.map(restoreProto)];
      }
      return [key, restoreProto(value)];
    })
  );
};

const parsers: {
  [extension: string]: ParseFunction;
} = {
  ".ini"(text) {
    // The ini library doesn't bother copying __proto__ which does make for
    // unexpected behavior in unit tests
    return restoreProto(ini.parse(text));
  },
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
        return findConfig(path, fs);
      })
    )
  ).filter((pathOrUndefined) => pathOrUndefined !== undefined) as string[];

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
