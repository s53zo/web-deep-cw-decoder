export type AudioContextActivationState = "idle" | "running" | "suspended";

const registeredContexts = new Set<AudioContext>();
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

function tryResume(context: AudioContext): void {
  if (context.state === "running" || context.state === "closed") return;
  void context
    .resume()
    .catch(() => undefined)
    .finally(notifyListeners);
}

export function registerAudioContext(context: AudioContext): () => void {
  const handleStateChange = () => notifyListeners();
  registeredContexts.add(context);
  context.addEventListener("statechange", handleStateChange);
  notifyListeners();
  tryResume(context);

  return () => {
    context.removeEventListener("statechange", handleStateChange);
    registeredContexts.delete(context);
    notifyListeners();
  };
}

export function resumeRegisteredAudioContexts(): void {
  registeredContexts.forEach(tryResume);
}

export function getAudioContextActivationState(): AudioContextActivationState {
  const activeContexts = Array.from(registeredContexts).filter(
    (context) => context.state !== "closed",
  );
  if (activeContexts.length === 0) return "idle";
  return activeContexts.every((context) => context.state === "running")
    ? "running"
    : "suspended";
}

export function subscribeToAudioContextActivation(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
