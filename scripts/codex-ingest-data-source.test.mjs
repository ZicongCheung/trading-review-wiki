import { describe, expect, it } from "vitest"

import { runDataSource } from "./codex-ingest/data-source/index.mjs"

function tushareResponse(fields = ["ts_code", "trade_date"], rows = [["000001.SZ", "20240603"]]) {
  return { code: 0, msg: null, data: { fields, items: rows } }
}

describe("data-source tushare probe", () => {
  it("summarizes Tushare endpoint coverage without leaking the token or raw rows", async () => {
    const calls = []
    const result = await runDataSource({
      action: "tushare-probe",
      stockCode: "SZ300901",
      tradeDate: "2026-06-04",
      tushareToken: "fake-tushare-test-token",
      tushareClient: async ({ apiName, token, params }) => {
        calls.push({ apiName, token, params })
        if (apiName === "daily") {
          return tushareResponse(
            ["ts_code", "trade_date", "open", "close", "pct_chg", "vol", "amount"],
            [["300901.SZ", "20260604", 10.2, 10.8, 5.88, 1234, 5678]],
          )
        }
        return tushareResponse(["field_a", "field_b"], [[1, 2], [3, 4]])
      },
    })

    expect(result).toMatchObject({
      schema: "external-tushare-probe-v1",
      provider: "tushare",
      status: "ok",
      query: { stockCode: "300901.SZ", tradeDate: "20260604" },
      credentialStatus: { configured: true, auth: "env_or_option" },
      coverage: { total: 10, ok: 10, failed: 0, skipped: 0 },
      writePolicy: { wroteFiles: false, wroteSecrets: false, returnedRows: false },
    })
    expect(calls.map((call) => call.apiName)).toEqual([
      "stock_basic",
      "daily",
      "daily_basic",
      "limit_list_d",
      "limit_step",
      "top_list",
      "top_inst",
      "hm_detail",
      "ths_hot",
      "dc_hot",
    ])
    expect(calls[1].params).toMatchObject({ ts_code: "300901.SZ", start_date: "20260604", end_date: "20260604" })
    expect(result.endpoints.find((endpoint) => endpoint.api === "daily")).toMatchObject({ rowCount: 1, fieldCount: 7 })
    expect(result.endpoints.filter((endpoint) => endpoint.api !== "daily").every((endpoint) => endpoint.rowCount === 2 && endpoint.fieldCount === 2)).toBe(true)
    expect(result.entryPriceSuggestion).toMatchObject({
      schema: "external-tushare-entry-price-suggestion-v1",
      provider: "tushare",
      source: "tushare:daily",
      ref: "tushare:daily#300901.SZ/20260604",
      stockCode: "300901.SZ",
      tradeDate: "20260604",
      asOfDate: "2026-06-04",
      priceType: "close",
      price: 10.8,
      close: 10.8,
      open: 10.2,
      pctChg: 5.88,
      amount: 5678,
      rowCount: 1,
      rawRowsReturned: false,
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("fake-tushare-test-token")
    expect(serialized).not.toContain("[1,2]")
    expect(serialized).not.toContain("[\"300901.SZ\",\"20260604\",10.2,10.8")
  })

  it("returns an unavailable probe when the token is missing", async () => {
    const result = await runDataSource({
      action: "tushare-probe",
      tushareToken: "",
    })

    expect(result).toMatchObject({
      schema: "external-tushare-probe-v1",
      provider: "tushare",
      status: "unavailable",
      credentialStatus: { configured: false, auth: "missing" },
      writePolicy: { wroteFiles: false, wroteSecrets: false, returnedRows: false },
    })
    expect(result.coverage).toBeUndefined()
    expect(result.endpoints).toHaveLength(10)
    expect(result.endpoints.every((endpoint) => endpoint.status === "skipped")).toBe(true)
  })
})
