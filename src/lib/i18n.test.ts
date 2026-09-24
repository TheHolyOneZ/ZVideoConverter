import { afterEach, expect, test } from "vitest";
import { LOCALES, setLocale, t } from "./i18n";

afterEach(() => setLocale("en"));

test("locales are discovered from the folder", () => {
  expect(LOCALES.map((l) => l.code)).toEqual(expect.arrayContaining(["en", "de"]));
  expect(LOCALES[0].code).toBe("en");
  expect(LOCALES.find((l) => l.code === "de")?.name).toBe("Deutsch");
});

test("interpolation and plurals", () => {
  expect(t("queue.summary", { count: 1, duration: "1:00", size: "1 MB" })).toBe("1 file · 1:00 · 1 MB");
  expect(t("queue.summary", { count: 3, duration: "1:00", size: "1 MB" })).toBe("3 files · 1:00 · 1 MB");
  setLocale("de");
  expect(t("queue.summary", { count: 3, duration: "1:00", size: "1 MB" })).toBe("3 Dateien · 1:00 · 1 MB");
});

test("unknown keys fall back to the key, unknown languages to English", () => {
  expect(t("does.not.exist")).toBe("does.not.exist");
  setLocale("xx");
  expect(t("queue.title")).toBe("Queue");
});
