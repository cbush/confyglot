import { createFsFromVolume, Volume } from "memfs";
import confyglot from "./";
import { SomePromiseBasedFs } from "./confyglot";
import * as Path from "path";

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
        dob: new Date("2332-10-21T20:30:00.000Z"),
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
      date: new Date("2012-08-06T00:00:00.000Z"),
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
`;
    const expectedResult = {
      owner: {
        name: "John Doe",
        organization: "Acme Widgets Inc.",
      },
      database: {
        server: "192.0.2.62",
        port: "143",
        file: "payroll.dat",
        someArray: ["abc", "123"],
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
        dob: new Date("2332-10-21T14:30:00-06:00"),
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
        // Nothing I do with ini seems to be invalid
      })
    ).promises;
    await expect(
      confyglot.load("/toml", {
        fs: fs as SomePromiseBasedFs,
      })
    ).rejects.toThrow(/^Unexpected character, expected whitespace, . or ]/);

    await expect(
      confyglot.load("/json", {
        fs: fs as SomePromiseBasedFs,
      })
    ).rejects.toThrow("Unexpected token i in JSON at position 1");

    await expect(
      confyglot.load("/yaml", {
        fs: fs as SomePromiseBasedFs,
      })
    ).rejects.toThrow(
      /^unexpected end of the stream within a flow collection \(2:1\)/
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
});
