import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "use-intl/core";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import docsEn from "@/messages/how-to-use.en.json";
import docsAr from "@/messages/how-to-use.ar.json";

/**
 * use-app-translations maps every English key to its numeric index and hands
 * use-intl the *indexed* messages, so en.json and ar.json must carry exactly
 * the same keys in exactly the same order — a key appended to only one file
 * silently shifts every translation after it. This guards that invariant.
 */
describe("message catalogs", () => {
  it("keeps en.json and ar.json key-aligned by index", () => {
    const enKeys = Object.keys(en);
    const arKeys = Object.keys(ar);
    expect(arKeys).toEqual(enKeys);
  });

  it("leaves no English value empty", () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value, key).not.toBe("");
    }
  });

  it("keeps the guide catalogs complete and key-aligned", () => {
    expect(Object.keys(docsAr)).toEqual(Object.keys(docsEn));
    for (const [key, value] of Object.entries(docsAr)) {
      expect(value, key).not.toBe("");
    }
  });
});

/**
 * An ICU syntax error would make the translator fall back to the numeric
 * message id (a bare number in the UI), so the contradiction messages are
 * formatted for real in both locales.
 */
describe("contradiction message formatting", () => {
  const keys = Object.keys(en);
  const keyIds = new Map(keys.map((key, index) => [key, String(index)]));
  const indexed = {
    en: Object.fromEntries(keys.map((key, index) => [String(index), en[key as keyof typeof en]])),
    ar: Object.fromEntries(keys.map((key, index) => [String(index), ar[key as keyof typeof en]])),
  };

  function format(locale: "en" | "ar", key: string, values?: Record<string, string | number>): string {
    const onError = vi.fn();
    const translator = createTranslator({
      locale: locale === "ar" ? "ar-u-nu-arab" : "en",
      messages: indexed[locale],
      onError,
      getMessageFallback: ({ key: k }) => `MISSING:${k}`,
    });
    const id = keyIds.get(key);
    if (id === undefined) throw new Error(`key not in catalog: ${key}`);
    const result = translator(id, values as never);
    expect(onError).not.toHaveBeenCalled();
    return result;
  }

  it("interpolates customer-count params", () => {
    expect(format("en", "{expected} customers are expected in 12 months, but the acquisition model projects {implied}.", { expected: 6, implied: 5 })).toContain("6 customers");
  });

  it("interpolates lifetime params in Arabic", () => {
    const result = format("ar", "Lifetime is entered as {entered} months, but {churn}% monthly churn implies {implied} months.", {
      entered: "48.0",
      churn: "8.0",
      implied: "12.5",
    });
    expect(result).toContain("48.0");
    expect(result).toContain("12.5");
  });

  it("formats the TAM message's ICU number placeholders in both locales", () => {
    const key = "Market sizing assumes {currency} {tam, number} per customer per year, while the expected blended revenue model implies approximately {currency} {model, number} per customer per year.";
    const en = format("en", key, { currency: "USD", tam: 6000, model: 600 });
    expect(en).toContain("USD");
    expect(en).not.toContain("{");
    const ar = format("ar", key, { currency: "USD", tam: 6000, model: 600 });
    expect(ar).not.toContain("{");
  });

  it("formats the payback message in both locales", () => {
    const key = "Payback takes {payback} months, but customers stay only {lifetime} months.";
    for (const locale of ["en", "ar"] as const) {
      expect(format(locale, key, { payback: "140.7", lifetime: "50.0" })).not.toContain("{");
    }
  });
});
