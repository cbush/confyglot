import { ValidateFunction } from "ajv";
import { findConfigs } from "./find";
import { Options, LoadOptions, defaultOptions } from "./Options";
import { parseConfigurations, getAjv } from "./parse";

/**
  Confyglot searches directory trees for configuration files in various formats.
*/
export class Confyglot<
  YourConfiguration extends Record<string, unknown> = Record<string, unknown>
> {
  constructor(options?: Partial<Options<YourConfiguration>>) {
    this._options = {
      ...(defaultOptions as Options<YourConfiguration>),
      ...(options ?? {}),
    };

    const { schema } = this._options;
    if (schema !== undefined) {
      this._validate = getAjv().compile(schema);
    }
  }

  /**
    Loads the configuration(s) at directoryPath and above to options.root.

    Root is at the top of the tree and directoryPath is presumably somewhere
    below that. Configurations lower on the tree override properties of
    configurations higher in the tree. In other words, configurations cascade.
  */
  load = async (
    directoryPath: string,
    options?: LoadOptions
  ): Promise<YourConfiguration | undefined> => {
    const configPaths = await findConfigs(this, directoryPath, options);
    const configurations = await parseConfigurations(this, configPaths);

    const { defaults } = this._options;

    if (configurations.length === 0) {
      return defaults;
    }

    // Cascade the configuration(s) from the root starting with the defaults.
    // Later configurations override earlier configurations.
    const configuration = configurations.reduce((acc, cur) => {
      return {
        ...acc,
        ...cur,
      };
    }, defaults ?? {});

    return configuration as YourConfiguration;
  };

  _options: Options<YourConfiguration>;
  _validate?: ValidateFunction<YourConfiguration>;
}

/**
  Convenient instanceless wrapper around [[Confyglot.load]]. For repeated usage
  with the same options, prefer to create a [[Confyglot]] instance.
 */
export const load = <
  ConfigOut extends Record<string, unknown> = Record<string, unknown>
>(
  directoryPath: string,
  options?: Partial<Options<ConfigOut>> & LoadOptions
): Promise<ConfigOut | undefined> => {
  const instance = new Confyglot<ConfigOut>(options);
  return instance.load(directoryPath, { root: options?.root });
};
