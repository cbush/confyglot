import { createFsFromVolume, Volume } from "memfs";
import confyglot from "./";
import { Options, SomePromiseBasedFs } from "./";
import { strict as assert } from "assert";

describe("confyglot.normalize", () => {
  it("has consistent output regardless of format used", async () => {
    // Note: yaml lowercases "True", "False", and "Null" even if in keys
    const yaml = `myTrue: true
myFalse: false
Integer: 1
Double: 1.234e-7
String: Hello, world!
Date: 1985-10-21T14:30:00-05:00
myNull: null
`;
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/toml/.project.toml": `myTrue = true
myFalse = false
Integer = 1
Double = 1.234e-7
String = "Hello, world!"
Date = 1985-10-21T14:30:00-05:00
myNull = "null"
`,
        "/json/.project.json": `{
  "myTrue": true,
  "myFalse": false,
  "Integer": 1,
  "Double": 1.234e-7,
  "String": "Hello, world!",
  "Date": "1985-10-21T19:30:00.000Z",
  "myNull": null
}`,
        "/yaml/.project.yaml": yaml,
        "/yml/.project.yml": yaml,
        "/ini/.project.ini": `myTrue = true
myFalse = false
Integer = 1
Double = 1.234e-7
String = Hello, world!
Date = 1985-10-21T19:30:00.000Z
myNull = null
`,
      })
    ).promises;

    const options: Partial<Options> = {
      fs: fs as SomePromiseBasedFs,
      transformNullStringToNull: true,
    };
    const results = await Promise.all(
      ["/toml", "/json", "/yaml", "/yml", "/ini"].map(async (path) => {
        const result = await confyglot.load(path, options);
        return [path, result];
      })
    );
    const firstResult = results.shift();
    expect(firstResult).toBeDefined();
    assert(firstResult !== undefined);
    results.forEach(([path, result]) => {
      expect(result).toStrictEqual(firstResult[1]);
    });
  });

  it("has consistent output for case sensitivity", async () => {
    const yaml = `someKey: a
SOMEKEY: b
somekey: c
`;
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/toml/.project.toml": `someKey = "a"
SOMEKEY = "b"
somekey = "c"
`,
        "/json/.project.json": `{
  "someKey": "a",
  "SOMEKEY": "b",
  "somekey": "c"
}`,
        "/yaml/.project.yaml": yaml,
        "/yml/.project.yml": yaml,
        "/ini/.project.ini": `someKey=a
SOMEKEY=b
somekey=c
`,
      })
    ).promises;

    const options: Partial<Options> = {
      fs: fs as SomePromiseBasedFs,
      transformNullStringToNull: true,
    };
    const results = await Promise.all(
      ["/toml", "/json", "/yaml", "/yml", "/ini"].map(async (path) => {
        const result = await confyglot.load(path, options);
        return [path, result];
      })
    );
    const firstResult = results.shift();
    expect(firstResult).toBeDefined();
    assert(firstResult !== undefined);
    assert(firstResult[1] !== undefined);
    expect(Object.keys(firstResult[1])).toStrictEqual([
      "someKey",
      "SOMEKEY",
      "somekey",
    ]);
    results.forEach(([path, result]) => {
      assert(result !== undefined);
      expect(Object.keys(result)).toStrictEqual([
        "someKey",
        "SOMEKEY",
        "somekey",
      ]);
      expect(result).toStrictEqual(firstResult[1]);
    });
  });

  it("does not replace null when in toml string", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/toml/.project.toml": `a = "this is not \\"null\\" so don't replace it"
"null" = "another key"
b = "null"
c = "this is not:\\"null\\"."
"not:\\"null\\"" = "foo"
someArray = ["null", "null", "not null", "null", "NULL", "null"]
`,
      })
    ).promises;

    const options: Partial<Options> = {
      fs: fs as SomePromiseBasedFs,
      transformNullStringToNull: true,
      forbidMixedArrays: false,
    };
    const result = await confyglot.load("/toml", options);
    expect(result).toStrictEqual({
      a: `this is not "null" so don't replace it`,
      null: "another key",
      b: null,
      c: `this is not:"null".`,
      'not:"null"': "foo",
      someArray: [null, null, "not null", null, "NULL", null],
    });
  });

  it("replaces ini numbers when normalize = true", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/ini/.project.ini": `[section]
num = -1234.0e7
a[] = 1
a[] = 1.234e5
a[] = -0.3
a[] = -1.0E-2
a[] = 1.2E+3
a[] = 10.12345
a[] = 1E2
a[] = 1e3
notnum[] = +123
notnum[] = 01234
1234 = notnum
"-0.23e7" = notnum
`,
      })
    ).promises;

    const options: Partial<Options> = {
      fs: fs as SomePromiseBasedFs,
      normalize: true,
      forbidMixedArrays: false,
    };
    const result = await confyglot.load("/ini", options);
    expect(result).toStrictEqual({
      section: {
        num: -1234.0e7,
        a: [1, 1.234e5, -0.3, -1.0e-2, 1.2e3, 10.12345, 1e2, 1e3],
        notnum: ["+123", "01234"],
        1234: "notnum",
        "-0.23e7": "notnum",
      },
    });

    // Note that normalize: false returns whatever the ini() library gives back,
    // which does strip __proto__ from all objects for some reason. So don't
    // expect toStrictEqual() to work.
    expect(
      await confyglot.load("/ini", { ...options, normalize: false })
    ).toMatchObject({
      section: {
        num: "-1234.0e7",
        a: [
          "1",
          "1.234e5",
          "-0.3",
          "-1.0E-2",
          "1.2E+3",
          "10.12345",
          "1E2",
          "1e3",
        ],
        notnum: ["+123", "01234"],
        "1234": "notnum",
        "-0.23e7": "notnum",
      },
    });
  });

  it("forbids mixed arrays", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/toml/.project.toml": `array = [1, 1.2, "string"]`,
        "/json/.project.json": `{"a": {"b": [{"a": 1}, {"b": 1}, 2]}}`,
        "/yaml/.project.yaml": `array:
  - [1, 2, 3]
  - ["ok", "ok", "ok"]
  - string
`,
        "/ini/.project.ini": `array[]=1
array[]=1.2
array[]=string
`,
      })
    ).promises;

    const options: Partial<Options> = {
      fs: fs as SomePromiseBasedFs,
      forbidMixedArrays: true,
    };
    await expect(confyglot.load("/toml", options)).rejects.toThrow(
      `error with configuration '/toml/.project.toml': Inline lists must be a single type, not a mix of integer and float at row 1, col 17, pos 16`
    );
    await expect(confyglot.load("/json", options)).rejects.toThrow(
      `error with configuration '/json/.project.json': normalization failed: with forbidMixedArrays=true, arrays must be of a single type, not a mix of integer and object: value of 'a.b' is approximately [{"a":1},{"b":1},2]`
    );
    await expect(confyglot.load("/ini", options)).rejects.toThrow(
      `error with configuration '/ini/.project.ini': normalization failed: with forbidMixedArrays=true, arrays must be of a single type, not a mix of float and integer`
    );
    await expect(confyglot.load("/yaml", options)).rejects.toThrow(
      `error with configuration '/yaml/.project.yaml': normalization failed: with forbidMixedArrays=true, arrays must be of a single type, not a mix of string and array`
    );
    options.forbidMixedArrays = false;
    await expect(confyglot.load("/toml", options)).rejects.toThrow(
      `error with configuration '/toml/.project.toml': Inline lists must be a single type, not a mix of integer and float at row 1, col 17, pos 16`
    );
    await expect(confyglot.load("/json", options)).resolves.toBeDefined();
    await expect(confyglot.load("/ini", options)).resolves.toBeDefined();
    await expect(confyglot.load("/yaml", options)).resolves.toBeDefined();
  });
});
