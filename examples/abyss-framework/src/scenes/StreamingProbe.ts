import { type ICtx, Scene, type SceneFrame, addInSlices, loadAll } from "@threenative/core";
import {
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type PerspectiveCamera,
} from "three";

/**
 * The two load-time mechanisms, driven by a real loop against a real event loop.
 *
 * The unit suite proves the shapes: slices, lanes, order, stop, fail-closed. It cannot prove the
 * two things that only exist at runtime and are the whole reason these live in the framework —
 * that the default yield actually hands the **host** the thread part-way through the attach, and
 * that the lanes actually **overlap in wall-clock time** rather than merely interleaving their
 * promises. Both are measured here and asserted by `playtests/streaming.playtest.json`.
 *
 * Nothing here decides how anything looks: the probe owns its own boxes and its own colours
 * exactly as any game would, and hands `addInSlices` a list and an `add`.
 */

/** Items loaded through `loadAll`. Twice the default concurrency, so the lanes recycle. */
const SPECIES = 12;
/**
 * How long one fake load takes. Serial, twelve of these is 720 ms; six lanes should land in
 * roughly two rounds. The scenario asserts a ceiling far under the serial floor, so a `loadAll`
 * that quietly stopped overlapping would fail rather than merely get slower.
 */
const LOAD_MS = 60;
/** Objects attached through `addInSlices`. Two full 256 slices and a partial third. */
const OBJECTS = 640;

const initialState = {
  attached: 0,
  streamingDone: false,
};

export type StreamingState = typeof initialState;
type StreamingCtx = ICtx<StreamingState>;

interface ISpecies {
  readonly index: number;
  readonly name: string;
}

/** A load whose duration is the reverse of its declaration order, so completion order differs. */
function fakeLoad(species: ISpecies): Promise<ISpecies> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(species), LOAD_MS + (SPECIES - species.index));
  });
}

export class StreamingProbe extends Scene<StreamingState> {
  static override readonly initialState = initialState;

  #frames = 0;
  #framesAtAttachStart = -1;
  #measure = {
    attachSlices: 0,
    attachSliceSize: 0,
    attached: 0,
    attachStopped: false,
    /** Reported, not asserted: see the comment at the attach for why it is not a floor. */
    framesDuringAttach: -1,
    hostRanDuringAttach: false,
    loadMs: -1,
    loadOrderCorrect: false,
    loadPeakInFlight: 0,
    loadedCount: 0,
    streamingDone: false,
  };

  override async load(): Promise<void> {
    const species = Array.from({ length: SPECIES }, (_unused, index) => ({
      index,
      name: `species-${String(index)}`,
    }));

    let inFlight = 0;
    let peak = 0;
    const startedAt = performance.now();
    const loaded = await loadAll(
      species,
      async (item) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        const result = await fakeLoad(item);
        inFlight -= 1;
        return result;
      },
      {
        onProgress: ({ settled }) => {
          this.#measure.loadedCount = settled;
        },
      },
    );
    this.#measure.loadMs = performance.now() - startedAt;
    this.#measure.loadPeakInFlight = peak;
    // The trap the framework exists to close: a pool that pushed its results would hand these
    // back in completion order, which the reversed durations above make the exact opposite.
    this.#measure.loadOrderCorrect = loaded.every((item, index) => item.index === index);
  }

  override enter(ctx: StreamingCtx): SceneFrame<StreamingState> {
    const camera = ctx.camera as PerspectiveCamera;
    camera.position.set(0, 0, 18);
    camera.lookAt(0, 0, 0);
    ctx.scene.background = new Color(0x0b1a2a);

    // The appearance is the probe's own, as any game's would be: one shared box, and a small
    // palette so the attached wall is not a single flat colour a capture cannot tell from a blank
    // frame. `addInSlices` sees none of this — it is handed a list and an `add`.
    const geometry = new BoxGeometry(0.6, 0.6, 0.6);
    const palette = Array.from(
      { length: 16 },
      (_unused, hue) => new MeshBasicMaterial({ color: new Color().setHSL(hue / 16, 0.7, 0.55) }),
    );
    const objects: Object3D[] = Array.from({ length: OBJECTS }, (_unused, index) => {
      const column = index % 32;
      const row = Math.floor(index / 32);
      const box = new Mesh(geometry, palette[(column + row) % palette.length]);
      box.position.set(column * 0.75 - 11.6, 7 - row * 0.75, 0);
      return box;
    });

    ctx.entities.add("streaming", { debug: () => ({ ...this.#measure }) });

    // Driven from an input, not from startup readiness, so the scenario watches the world go from
    // nothing attached to everything attached. Started at readiness the whole attach would be over
    // before the first observation, and every assertion below would be one the harness rightly
    // calls trivial. A game streaming a detail tier is in the same position either way: the list
    // is built, and something decides when it joins the graph.
    const beginAttach = async (): Promise<void> => {
      this.#framesAtAttachStart = this.#frames;
      // The runtime property a unit test cannot reach: did the **host** actually get the thread
      // back part-way through? This timer is queued before the first slice's own yield, so it can
      // only have run by the time the attach resolves if the attach gave the loop a turn. A
      // synchronous attach — `sliceSize` at or above the object count — leaves it false, which is
      // this assertion's negative control.
      //
      // Frames are counted too, but not asserted: 640 trivial boxes attach in about a millisecond
      // in a browser, and two macrotask turns inside one 16 ms frame present nothing. A floor on
      // presented frames here would be theatre that passes on timing luck.
      let hostRan = false;
      setTimeout(() => {
        hostRan = true;
      }, 0);
      const report = await addInSlices(objects, (object) => ctx.add(object), {
        onProgress: ({ added }) => {
          this.#measure.attached = added;
        },
      });
      this.#measure.attachSlices = report.slices;
      this.#measure.attachSliceSize = report.sliceSize;
      this.#measure.attached = report.added;
      this.#measure.attachStopped = report.stopped;
      this.#measure.framesDuringAttach = this.#frames - this.#framesAtAttachStart;
      this.#measure.hostRanDuringAttach = hostRan;
      this.#measure.streamingDone = true;
      ctx.state.set({ attached: report.added, streamingDone: true });
      ctx.state.flush();
    };

    let begun = false;
    return (frameCtx) => {
      this.#frames += 1;
      if (!begun && frameCtx.input.justPressed("start")) {
        begun = true;
        void beginAttach();
      }
      if (this.#measure.streamingDone && !frameCtx.state.getState().streamingDone) {
        frameCtx.state.set({ attached: this.#measure.attached, streamingDone: true });
      }
    };
  }
}
