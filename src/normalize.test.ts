import { createFsFromVolume, Volume } from "memfs";
import confyglot from "./";
import { Options, SomePromiseBasedFs } from "./confyglot";
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

    const options: Options = {
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
      console.log(`Compare ${path}`);
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

    const options: Options = {
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
    expect(Object.keys(firstResult[1])).toStrictEqual([
      "someKey",
      "SOMEKEY",
      "somekey",
    ]);
    results.forEach(([path, result]) => {
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

    const options: Options = {
      fs: fs as SomePromiseBasedFs,
      transformNullStringToNull: true,
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

    const options: Options = {
      fs: fs as SomePromiseBasedFs,
      normalize: true,
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
});