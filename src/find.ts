import { defaultOptions, LoadOptions } from "./Options";
import { strict as assert } from "assert";
import * as Path from "path";
import { Confyglot } from "./confyglot";

export const findConfig = async (
  instance: Confyglot,
  directoryPath: string
): Promise<string | undefined> => {
  const { fs, configPrefix } = instance._options;
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

export const findConfigs = async (
  instance: Confyglot,
  directoryPath: string,
  options?: LoadOptions
): Promise<string[]> => {
  const root = Path.resolve(
    Path.join(options?.root ?? directoryPath, Path.sep)
  );
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
  return (
    await Promise.all(
      segments.map((segment) => {
        path = Path.join(path, segment);
        return findConfig(instance, path);
      })
    )
  ).filter((pathOrUndefined) => pathOrUndefined !== undefined) as string[];
};
