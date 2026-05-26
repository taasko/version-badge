#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const ROOT = path.resolve(__dirname, "..");
const VERSIONS_FILE = path.join(ROOT, "src", "versions.ts");

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }

        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Invalid JSON from ${url}: ${error.message}`));
          }
        });
      })
      .on("error", reject);
  });
}

function cycleForVersion(version) {
  return version.replace(/\.x$/, "");
}

function isDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const original = fs.readFileSync(VERSIONS_FILE, "utf8");
  const blockRegex = /^\s{2}([a-z0-9-]+): \[(.*?)^\s{2}],/gms;

  const products = [];
  let match;
  while ((match = blockRegex.exec(original)) !== null) {
    products.push({
      name: match[1],
      start: match.index,
      end: blockRegex.lastIndex,
      block: match[0],
      inner: match[2],
    });
  }

  if (products.length === 0) {
    throw new Error("No product blocks found in versions.ts");
  }

  const apiByProduct = {};
  for (const product of products) {
    const url = `https://endoflife.date/api/${product.name}.json`;
    try {
      const items = await fetchJson(url);
      if (!Array.isArray(items)) {
        continue;
      }
      const cycleMap = new Map();
      for (const item of items) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const cycle = String(item.cycle || "").trim();
        const eol = item.eol;
        if (!cycle || !isDateString(String(eol))) {
          continue;
        }
        cycleMap.set(cycle, String(eol));
      }
      apiByProduct[product.name] = cycleMap;
    } catch (error) {
      console.warn(`Skipping ${product.name}: ${error.message}`);
    }
  }

  let updated = original;
  const changes = [];

  // Edit from the end of the file to keep indices stable while slicing.
  for (let i = products.length - 1; i >= 0; i -= 1) {
    const product = products[i];
    const cycleMap = apiByProduct[product.name];
    if (!cycleMap || cycleMap.size === 0) {
      continue;
    }

    const lineRegex = /\{ version: "([^"]+)", eol: "(\d{4}-\d{2}-\d{2})" }/g;
    let hasChange = false;
    const updatedBlock = product.block.replace(
      lineRegex,
      (line, version, currentDate) => {
        const cycle = cycleForVersion(version);
        const apiDate = cycleMap.get(cycle);
        if (!apiDate || apiDate === currentDate) {
          return line;
        }

        hasChange = true;
        changes.push({
          product: product.name,
          version,
          from: currentDate,
          to: apiDate,
        });
        return `{ version: "${version}", eol: "${apiDate}" }`;
      },
    );

    if (!hasChange) {
      continue;
    }

    updated = `${updated.slice(0, product.start)}${updatedBlock}${updated.slice(product.end)}`;
  }

  if (changes.length === 0) {
    console.log("No updates found.");
    return;
  }

  changes
    .toSorted((a, b) =>
      `${a.product}:${a.version}`.localeCompare(`${b.product}:${b.version}`),
    )
    .forEach((change) => {
      console.log(
        `${change.product} ${change.version}: ${change.from} -> ${change.to}`,
      );
    });

  if (dryRun) {
    console.log("Dry run only. No file changes written.");
    return;
  }

  fs.writeFileSync(VERSIONS_FILE, updated);
  console.log(`Updated ${VERSIONS_FILE}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
