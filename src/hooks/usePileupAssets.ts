import { useCallback, useEffect, useMemo, useState } from "react";
import {
  forgetPileupAssets,
  listPileupAssets,
  savePileupAssets,
  subscribeToPileupAssetChanges,
  type PileupAssetSummary,
} from "../pileup/assets";

export function usePileupAssets() {
  const [assets, setAssets] = useState<PileupAssetSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setAssets(await listPileupAssets());
      setError(null);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to inspect local Pileup files.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeToPileupAssetChanges(() => void refresh());
  }, [refresh]);

  const loadFiles = useCallback(async (files: readonly File[]) => {
    setIsLoading(true);
    setError(null);
    try {
      await savePileupAssets(files);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to load local Pileup files.",
      );
      throw nextError;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const forget = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await forgetPileupAssets();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to forget local Pileup files.",
      );
      throw nextError;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const roles = new Set(assets.map((asset) => asset.role));
  const ready =
    roles.has("detector") && roles.has("decoder") && roles.has("runtime");
  const signature = useMemo(
    () =>
      assets
        .map((asset) => `${asset.role}:${asset.sha256}`)
        .sort()
        .join("|"),
    [assets],
  );

  return {
    assets,
    ready,
    signature,
    isLoading,
    error,
    loadFiles,
    forget,
  };
}
