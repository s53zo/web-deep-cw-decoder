import { useSyncExternalStore } from "react";
import {
  getAudioContextActivationState,
  resumeRegisteredAudioContexts,
  subscribeToAudioContextActivation,
} from "../utils/audioContextActivation";

export function useAudioContextActivation() {
  const state = useSyncExternalStore(
    subscribeToAudioContextActivation,
    getAudioContextActivationState,
    getAudioContextActivationState,
  );

  return {
    state,
    resume: resumeRegisteredAudioContexts,
  };
}
