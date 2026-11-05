import { describe, expect, it } from "vitest";
import { filterCourts } from "./CourtPicker.js";

const courts = ["Sąd Okręgowy w Krakowie", "Sąd Rejonowy dla Krakowa-Śródmieścia w Krakowie", "Sąd Rejonowy w Łodzi", "Sąd Apelacyjny w Łodzi", "Sąd Rejonowy w Żywcu"];

describe("wybór sądu: fragment nazwy zawęża listę", () => {
  it("zostają tylko sądy zawierające każdy wpisany fragment, bez polskich znaków i wielkości liter", () => {
    expect(filterCourts(courts, "rej krak")).toEqual(["Sąd Rejonowy dla Krakowa-Śródmieścia w Krakowie"]);
    expect(filterCourts(courts, "lodz")).toEqual(["Sąd Rejonowy w Łodzi", "Sąd Apelacyjny w Łodzi"]);
    expect(filterCourts(courts, "ŻYWC")).toEqual(["Sąd Rejonowy w Żywcu"]);
    expect(filterCourts(courts, "okręgowy")).toEqual(["Sąd Okręgowy w Krakowie"]);
    expect(filterCourts(courts, "warszaw")).toEqual([]);
    expect(filterCourts(courts, "")).toHaveLength(5);
  });
});
