import { AnySchema, JSONSchemaType } from "ajv";
import { BaseEncodingOptions, promises as defaultPromiseBasedFs } from "fs";

/**
  The options you can use to configure Confyglot.
 */
export interface Options<
  YourConfiguration extends Record<string, unknown> = Record<string, unknown>
> {
  /**
    The filename without extension that Confyglot should use to find
    configuration files.

    Confyglot adds the enabled format file extensions to this prefix to search a
    directory for configuration files.
   */
  configPrefix: string;

  /**
    Whether to normalize the configuration across possible formats.

    Various formats have varying support for data types like integer, float,
    date, array, etc. With normalize, Confyglot makes a best effort to have
    consistent output regardless of which format was used.
   */
  normalize: boolean;

  /**
    The fs to use. Enables Confyglot to be used in mocks and unit tests. By
    default, this is the built-in fs.promises.
   */
  fs: SomePromiseBasedFs;

  /**
    TOML does not support null. Set this to true to have Confyglot convert any
    strings that exactly match "null" to the proper JS null value, `null`.
   */
  transformNullStringToNull: boolean;

  /**
    TOML does not allow mixed-type arrays. Set to true to enforce this behavior
    across all configuration formats.
   */
  forbidMixedArrays: boolean;

  /**
    A JSON schema for your configuration type. Confyglot uses Ajv to validate
    each loaded configuration.
   */
  schema?: AnySchema | JSONSchemaType<YourConfiguration>;

  /**
    The default values of your configuration to use. Loaded configurations can
    override property by property.

    When no configuration files could be loaded, Confyglot.load() returns this
    object or undefined if this option is undefined.
   */
  defaults?: YourConfiguration;
}

export const defaultOptions: Options = {
  fs: defaultPromiseBasedFs,
  normalize: true,
  forbidMixedArrays: true,
  configPrefix: ".project",
  transformNullStringToNull: true,
};

/**
 Options provided to Confyglot.load().
 */
export interface LoadOptions {
  /**
    Specifies the root path above which Confyglot will not search for
    configuration files. If unspecified, [[Confyglot.load]] only searches the
    one directory given to it.
   */
  root?: string;
}

/**
  Everything confyglot needs from the fs.
 */
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
