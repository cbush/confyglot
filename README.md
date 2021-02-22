# Confyglot

Loads your app's configuration files in json, toml, yaml, ini, etc.

⚔️ What's the best format for configuration? Who cares! Stop wading into endless
arguments. Let your users decide!

Inspired most recently by
[release-it](https://www.npmjs.com/package/release-it)'s support for various
configuration formats.

- 📖 [API Documentation](https://cbush.github.io/confyglot/)
- 🗣️ [Open an issue](https://github.com/cbush/confyglot/issues/new)

## Usage

```sh
npm install confyglot
```

```js
const confyglot = require("confyglot")

confyglot.load("path/to/myProject/someDirectory/", {
  root: "path/to/myProject/", // Build up a cascading configuration up to a project root
  configPrefix: ".myConfig",  // Look for .myConfig.json, .myConfig.yaml, .myConfig.yml, etc.
  defaults: {
    bestFileInDirectory: "info.txt", // Default values to be overridden
  },
}).then((config) => {
  console.log("Loaded configuration:", config);
}).catch((error) => {
  console.error("Failed with error:", error)
});
```

## Feature Overview

### Normalization

Various formats have various support for data types like date, numbers(!), and
null. By default, Confyglot tries to normalize the output configuration so that
you can work with the same JS object shape regardless of which configuration
format was used.

>💡 You can even
>[force](https://cbush.github.io/confyglot/interfaces/options.html#forbidmixedarrays)
>any configuration format to have homogenous arrays like TOML does.

### Cascading Configurations Across Directories 

Subdirectories might want to override some of the properties of a parent
directory's configuration. Let's call this "cascading". Confyglot can cascade
files at each level in a directory tree up to a certain project root. You can
also provide a default configuration that other configurations can override.

### Schema Validation

You can have Confyglot check every loaded configuration against a [JSON
Schema](https://json-schema.org/) you provide.

### TypeScript

The Confyglot class is generic, so you can specify the type of your
configuration that you expect to load. This is most useful when combined with
JSON schema validation.

## Caveats

### General

Confyglot is currently in pre-1.0 development. Its API may change. Also, it is
currently very aggressive with throwing exceptions on malformed user
configurations. After more usage we'll see if we might want to tone this down.

### YAML

⚠️ For some reason, yaml might turn these property names lowercase: "False",
"True", and "Null". Not sure in what other cases this might happen, but I would
avoid using keywords as field names in your configuration schema for now.
