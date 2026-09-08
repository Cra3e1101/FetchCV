import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 500 } });
  await page.setContent('<body style="font:32px Microsoft YaHei;padding:40px">滴滴两轮车策略运营<br>面试问题：如何搭建指标体系？<br>SQL 数据分析</body>');
  await page.screenshot({ path: "artifacts/ocr-fixture.png" });
  const { stdout } = await promisify(execFile)("C:/Program Files/Tesseract-OCR/tesseract.exe", ["artifacts/ocr-fixture.png", "stdout", "-l", "chi_sim+eng", "--psm", "6"], { windowsHide: true });
  assert.match(stdout, /SQL/);
  assert.match(stdout.replace(/\s/g, ""), /指标体系/);
  console.log("PASS local Chinese/English OCR fixture; this is not a live post test");
} finally { await browser.close(); }
