import { expect, test } from "vitest";
import { formatBytes, formatDuration, parseTimestamp, formatTimestamp, splitExt, resolutionLabel } from "./format";

test("durations", () => {
  expect(formatDuration(65)).toBe("1:05");
  expect(formatDuration(3725.4)).toBe("1:02:05");
  expect(formatDuration(null)).toBe("–");
});

test("timestamps round-trip", () => {
  expect(parseTimestamp("83.5")).toBe(83.5);
  expect(parseTimestamp("1:23.5")).toBe(83.5);
  expect(parseTimestamp("0:01:23,5")).toBe(83.5);
  expect(parseTimestamp("1::2")).toBeNull();
  expect(parseTimestamp("abc")).toBeNull();
  expect(parseTimestamp(formatTimestamp(83.5)!)).toBe(83.5);
});

test("only the last dot is the extension", () => {
  expect(splitExt("Show.S01E01.[1080p].x264.mkv")).toEqual(["Show.S01E01.[1080p].x264", "mkv"]);
  expect(splitExt(".hidden")).toEqual([".hidden", ""]);
  expect(splitExt("noext")).toEqual(["noext", ""]);
});

test("bytes and resolutions", () => {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(1536)).toBe("1.50 KB");
  expect(resolutionLabel(3840, 2160)).toBe("4K");
  expect(resolutionLabel(1080, 1920)).toBe("1080p");
});
