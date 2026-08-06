import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PILEUP_WINDOW_S } from "./const";
import type { So2rPileupChannelState } from "./hooks/useSo2rPileupChannel";
import {
  SampleTimelineClock,
  characterFrameToX,
  confidenceOpacity,
  clamp01,
  frequencyToWaterfallY,
  laneBackground,
  placePileupLanes,
  PILEUP_PROBABILITY_TRANSITION_MS,
  PILEUP_PROBABILITY_THRESHOLDS,
  probabilityBinFrequency,
  probabilityMarkerX,
  probabilityTransitionEase,
  startAnimationLoop,
  waterfallScrollOffsetPx,
} from "./pileup/visualization";

type PileupWaterfallVisualizationProps = {
  decoder: So2rPileupChannelState;
  minFrequencyHz: number;
  maxFrequencyHz: number;
};

const ROW_HEIGHT_PX = 24;
const PROBABILITY_WIDTH_PX = 34;

export function PileupWaterfallVisualization({
  decoder,
  minFrequencyHz,
  maxFrequencyHz,
}: PileupWaterfallVisualizationProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const probabilityCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rowRefs = useRef(new Map<number, HTMLDivElement>());
  const lanesRef = useRef(decoder.lanes);
  const probabilityTargetRef = useRef(decoder.probabilityFrame);
  const probabilityCurrentRef = useRef<Float32Array | null>(null);
  const probabilitySourceRef = useRef<Float32Array | null>(null);
  const probabilityRenderedTargetRef = useRef(decoder.probabilityFrame);
  const probabilityTransitionStartedAtRef = useRef(0);
  const probabilityMetadataRef = useRef<{
    firstFrequencyHz: number;
    binWidthHz: number;
  } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  lanesRef.current = decoder.lanes;
  probabilityTargetRef.current = decoder.probabilityFrame;
  const getTimelineSample = decoder.getTimelineSample;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () =>
      setSize({ width: root.clientWidth, height: root.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const placements = useMemo(
    () =>
      placePileupLanes(
        decoder.lanes,
        minFrequencyHz,
        maxFrequencyHz,
        size.height,
        ROW_HEIGHT_PX,
        decoder.maxLanes,
      ),
    [
      decoder.lanes,
      decoder.maxLanes,
      maxFrequencyHz,
      minFrequencyHz,
      size.height,
    ],
  );
  const placementById = useMemo(
    () => new Map(placements.map((placement) => [placement.id, placement])),
    [placements],
  );

  useEffect(() => {
    const clock = new SampleTimelineClock();
    const rowElements = rowRefs.current;
    const stop = startAnimationLoop((nowMs) => {
      clock.observe(getTimelineSample(), nowMs);
      const currentSample = clock.at(nowMs);
      lanesRef.current.forEach((lane) => {
        const row = rowRefs.current.get(lane.id);
        if (!row) return;
        const offset = waterfallScrollOffsetPx(
          currentSample,
          lane.windowEndSample,
          PILEUP_WINDOW_S,
          size.width,
        );
        row.style.transform = `translate3d(${-offset}px, 0, 0)`;
      });

      const canvas = probabilityCanvasRef.current;
      const target = probabilityTargetRef.current;
      if (!canvas) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      const canvasSizeChanged =
        canvas.width !== pixelWidth || canvas.height !== pixelHeight;
      if (canvasSizeChanged) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      const targetChanged = probabilityRenderedTargetRef.current !== target;
      const metadataChanged = Boolean(
        target &&
          (probabilityMetadataRef.current?.firstFrequencyHz !==
            target.firstFrequencyHz ||
            probabilityMetadataRef.current?.binWidthHz !== target.binWidthHz ||
            probabilityCurrentRef.current?.length !== target.probabilities.length),
      );
      if (targetChanged) {
        probabilityRenderedTargetRef.current = target;
        if (!target) {
          probabilityCurrentRef.current = null;
          probabilitySourceRef.current = null;
          probabilityMetadataRef.current = null;
          probabilityTransitionStartedAtRef.current =
            nowMs - PILEUP_PROBABILITY_TRANSITION_MS;
        } else if (!probabilityCurrentRef.current || metadataChanged) {
          probabilityCurrentRef.current = target.probabilities.slice();
          probabilitySourceRef.current = target.probabilities.slice();
          probabilityMetadataRef.current = {
            firstFrequencyHz: target.firstFrequencyHz,
            binWidthHz: target.binWidthHz,
          };
          probabilityTransitionStartedAtRef.current =
            nowMs - PILEUP_PROBABILITY_TRANSITION_MS;
        } else {
          probabilitySourceRef.current = probabilityCurrentRef.current.slice();
          probabilityTransitionStartedAtRef.current = nowMs;
        }
      }
      const transitionProgress = Math.min(
        1,
        Math.max(
          0,
          (nowMs - probabilityTransitionStartedAtRef.current) /
            PILEUP_PROBABILITY_TRANSITION_MS,
        ),
      );
      if (!targetChanged && !canvasSizeChanged && transitionProgress >= 1) {
        return;
      }
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "rgba(16, 17, 19, 0.72)";
      context.fillRect(0, 0, width, height);

      if (target) {
        if (
          !probabilityCurrentRef.current ||
          probabilityCurrentRef.current.length !== target.probabilities.length ||
          probabilityMetadataRef.current?.firstFrequencyHz !==
            target.firstFrequencyHz ||
          probabilityMetadataRef.current?.binWidthHz !== target.binWidthHz
        ) {
          probabilityCurrentRef.current = target.probabilities.slice();
          probabilityMetadataRef.current = {
            firstFrequencyHz: target.firstFrequencyHz,
            binWidthHz: target.binWidthHz,
          };
          probabilitySourceRef.current = target.probabilities.slice();
        }
        const current = probabilityCurrentRef.current;
        const source = probabilitySourceRef.current ?? current;
        const transitionEase = probabilityTransitionEase(transitionProgress);
        for (let index = 0; index < current.length; index += 1) {
          const targetProbability = clamp01(target.probabilities[index]!);
          current[index] =
            clamp01(source[index]!) * (1 - transitionEase) +
            targetProbability * transitionEase;
          const frequency = probabilityBinFrequency(
            target.firstFrequencyHz,
            target.binWidthHz,
            index,
          );
          const nextFrequency = frequency + target.binWidthHz;
          const y1 = frequencyToWaterfallY(
            frequency,
            minFrequencyHz,
            maxFrequencyHz,
            height,
          );
          const y2 = frequencyToWaterfallY(
            nextFrequency,
            minFrequencyHz,
            maxFrequencyHz,
            height,
          );
          const top = Math.min(y1, y2);
          const binHeight = Math.max(1, Math.abs(y2 - y1));
          context.fillStyle = "rgba(239, 196, 64, 0.82)";
          context.fillRect(0, top, clamp01(current[index]!) * width, binHeight);
        }
      } else {
        probabilityCurrentRef.current = null;
        probabilitySourceRef.current = null;
        probabilityMetadataRef.current = null;
      }

      context.lineWidth = 1;
      context.setLineDash([2, 2]);
      PILEUP_PROBABILITY_THRESHOLDS.forEach((threshold, index) => {
        const x = probabilityMarkerX(threshold, width);
        context.strokeStyle =
          index === 0 ? "rgba(116, 174, 235, 0.9)" : "rgba(87, 217, 112, 0.95)";
        context.beginPath();
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, height);
        context.stroke();
      });
      context.setLineDash([]);
    });

    return () => {
      stop();
      clock.reset();
      rowElements.forEach((row) => {
        row.style.transform = "translate3d(0, 0, 0)";
      });
      probabilityCurrentRef.current = null;
      probabilitySourceRef.current = null;
      probabilityRenderedTargetRef.current = null;
      probabilityMetadataRef.current = null;
      probabilityTransitionStartedAtRef.current = 0;
    };
  }, [getTimelineSample, maxFrequencyHz, minFrequencyHz, size.width]);

  return (
    <div
      ref={rootRef}
      data-pileup-overlay
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: 2,
      }}
    >
      {decoder.lanes.map((lane) => {
        const placement = placementById.get(lane.id);
        if (!placement) return null;
        return (
          <div key={lane.id} data-pileup-lane={lane.id}>
            {Math.abs(placement.signalY - placement.rowY) > 2 && (
              <div
                style={{
                  position: "absolute",
                  left: 2,
                  top: Math.min(placement.signalY, placement.rowY),
                  width: 1,
                  height: Math.abs(placement.signalY - placement.rowY),
                  background: "rgba(225, 230, 237, 0.45)",
                  transition: "top 140ms ease-out, height 140ms ease-out",
                }}
              />
            )}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: placement.rowY - ROW_HEIGHT_PX / 2,
                height: ROW_HEIGHT_PX,
                background: laneBackground(lane.status),
                borderTop: "1px solid rgba(255,255,255,0.08)",
                borderBottom: "1px solid rgba(0,0,0,0.28)",
                transition: "top 140ms ease-out, background 140ms ease-out",
              }}
            />
            <div
              ref={(element) => {
                if (element) rowRefs.current.set(lane.id, element);
                else rowRefs.current.delete(lane.id);
              }}
              style={{
                position: "absolute",
                left: 0,
                top: placement.rowY - ROW_HEIGHT_PX / 2,
                width: "100%",
                height: ROW_HEIGHT_PX,
                willChange: "transform",
                transition: "top 140ms ease-out",
              }}
            >
              {lane.characterSpans.map((span, index) => {
                if (!span.char.trim()) return null;
                const left = characterFrameToX(
                  span.startFrame,
                  span.endFrame,
                  lane.frameCount,
                  size.width,
                );
                return (
                  <span
                    key={`${span.startFrame}:${span.endFrame}:${index}`}
                    style={{
                      position: "absolute",
                      left,
                      top: 0,
                      color: "white",
                      opacity: confidenceOpacity(span.confidence),
                      fontFamily: "Roboto Mono, monospace",
                      fontSize: 18,
                      fontWeight: 800,
                      lineHeight: `${ROW_HEIGHT_PX}px`,
                      transform: "translateX(-50%)",
                      WebkitTextStroke: "2px rgba(0, 0, 0, 0.9)",
                      paintOrder: "stroke fill",
                      textShadow: "0 1px 2px black",
                    }}
                  >
                    {span.char}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
      <canvas
        ref={probabilityCanvasRef}
        aria-label="Current detector probability; blue marker is presence and green marker is lock"
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          width: PROBABILITY_WIDTH_PX,
          height: "100%",
          borderLeft: "1px solid rgba(255,255,255,0.18)",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          right: 0,
          top: 1,
          width: PROBABILITY_WIDTH_PX,
          height: 10,
          fontFamily: "Roboto Mono, monospace",
          fontSize: 8,
          fontWeight: 800,
          lineHeight: "10px",
        }}
      >
        <span
          style={{
            position: "absolute",
            left: `${PILEUP_PROBABILITY_THRESHOLDS[0] * 100}%`,
            color: "rgb(116, 174, 235)",
          }}
        >
          P
        </span>
        <span
          style={{
            position: "absolute",
            left: `${PILEUP_PROBABILITY_THRESHOLDS[1] * 100}%`,
            color: "rgb(87, 217, 112)",
          }}
        >
          L
        </span>
      </div>
    </div>
  );
}
