import { BaseEncodingOptions, promises as defaultPromiseBasedFs } from "fs";

export interface Options {
  fs?: SomePromiseBasedFs;

  root?: string;

  configPrefix?: string;

  transformNullStringToNull?: boolean;
  normalize?: boolean;

  // TOML does not allow mixed-type arrays. Set to true to enforce this behavior
  // across all configuration formats.
  forbidMixedArrays?: boolean;
}

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

export const defaultOptions: Options = {
  fs: defaultPromiseBasedFs,
  normalize: true,
  forbidMixedArrays: true,
  configPrefix: ".project",
};
