import { useEffect, useRef } from 'react';
import {
  applyBeadInteraction,
  createSorobanModel,
  type BeadInteraction,
  type BeadInteractionIntent,
  type BeadModel,
  type BeadSection,
  type SorobanState
} from './soroban.js';
import type { NumberBoardState } from './numberBoardGame.js';
import { PlayCanvasSorobanRenderer, type BeadShapeStyle, type ThemeName } from './playcanvasSoroban.js';

type PlayCanvasBoardProps = Readonly<{
  state: SorobanState;
  numberBoard: NumberBoardState;
  theme: ThemeName;
  beadShape: BeadShapeStyle;
  onCommitState: (state: SorobanState) => void;
  onInteractionStart: () => void;
}>;

type ActivePointer = Readonly<{
  pointerId: number;
  startY: number;
  bead: BeadModel;
}>;

const dragThresholdPx = 8;
const dragSnapDistancePx = 72;

export function PlayCanvasBoard({
  state,
  numberBoard,
  theme,
  beadShape,
  onCommitState,
  onInteractionStart
}: PlayCanvasBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<PlayCanvasSorobanRenderer | null>(null);
  const stateRef = useRef(state);
  const numberBoardRef = useRef(numberBoard);
  const themeRef = useRef(theme);
  const beadShapeRef = useRef(beadShape);
  const onCommitStateRef = useRef(onCommitState);
  const onInteractionStartRef = useRef(onInteractionStart);
  const activePointerRef = useRef<ActivePointer | null>(null);
  const previousRenderRef = useRef<{
    state: SorobanState;
    numberBoard: NumberBoardState;
    theme: ThemeName;
    beadShape: BeadShapeStyle;
  } | null>(null);

  stateRef.current = state;
  numberBoardRef.current = numberBoard;
  themeRef.current = theme;
  beadShapeRef.current = beadShape;
  onCommitStateRef.current = onCommitState;
  onInteractionStartRef.current = onInteractionStart;

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const renderer = new PlayCanvasSorobanRenderer(canvas);
    rendererRef.current = renderer;

    const handleResize = () => {
      renderer.rebuild(stateRef.current, numberBoardRef.current);
      renderer.setBeadShape(beadShapeRef.current, stateRef.current);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const hit = renderer.hitTest(event.clientX, event.clientY);

      if (!hit) {
        return;
      }

      onInteractionStartRef.current();
      activePointerRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        bead: hit.bead
      };
      renderer.setGrabbedBead(hit.bead.id);
      canvas.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const activePointer = activePointerRef.current;

      if (!activePointer || activePointer.pointerId !== event.pointerId) {
        return;
      }

      const currentState = stateRef.current;
      const deltaY = event.clientY - activePointer.startY;

      if (Math.abs(deltaY) < dragThresholdPx) {
        renderer.previewBeads(currentState, currentState, [], 0);
        return;
      }

      const nextState = applyBeadInteraction(currentState, getInteraction(activePointer.bead, deltaY));
      const movingBeadIds = getMovingBeadIds(currentState, nextState);
      const progress = Math.min(1, Math.abs(deltaY) / dragSnapDistancePx);

      renderer.previewBeads(currentState, nextState, movingBeadIds, progress);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const activePointer = activePointerRef.current;

      if (!activePointer || activePointer.pointerId !== event.pointerId) {
        return;
      }

      const deltaY = event.clientY - activePointer.startY;
      onCommitStateRef.current(applyBeadInteraction(stateRef.current, getInteraction(activePointer.bead, deltaY)));
      renderer.setGrabbedBead(null);
      activePointerRef.current = null;
    };

    const handlePointerCancel = () => {
      renderer.update(stateRef.current);
      renderer.setGrabbedBead(null);
      activePointerRef.current = null;
    };

    window.addEventListener('resize', handleResize);
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerCancel);
      renderer.destroy();
      rendererRef.current = null;
      previousRenderRef.current = null;
    };
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;

    if (!renderer) {
      return;
    }

    const previousRender = previousRenderRef.current;

    if (!previousRender) {
      renderer.rebuild(state, numberBoard);
      renderer.setTheme(theme, state);
      renderer.setBeadShape(beadShape, state);
      previousRenderRef.current = { state, numberBoard, theme, beadShape };
      return;
    }

    const themeChanged = previousRender.theme !== theme;
    const styleChanged = !isSameBeadShape(previousRender.beadShape, beadShape);
    const columnsChanged = previousRender.state.config.columns !== state.config.columns;
    const numberBoardChanged = previousRender.numberBoard !== numberBoard;

    if (themeChanged) {
      renderer.setTheme(theme, state);
    }

    if (styleChanged) {
      renderer.setBeadShape(beadShape, state);
    }

    if (numberBoardChanged) {
      renderer.setNumberBoard(numberBoard);
    }

    if (!themeChanged && !styleChanged) {
      if (columnsChanged) {
        renderer.rebuild(state, numberBoard);
      } else {
        const changed = state.values.some((value, index) => value !== previousRender.state.values[index]);
        renderer.update(state, changed);
      }
    }

    previousRenderRef.current = { state, numberBoard, theme, beadShape };
  }, [state, numberBoard, theme, beadShape]);

  return (
    <canvas
      ref={canvasRef}
      id="soroban-canvas"
      className="soroban-canvas"
      aria-label="Interactive soroban"
    />
  );
}

function getInteraction(bead: BeadModel, deltaY: number): BeadInteraction {
  return {
    column: bead.column,
    section: bead.section,
    index: bead.index,
    intent: getIntentFromDrag(bead.section, deltaY)
  };
}

function getIntentFromDrag(section: BeadSection, deltaY: number): BeadInteractionIntent {
  if (Math.abs(deltaY) < dragThresholdPx) {
    return 'toggle';
  }

  if (section === 'upper') {
    return deltaY > 0 ? 'activate' : 'deactivate';
  }

  return deltaY < 0 ? 'activate' : 'deactivate';
}

function getMovingBeadIds(currentState: SorobanState, nextState: SorobanState): readonly string[] {
  const nextBeads = new Map(createSorobanModel(nextState).beads.map((bead) => [bead.id, bead]));

  return createSorobanModel(currentState).beads
    .filter((bead) => {
      const nextBead = nextBeads.get(bead.id);

      return nextBead ? nextBead.position.y !== bead.position.y : false;
    })
    .map((bead) => bead.id);
}

function isSameBeadShape(left: BeadShapeStyle, right: BeadShapeStyle): boolean {
  return left.tipRadius === right.tipRadius &&
    left.shoulderRadius === right.shoulderRadius &&
    left.waistRadius === right.waistRadius;
}
