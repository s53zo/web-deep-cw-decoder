import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

const projectRoot = resolve(new URL("..", import.meta.url).pathname);
const distRoot = join(projectRoot, "dist");
const privateRoot = join(projectRoot, ".local-private", "pileup-models");
const forbiddenName =
  /(?:^|[-_.])(deepcw-core|detect-cw-model|detect_cw_model|model-en-narrow|model_en_narrow|pileup)(?:[-_.]|$)/i;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function optionalFiles(directory) {
  try {
    return await walk(directory);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

const privateFiles = await optionalFiles(privateRoot);
const privateSignatures = [];
for (const file of privateFiles) {
  const data = await readFile(file);
  privateSignatures.push({
    data,
    hash: sha256(data),
    base64: data.toString("base64"),
  });
}

const violations = [];
for (const file of await walk(distRoot)) {
  const name = basename(file);
  const data = await readFile(file);
  const path = relative(projectRoot, file);
  if (name.endsWith(".cwm") || name.endsWith(".cwm.json") || forbiddenName.test(name)) {
    violations.push(`${path}: forbidden private-asset filename`);
  }
  if (data.length >= 4 && data.subarray(0, 4).toString("ascii") === "CWM1") {
    violations.push(`${path}: contains a CWM1 package`);
  }
  for (const signature of privateSignatures) {
    if (data.includes(signature.data)) {
      violations.push(`${path}: contains private local asset bytes`);
      break;
    }
    if (data.includes(signature.base64)) {
      violations.push(`${path}: contains a base64-encoded private local asset`);
      break;
    }
    if (data.includes(signature.hash)) {
      violations.push(`${path}: contains a private local asset hash`);
      break;
    }
  }
  if (data.includes(privateRoot)) {
    violations.push(`${path}: contains the private local asset path`);
  }
}

if (violations.length > 0) {
  throw new Error(`Private Pileup assets entered dist:\n${violations.join("\n")}`);
}

console.log("Private Pileup assets are absent from dist.");
