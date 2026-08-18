import { describe, it, expect, vi, beforeEach } from "vitest";
import { listTemplates, findTemplate, openDailyNote, localDateStamp } from "../templates";

const tree = {
  name: "vault",
  path: "",
  kind: "folder" as const,
  children: [
    {
      name: "Templates",
      path: "Templates",
      kind: "folder" as const,
      children: [
        { name: "meeting.md", path: "Templates/meeting.md", kind: "file" as const, children: [] },
        { name: "Daily.md", path: "Templates/Daily.md", kind: "file" as const, children: [] },
        { name: "notes.txt", path: "Templates/notes.txt", kind: "file" as const, children: [] },
        {
          name: "sub",
          path: "Templates/sub",
          kind: "folder" as const,
          children: [
            { name: "deep.md", path: "Templates/sub/deep.md", kind: "file" as const, children: [] },
          ],
        },
      ],
    },
    { name: "a.md", path: "a.md", kind: "file" as const, children: [] },
  ],
};

vi.mock("../ipc", () => ({
  buildTree: vi.fn(),
  createFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(""),
  writeFileAtomic: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../openNote", () => ({ openNote: vi.fn().mockResolvedValue(true) }));

import { buildTree, createFile, readFile, writeFileAtomic } from "../ipc";
import { openNote } from "../openNote";

beforeEach(() => {
  vi.clearAllMocks();
  (buildTree as any).mockResolvedValue(tree);
});

describe("listTemplates", () => {
  it("collects .md files under the template folder at any depth", async () => {
    const list = await listTemplates("/vault", "Templates");
    expect(list.map((t) => t.path).sort()).toEqual([
      "Templates/Daily.md",
      "Templates/meeting.md",
      "Templates/sub/deep.md",
    ]);
  });

  it("returns [] for a missing folder or empty template folder setting", async () => {
    expect(await listTemplates("/vault", "Nope")).toEqual([]);
    expect(await listTemplates("/vault", "")).toEqual([]);
  });
});

describe("findTemplate", () => {
  it("matches case-insensitively with or without .md", async () => {
    expect((await findTemplate("/vault", "Templates", ["daily"]))?.path).toBe(
      "Templates/Daily.md",
    );
    expect((await findTemplate("/vault", "Templates", ["DAILY.md"]))?.path).toBe(
      "Templates/Daily.md",
    );
    expect(await findTemplate("/vault", "Templates", ["missing"])).toBeNull();
  });
});

describe("localDateStamp", () => {
  it("formats YYYY-MM-DD from the local date", () => {
    const stamp = localDateStamp();
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("openDailyNote", () => {
  it("creates today's note and opens it", async () => {
    await openDailyNote("/vault");
    expect(createFile).toHaveBeenCalledWith("/vault", expect.stringMatching(/^\d{4}-\d{2}-\d{2}\.md$/));
    expect(openNote).toHaveBeenCalledWith("/vault", expect.stringMatching(/^\d{4}-\d{2}-\d{2}\.md$/));
  });

  it("initializes a fresh note from the Daily template", async () => {
    (readFile as any)
      .mockResolvedValueOnce("") // existing note body: empty
      .mockResolvedValueOnce("# Meeting\n"); // template content
    await openDailyNote("/vault");
    expect(writeFileAtomic).toHaveBeenCalledWith("/vault", expect.any(String), "# Meeting\n");
  });

  it("skips template init when the note already has content", async () => {
    (readFile as any).mockResolvedValueOnce("existing body");
    await openDailyNote("/vault");
    expect(writeFileAtomic).not.toHaveBeenCalled();
  });
});
