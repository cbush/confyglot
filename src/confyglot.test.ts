import { createFsFromVolume, Volume } from "memfs";
import confyglot from "./";
import { SomePromiseBasedFs } from "./confyglot";

describe("confyglot", () => {
  const volume = Volume.fromJSON(
    {
      "/path/to/my/project/src/info.txt": "Hello, world!\n",
      "/path/to/my/project/.project.toml": `title = "Fan file"

[favoriteCaptain]
name = "Sisko"
dob = 2332-10-21T14:30:00-06:00
hobbies = [ "baseball", "cooking", "history" ]
`,
      "/path/to/my/.project.toml": `title = "Fan file"
favoriteEpisode = "House of Quark"

[favoriteCaptain]
name = "Picard"
dob = 2305-07-13T03:00:00+01:00
hobbies = [ "acting", "archaeology", "playing the flute" ]
`,
    },
    "/path/to/my/"
  );
  const fs = createFsFromVolume(volume).promises;

  it("cascades results", async () => {
    const result = await confyglot.load("/path/to/my/project/src", {
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
    const result1 = await confyglot.load("/path/to/my/project/src", {
      fs: fs as SomePromiseBasedFs,
      root: "/path/to/my/",
    });

    expect(result1["favoriteEpisode"]).toBeUndefined();

    const result2 = await confyglot.load("/path/to/my/project/src", {
      fs: fs as SomePromiseBasedFs,
      root: "/path/to/my", // Trailing slash should not matter
    });
    expect(result2["favoriteEpisode"]).toBeUndefined();
  });

  it("rejects unrelated root", async () => {
    await expect(
      confyglot.load("/path/to/my/project/src", {
        fs: fs as SomePromiseBasedFs,
        root: "/path/to/something/completely/different",
      })
    ).rejects.toThrow(
      "root '/path/to/something/completely/different' is not related to given directory /path/to/my/project/src"
    );
  });
});
