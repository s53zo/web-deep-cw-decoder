import {
  parseCwmPackage,
  sha256Hex,
  validateDeepCwRuntimeWasm,
  type CwmManifest,
  type CwmRole,
} from "./cwm";

export type PileupAssetRole = CwmRole | "runtime";

export type StoredPileupAsset = {
  role: PileupAssetRole;
  filename: string;
  bytes: ArrayBuffer;
  byteLength: number;
  sha256: string;
  manifest?: CwmManifest;
  savedAt: number;
};

export type PileupAssetSummary = Omit<StoredPileupAsset, "bytes">;

export type PileupAssetBundle = {
  detector: ArrayBuffer;
  decoder: ArrayBuffer;
  runtime: ArrayBuffer;
};

const DATABASE_NAME = "deepcw-private-pileup-assets";
const DATABASE_VERSION = 1;
const STORE_NAME = "assets";
const REQUIRED_ROLES: readonly PileupAssetRole[] = [
  "detector",
  "decoder",
  "runtime",
];
const changeListeners = new Set<() => void>();

function summarizeAsset(asset: StoredPileupAsset): PileupAssetSummary {
  return {
    role: asset.role,
    filename: asset.filename,
    byteLength: asset.byteLength,
    sha256: asset.sha256,
    manifest: asset.manifest,
    savedAt: asset.savedAt,
  };
}

function emitChange(): void {
  changeListeners.forEach((listener) => listener());
}

export function subscribeToPileupAssetChanges(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "role" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open the private model store."));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Private model storage failed."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Private model storage was aborted."));
    });
  } finally {
    database.close();
  }
}

async function classifyFile(file: File): Promise<StoredPileupAsset> {
  const bytes = await file.arrayBuffer();
  const savedAt = Date.now();
  if (file.name.toLowerCase().endsWith(".wasm")) {
    validateDeepCwRuntimeWasm(bytes);
    return {
      role: "runtime",
      filename: file.name,
      bytes,
      byteLength: bytes.byteLength,
      sha256: await sha256Hex(bytes),
      savedAt,
    };
  }

  const parsed = parseCwmPackage(bytes);
  return {
    role: parsed.role,
    filename: file.name,
    bytes,
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    manifest: parsed.manifest,
    savedAt,
  };
}

export async function savePileupAssets(
  files: readonly File[],
): Promise<PileupAssetSummary[]> {
  if (files.length !== REQUIRED_ROLES.length) {
    throw new Error(
      "Select exactly three local files: the detector CWM1 model, narrow decoder CWM1 model, and deepcw-core.wasm runtime.",
    );
  }

  const assets = await Promise.all(files.map(classifyFile));
  const byRole = new Map<PileupAssetRole, StoredPileupAsset>();
  for (const asset of assets) {
    if (byRole.has(asset.role)) {
      throw new Error(`More than one ${asset.role} file was selected.`);
    }
    byRole.set(asset.role, asset);
  }
  for (const role of REQUIRED_ROLES) {
    if (!byRole.has(role)) {
      throw new Error(`The selected files do not include the required ${role}.`);
    }
  }

  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.clear();
      assets.forEach((asset) => store.put(asset));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Failed to save private models."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Saving private models was aborted."));
    });
  } finally {
    database.close();
  }

  emitChange();
  return assets.map(summarizeAsset);
}

export async function listPileupAssets(): Promise<PileupAssetSummary[]> {
  const assets = await withStore<StoredPileupAsset[]>("readonly", (store) =>
    store.getAll(),
  );
  return assets.map(summarizeAsset);
}

export async function loadPileupAssetBundle(): Promise<PileupAssetBundle> {
  const assets = await withStore<StoredPileupAsset[]>("readonly", (store) =>
    store.getAll(),
  );
  const byRole = new Map(assets.map((asset) => [asset.role, asset]));
  for (const role of REQUIRED_ROLES) {
    if (!byRole.has(role)) {
      throw new Error("Load the three private Pileup files before starting.");
    }
  }

  return {
    detector: byRole.get("detector")!.bytes.slice(0),
    decoder: byRole.get("decoder")!.bytes.slice(0),
    runtime: byRole.get("runtime")!.bytes.slice(0),
  };
}

export async function forgetPileupAssets(): Promise<void> {
  await withStore("readwrite", (store) => store.clear());
  emitChange();
}
