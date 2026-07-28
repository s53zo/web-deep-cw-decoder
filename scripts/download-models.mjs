import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const modelDirectory = path.join(repositoryRoot, "public", "models");
const engineRevision = "8e264d243bbd4467bd19f3f28292219405b47e0e";

const assets = [
  {
    name: "English model",
    url: `https://raw.githubusercontent.com/e04/deepcw-engine/${engineRevision}/model.onnx`,
    destination: path.join(modelDirectory, "model_en.onnx"),
    sha256: "ef120799457bca042d4690944f0faf93268eb4654e7f50f28784ad63bdc1fe02",
  },
  {
    name: "English model metadata",
    url: `https://raw.githubusercontent.com/e04/deepcw-engine/${engineRevision}/model.onnx.json`,
    destination: path.join(modelDirectory, "model_en.onnx.json"),
    sha256: "b4342157b90229ee7380e165f3d8036179b80d1e6ae02f2557388b7fcd558c01",
  },
];

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

async function hasExpectedHash(asset) {
  try {
    return sha256(await readFile(asset.destination)) === asset.sha256;
  } catch {
    return false;
  }
}

async function downloadAsset(asset) {
  if (await hasExpectedHash(asset)) {
    console.log(`${asset.name} is ready.`);
    return;
  }

  console.log(`Downloading ${asset.name}...`);
  const response = await fetch(asset.url);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${asset.name}: ${response.status} ${response.statusText}`,
    );
  }

  const data = Buffer.from(await response.arrayBuffer());
  const actualHash = sha256(data);
  if (actualHash !== asset.sha256) {
    throw new Error(
      `${asset.name} checksum mismatch: expected ${asset.sha256}, got ${actualHash}`,
    );
  }

  const temporaryPath = `${asset.destination}.tmp`;
  await writeFile(temporaryPath, data);
  try {
    await rename(temporaryPath, asset.destination);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

await mkdir(modelDirectory, { recursive: true });
for (const asset of assets) {
  await downloadAsset(asset);
}
