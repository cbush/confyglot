import { createFsFromVolume, Volume } from "memfs";
import confyglot from "./";
import { Options, SomePromiseBasedFs } from "./confyglot";
import * as Path from "path";
import { JSONSchemaType } from "ajv";
import { strict as assert } from "assert";

describe("confyglot", () => {
  const volume = Volume.fromJSON(
    {
      "path/to/my/project/src/info.txt": "Hello, world!\n",
      "path/to/my/project/.project.toml": `title = "Fan file"

[favoriteCaptain]
name = "Sisko"
dob = 2332-10-21T14:30:00-06:00
hobbies = [ "baseball", "cooking", "history" ]
`,
      "path/to/my/.project.json": `{
  "title": "Fan file",
  "favoriteEpisode": "House of Quark",
  "favoriteCaptain": {
    "name": "Picard",
    "dob": "2305-07-13T03:00:00+01:00",
    "hobbies": ["acting", "archaeology", "playing the flute"]
  }
}`,
    },
    Path.resolve()
  );
  const fs = createFsFromVolume(volume).promises;

  it("cascades results", async () => {
    const result = await confyglot.load("path/to/my/project/src", {
      fs: fs as SomePromiseBasedFs,
    });

    expect(result).toStrictEqual({
      title: "Fan file",
      favoriteCaptain: {
        name: "Sisko",
        dob: "2332-10-21T20:30:00.000Z",
        hobbies: ["baseball", "cooking", "history"],
      },
      favoriteEpisode: "House of Quark",
    });
  });

  it("respects root", async () => {
    const result1 = await confyglot.load("path/to/my/project/src", {
      fs: fs as SomePromiseBasedFs,
      root: Path.resolve("path/to/my/"),
    });

    expect(result1["favoriteEpisode"]).toBeUndefined();

    const result2 = await confyglot.load("path/to/my/project/src", {
      fs: fs as SomePromiseBasedFs,
      root: Path.resolve("path/to/my"), // Trailing slash should not matter
    });
    expect(result2["favoriteEpisode"]).toBeUndefined();
  });

  it("rejects unrelated root", async () => {
    await expect(
      confyglot.load("path/to/my/project/src", {
        fs: fs as SomePromiseBasedFs,
        root: "/path/to/something/completely/different",
      })
    ).rejects.toThrow(
      "root '/path/to/something/completely/different' is not related to given directory path/to/my/project/src"
    );
  });

  it("reports error if multiple configurations discovered in one directory", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/path/to/project/.project.json": "",
        "/path/to/project/.project.toml": "",
      })
    ).promises;
    await expect(
      confyglot.load("/path/to/project", {
        fs: fs as SomePromiseBasedFs,
      })
    ).rejects.toThrow(
      "multiple possible configurations found in '/path/to/project': /path/to/project/.project.json, /path/to/project/.project.toml"
    );
  });

  it("supports yaml", async () => {
    // Example from Wikipedia
    const exampleYaml = `
receipt:     Oz-Ware Purchase Invoice
date:        2012-08-06
customer:
    first_name:   Dorothy
    family_name:  Gale

items:
    - part_no:   A4786
      descrip:   Water Bucket (Filled)
      price:     1.47
      quantity:  4

    - part_no:   E1628
      descrip:   High Heeled "Ruby" Slippers
      size:      8
      price:     133.7
      quantity:  1

bill-to:  &id001
    street: |
            123 Tornado Alley
            Suite 16
    city:   East Centerville
    state:  KS

ship-to:  *id001

specialDelivery:  >
    Follow the Yellow Brick
    Road to the Emerald City.
    Pay no attention to the
    man behind the curtain.
`;
    const expectedResult = {
      "bill-to": {
        city: "East Centerville",
        state: "KS",
        street: `123 Tornado Alley\nSuite 16\n`,
      },
      customer: {
        family_name: "Gale",
        first_name: "Dorothy",
      },
      date: "2012-08-06T00:00:00.000Z",
      items: [
        {
          descrip: "Water Bucket (Filled)",
          part_no: "A4786",
          price: 1.47,
          quantity: 4,
        },
        {
          descrip: 'High Heeled "Ruby" Slippers',
          part_no: "E1628",
          price: 133.7,
          quantity: 1,
          size: 8,
        },
      ],
      receipt: "Oz-Ware Purchase Invoice",
      "ship-to": {
        city: "East Centerville",
        state: "KS",
        street: `123 Tornado Alley\nSuite 16\n`,
      },
      specialDelivery: `Follow the Yellow Brick Road to the Emerald City. Pay no attention to the man behind the curtain.\n`,
    };
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/path/to/project/.project.yaml": exampleYaml,
        // .yml is also okay
        "/path/to/anotherProject/.project.yml": exampleYaml,
      })
    ).promises;
    expect(
      await confyglot.load("/path/to/project", {
        fs: fs as SomePromiseBasedFs,
        root: "/path/to/project",
      })
    ).toStrictEqual(expectedResult);
    expect(
      await confyglot.load("/path/to/anotherProject", {
        fs: fs as SomePromiseBasedFs,
        root: "/path/to/anotherProject",
      })
    ).toStrictEqual(expectedResult);
  });

  it("supports ini", async () => {
    // Example from Wikipedia
    const exampleIni = `; last modified 1 April 2001 by John Doe
[owner]
name=John Doe
organization=Acme Widgets Inc.

[database]
; use IP address in case network name resolution is not working
server=192.0.2.62
port=143
file="payroll.dat"
someArray[]=abc
someArray[]=123
foo=true
`;
    const expectedResult = {
      owner: {
        name: "John Doe",
        organization: "Acme Widgets Inc.",
      },
      database: {
        server: "192.0.2.62",
        port: 143,
        file: "payroll.dat",
        someArray: ["abc", 123],
        foo: true,
      },
    };
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/path/to/project/.project.ini": exampleIni,
      })
    ).promises;
    const result = await confyglot.load("/path/to/project", {
      fs: fs as SomePromiseBasedFs,
      root: "/path/to/project",
    });
    expect(result).toStrictEqual(expectedResult);
  });

  it("supports json", async () => {
    const exampleJson = `{
  "title": "Fan file",
  "favoriteEpisode": "House of Quark",
  "favoriteCaptain": {
    "name": "Picard",
    "dob": "2305-07-13T03:00:00+01:00",
    "hobbies": ["acting", "archaeology", "playing the flute"]
  }
}`;
    const expectedResult = {
      title: "Fan file",
      favoriteEpisode: "House of Quark",
      favoriteCaptain: {
        name: "Picard",
        dob: "2305-07-13T03:00:00+01:00",
        hobbies: ["acting", "archaeology", "playing the flute"],
      },
    };
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/path/to/project/.project.json": exampleJson,
      })
    ).promises;
    const result = await confyglot.load("/path/to/project", {
      fs: fs as SomePromiseBasedFs,
      root: "/path/to/project",
    });
    expect(result).toStrictEqual(expectedResult);
  });

  it("supports toml", async () => {
    const exampleToml = `title = "Fan file"

[favoriteCaptain]
name = "Sisko"
dob = 2332-10-21T14:30:00-06:00
hobbies = [ "baseball", "cooking", "history" ]
`;
    const expectedResult = {
      title: "Fan file",
      favoriteCaptain: {
        name: "Sisko",
        dob: "2332-10-21T20:30:00.000Z", // converted to ISO string
        hobbies: ["baseball", "cooking", "history"],
      },
    };
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/path/to/project/.project.toml": exampleToml,
      })
    ).promises;
    const result = await confyglot.load("/path/to/project", {
      fs: fs as SomePromiseBasedFs,
      root: "/path/to/project",
    });
    expect(result).toStrictEqual(expectedResult);
  });

  it("throws on invalid input", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/toml/.project.toml": `[invalid toml`,
        "/json/.project.json": `{invalid json`,
        "/yaml/.project.yaml": `[invalid yaml`,
        "/yaml2/.project.yaml": `not an object`,
        // Nothing I do with ini seems to be invalid
      })
    ).promises;
    await expect(
      confyglot.load("/toml", {
        fs: fs as SomePromiseBasedFs,
      })
    ).rejects.toThrow(
      /^error with configuration '\/toml\/.project.toml': Unexpected character, expected whitespace, . or ]/
    );

    await expect(
      confyglot.load("/json", {
        fs: fs as SomePromiseBasedFs,
      })
    ).rejects.toThrow(
      /^error with configuration '\/json\/.project.json': Unexpected token i in JSON at position 1/
    );

    await expect(
      confyglot.load("/yaml", {
        fs: fs as SomePromiseBasedFs,
      })
    ).rejects.toThrow(
      /^error with configuration '\/yaml\/.project.yaml': unexpected end of the stream within a flow collection \(2:1\)/
    );

    await expect(
      confyglot.load("/yaml2", {
        fs: fs as SomePromiseBasedFs,
      })
    ).rejects.toThrow(
      /^error with configuration '\/yaml2\/.project.yaml': yaml file does not contain an object/
    );
  });

  it("throws if directoryPath is not valid", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/path/to/project/file.txt": "",
      })
    ).promises;
    await expect(
      confyglot.load("/path/to/project/file.txt", {
        fs: fs as SomePromiseBasedFs,
      })
    ).rejects.toThrow(
      "ENOTDIR: not a directory, scandir '/path/to/project/file.txt'"
    );
    await expect(
      confyglot.load("/path/to/nowhere", {
        fs: fs as SomePromiseBasedFs,
      })
    ).rejects.toThrow(
      "ENOENT: no such file or directory, readdir '/path/to/nowhere'"
    );
  });

  it("supports schema validation", async () => {
    await expect(
      confyglot.load("path/to/my/project", {
        fs: fs as SomePromiseBasedFs,
        schema: {
          type: "object",
          required: ["title", "favoriteCaptain"],
          properties: {
            title: {
              type: "string",
            },
            captain: {
              type: "object",
            },
          },
        },
      })
    ).resolves.toBeDefined();

    type FanFile = {
      favoriteCaptain: {
        name: string;
        dob: string;
        hobbies: string[];
      };
    };
    const schema: JSONSchemaType<FanFile> = {
      type: "object",
      required: ["favoriteCaptain"],
      properties: {
        favoriteCaptain: {
          type: "object",
          required: ["name", "dob", "hobbies"],
          properties: {
            name: {
              type: "string",
            },
            dob: {
              type: "string",
            },
            hobbies: { type: "array", items: { type: "string" } },
          },
        },
      },
    };
    await expect(
      confyglot.load<FanFile>("path/to/my/project", {
        fs: fs as SomePromiseBasedFs,
        schema,
      })
    ).resolves.toMatchObject({
      favoriteCaptain: {
        dob: "2332-10-21T20:30:00.000Z",
      },
    });

    await expect(
      confyglot.load("path/to/my/project", {
        fs: fs as SomePromiseBasedFs,
        schema: {
          type: "object",
          required: ["something I forgot"],
          properties: {
            "something I forgot": {
              type: "string",
            },
          },
        },
      })
    ).rejects.toThrow(
      new RegExp(
        `^error with configuration '${Path.resolve(
          "path/to/my/.project.json"
        )}':  should have required property 'something I forgot'`
      )
    );
  });

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
