import { DirectionalClipmap } from '../core/DirectionalClipmap.js';
import { PhysicalPagePool, makePageKey, parsePageKey } from '../core/PhysicalPagePool.js';
import { ReceiverDemandPass } from '../core/ReceiverDemandPass.js';
import { ShadowInvalidationTracker } from '../core/ShadowInvalidationTracker.js';

const MAX_CLIP_LEVELS = 4;

function plainVector(vector) {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function plainBounds(box) {
  return {
    min: plainVector(box.min),
    max: plainVector(box.max),
  };
}

function createDefaultStats(options) {
  return {
    frame: 0,
    requested: 0,
    resident: 0,
    rendered: 0,
    cached: 0,
    invalidated: 0,
    evicted: 0,
    overflow: 0,
    reuseRatio: 0,
    dirtyResident: 0,
    pageSize: options.pageSize,
    atlasPagesPerAxis: options.atlasPagesPerAxis,
    atlasTextureSize: options.pageSize * options.atlasPagesPerAxis,
    virtualPagesPerAxis: options.virtualPagesPerAxis,
    clipLevels: options.clipExtents.length,
    virtualAddressPages: options.virtualPagesPerAxis
      * options.virtualPagesPerAxis
      * options.clipExtents.length,
    physicalCapacity: options.atlasPagesPerAxis * options.atlasPagesPerAxis,
  };
}

function debugModeNumber(mode) {
  if (typeof mode === 'number') return Math.max(0, Math.min(3, Math.round(mode)));
  return ({ normal: 0, pages: 1, shadow: 2, residency: 3 })[mode] ?? 0;
}

export class VirtualShadowMap {
  constructor(THREE, renderer, scene, {
    camera,
    lightDirection = new THREE.Vector3(0.55, 1, 0.35).normalize(),
    pageSize = 128,
    virtualPagesPerAxis = 8,
    atlasPagesPerAxis = 12,
    clipExtents = [18, 42, 90, 180],
    selectionGuard = 0.9,
    renderBudget = 24,
    receiverPlaneY = 0,
    demandColumns = 17,
    demandRows = 11,
    demandGuardBand = 1,
    lightDistance = 240,
    lightNear = 1,
    lightFar = 520,
    shadowBias = 0.0009,
    normalBias = 0.075,
    filterRadius = 1.2,
    shadowStrength = 0.86,
    sunColor = 0xfff1cf,
    skyColor = 0x7d9dc2,
    groundColor = 0x342f2b,
    ambientIntensity = 0.34,
    sunIntensity = 2.45,
    fogDensity = 0.0062,
    fogColor = 0x8b9eb0,
  } = {}) {
    if (!THREE || !renderer || !scene || !camera) {
      throw new TypeError('THREE, renderer, scene and camera are required');
    }
    if (renderer.capabilities && renderer.capabilities.isWebGL2 === false) {
      throw new Error('ThreeNative VirtualShadowMap requires a WebGL2 renderer');
    }
    if (!Number.isInteger(pageSize) || pageSize <= 0) {
      throw new TypeError('pageSize must be a positive integer');
    }
    if (!Number.isInteger(renderBudget) || renderBudget <= 0) {
      throw new TypeError('renderBudget must be a positive integer');
    }
    if (clipExtents.length > MAX_CLIP_LEVELS) {
      throw new RangeError(`at most ${MAX_CLIP_LEVELS} clip levels are supported`);
    }

    this.THREE = THREE;
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.options = {
      pageSize,
      virtualPagesPerAxis,
      atlasPagesPerAxis,
      clipExtents: [...clipExtents],
      selectionGuard,
      renderBudget,
      receiverPlaneY,
      lightDistance,
      lightNear,
      lightFar,
    };
    this.renderBudget = renderBudget;
    this.receiverPlaneY = receiverPlaneY;
    this.lightDistance = lightDistance;
    this.lightNear = lightNear;
    this.lightFar = lightFar;

    this.clipmap = new DirectionalClipmap({
      lightDirection: plainVector(lightDirection),
      clipExtents,
      pagesPerAxis: virtualPagesPerAxis,
      selectionGuard,
    });
    this.pool = new PhysicalPagePool({ pagesPerAxis: atlasPagesPerAxis });
    this.demandPass = new ReceiverDemandPass({
      columns: demandColumns,
      rows: demandRows,
      guardBand: demandGuardBand,
    });
    this.invalidationTracker = new ShadowInvalidationTracker(this.clipmap);

    const atlasTextureSize = pageSize * atlasPagesPerAxis;
    this.shadowAtlas = new THREE.WebGLRenderTarget(atlasTextureSize, atlasTextureSize, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.shadowAtlas.texture.name = 'ThreeNativeVirtualShadowPhysicalAtlas';
    this.shadowAtlas.texture.generateMipmaps = false;
    if ('colorSpace' in this.shadowAtlas.texture && THREE.NoColorSpace !== undefined) {
      this.shadowAtlas.texture.colorSpace = THREE.NoColorSpace;
    }

    this.pageTableWidth = virtualPagesPerAxis * virtualPagesPerAxis;
    this.pageTableData = new Uint8Array(this.pageTableWidth * clipExtents.length * 4);
    this.pageTableTexture = new THREE.DataTexture(
      this.pageTableData,
      this.pageTableWidth,
      clipExtents.length,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    this.pageTableTexture.name = 'ThreeNativeVirtualShadowPageTable';
    this.pageTableTexture.minFilter = THREE.NearestFilter;
    this.pageTableTexture.magFilter = THREE.NearestFilter;
    this.pageTableTexture.generateMipmaps = false;
    this.pageTableTexture.flipY = false;
    if ('colorSpace' in this.pageTableTexture && THREE.NoColorSpace !== undefined) {
      this.pageTableTexture.colorSpace = THREE.NoColorSpace;
    }
    this.pageTableTexture.needsUpdate = true;

    this.pageCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, lightNear, lightFar);
    this.pageCamera.name = 'ThreeNativeVirtualShadowPageCamera';
    this.depthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      side: THREE.FrontSide,
      blending: THREE.NoBlending,
    });
    this.depthMaterial.name = 'ThreeNativeVirtualShadowPackedDepth';

    this._basisU = new THREE.Vector3(
      this.clipmap.basisU.x,
      this.clipmap.basisU.y,
      this.clipmap.basisU.z,
    );
    this._basisV = new THREE.Vector3(
      this.clipmap.basisV.x,
      this.clipmap.basisV.y,
      this.clipmap.basisV.z,
    );
    this._basisW = new THREE.Vector3(
      this.clipmap.basisW.x,
      this.clipmap.basisW.y,
      this.clipmap.basisW.z,
    );

    this.sharedUniforms = {
      uShadowAtlas: { value: this.shadowAtlas.texture },
      uPageTable: { value: this.pageTableTexture },
      uLightBasisU: { value: this._basisU },
      uLightBasisV: { value: this._basisV },
      uLightBasisW: { value: this._basisW },
      uSunDirection: { value: this._basisW.clone() },
      uCameraWorldPosition: { value: camera.position.clone() },
      uCameraLightUV: { value: new THREE.Vector2() },
      uClipMinPage: {
        value: Array.from({ length: MAX_CLIP_LEVELS }, () => new THREE.Vector2()),
      },
      uPageWorldSize: { value: new Float32Array(MAX_CLIP_LEVELS) },
      uClipExtents: { value: new Float32Array(MAX_CLIP_LEVELS) },
      uClipCount: { value: clipExtents.length },
      uPagesPerAxis: { value: virtualPagesPerAxis },
      uAtlasPagesPerAxis: { value: atlasPagesPerAxis },
      uPageSize: { value: pageSize },
      uLightDistance: { value: lightDistance },
      uLightNear: { value: lightNear },
      uLightFar: { value: lightFar },
      uSelectionGuard: { value: selectionGuard },
      uShadowBias: { value: shadowBias },
      uNormalBias: { value: normalBias },
      uFilterRadius: { value: filterRadius },
      uShadowStrength: { value: shadowStrength },
      uDebugMode: { value: 0 },
      uSunColor: { value: new THREE.Color(sunColor) },
      uSkyColor: { value: new THREE.Color(skyColor) },
      uGroundColor: { value: new THREE.Color(groundColor) },
      uAmbientIntensity: { value: ambientIntensity },
      uSunIntensity: { value: sunIntensity },
      uFogDensity: { value: fogDensity },
      uFogColor: { value: new THREE.Color(fogColor) },
    };

    clipExtents.forEach((extent, level) => {
      this.sharedUniforms.uClipExtents.value[level] = extent;
      this.sharedUniforms.uPageWorldSize.value[level] = this.clipmap.pageWorldSize(level);
    });

    this._casters = new Map();
    this._visibleBounds = [];
    this._box = new THREE.Box3();
    this._projectionMatrix = new THREE.Matrix4();
    this._frustum = new THREE.Frustum();
    this._rayPoint = new THREE.Vector3();
    this._rayDirection = new THREE.Vector3();
    this._pageCenter = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
    this._stats = createDefaultStats(this.options);
    this._cumulative = {
      rendered: 0,
      cached: 0,
      invalidated: 0,
      evicted: 0,
      overflow: 0,
    };
    this._lastRequests = [];
    this._lastRenderedKeys = [];
    this._disposed = false;
  }

  trackCaster(object) {
    if (!object?.uuid) throw new TypeError('trackCaster expects a Three.js Object3D');
    this._casters.set(object.uuid, object);
    return object.uuid;
  }

  untrackCaster(objectOrId) {
    const id = typeof objectOrId === 'string' ? objectOrId : objectOrId?.uuid;
    if (!id) return false;
    this.invalidationTracker.remove(id);
    return this._casters.delete(id);
  }

  invalidateAll() {
    const count = this.pool.markAllDirty();
    this.invalidationTracker.invalidateAll();
    return count;
  }

  setDebugMode(mode) {
    this.sharedUniforms.uDebugMode.value = debugModeNumber(mode);
  }

  _sampleGroundPoints(columns, rows, planeY) {
    const points = [];
    this.camera.updateMatrixWorld(true);
    const origin = this.camera.position;

    for (let row = 0; row < rows; row += 1) {
      const ndcY = -0.92 + (row / Math.max(rows - 1, 1)) * 1.84;
      for (let column = 0; column < columns; column += 1) {
        const ndcX = -0.94 + (column / Math.max(columns - 1, 1)) * 1.88;
        this._rayPoint.set(ndcX, ndcY, 0.35).unproject(this.camera);
        this._rayDirection.copy(this._rayPoint).sub(origin).normalize();
        if (Math.abs(this._rayDirection.y) < 1e-5) continue;
        const distance = (planeY - origin.y) / this._rayDirection.y;
        if (distance <= 0) continue;
        points.push({
          x: origin.x + this._rayDirection.x * distance,
          y: planeY,
          z: origin.z + this._rayDirection.z * distance,
        });
      }
    }
    return points;
  }

  _updateTrackedBounds() {
    this.camera.updateMatrixWorld(true);
    this._projectionMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    this._frustum.setFromProjectionMatrix(this._projectionMatrix);
    this._visibleBounds.length = 0;

    for (const [id, object] of this._casters) {
      object.updateWorldMatrix(true, true);
      this._box.setFromObject(object, true);
      if (this._box.isEmpty()) continue;
      const bounds = plainBounds(this._box);
      this.invalidationTracker.update(id, bounds);
      if (this._frustum.intersectsBox(this._box)) {
        this._visibleBounds.push(bounds);
      }
    }
  }

  _configurePageCamera(request) {
    const page = this.clipmap.pageBounds(request.level, request.x, request.y);
    const half = page.pageWorldSize * 0.5;
    this.pageCamera.left = -half;
    this.pageCamera.right = half;
    this.pageCamera.top = half;
    this.pageCamera.bottom = -half;
    this.pageCamera.near = this.lightNear;
    this.pageCamera.far = this.lightFar;
    this.pageCamera.updateProjectionMatrix();

    this._pageCenter.set(
      page.centerWorld.x,
      page.centerWorld.y,
      page.centerWorld.z,
    );
    this.pageCamera.position.copy(this._pageCenter).addScaledVector(
      this._basisW,
      this.lightDistance,
    );
    this.pageCamera.up.copy(this._basisV);
    this._lookTarget.copy(this._pageCenter);
    this.pageCamera.lookAt(this._lookTarget);
    this.pageCamera.updateMatrixWorld(true);
  }

  _renderDirtyPages(requests) {
    const THREE = this.THREE;
    const renderer = this.renderer;
    const scene = this.scene;
    const pageSize = this.options.pageSize;
    const dirtyRequests = requests.filter((request) => this.pool.get(request.key)?.dirty);
    const renderQueue = dirtyRequests.slice(0, this.renderBudget);
    if (renderQueue.length === 0) {
      this._lastRenderedKeys = [];
      return 0;
    }

    const previousTarget = renderer.getRenderTarget();
    const previousViewport = renderer.getViewport(new THREE.Vector4());
    const previousScissor = renderer.getScissor(new THREE.Vector4());
    const previousScissorTest = renderer.getScissorTest();
    const previousClearColor = renderer.getClearColor(new THREE.Color()).clone();
    const previousClearAlpha = renderer.getClearAlpha();
    const previousAutoClear = renderer.autoClear;
    const previousOverrideMaterial = scene.overrideMaterial;
    const previousBackground = scene.background;
    const previousXrEnabled = renderer.xr?.enabled;

    renderer.setRenderTarget(this.shadowAtlas);
    renderer.autoClear = false;
    renderer.setScissorTest( true );
    renderer.setClearColor(0xffffff, 1);
    scene.overrideMaterial = this.depthMaterial;
    scene.background = null;
    if (renderer.xr) renderer.xr.enabled = false;

    this._lastRenderedKeys = [];
    try {
      for (const request of renderQueue) {
        const entry = this.pool.get(request.key);
        if (!entry) continue;
        const x = entry.slotX * pageSize;
        const y = entry.slotY * pageSize;
        renderer.setViewport(x, y, pageSize, pageSize);
        renderer.setScissor(x, y, pageSize, pageSize);
        renderer.clear(true, true, false);
        this._configurePageCamera(request);
        renderer.render(scene, this.pageCamera);
        entry.dirty = false;
        this._lastRenderedKeys.push(request.key);
      }
    } finally {
      scene.overrideMaterial = previousOverrideMaterial;
      scene.background = previousBackground;
      if (renderer.xr && previousXrEnabled !== undefined) {
        renderer.xr.enabled = previousXrEnabled;
      }
      renderer.autoClear = previousAutoClear;
      renderer.setRenderTarget(previousTarget);
      renderer.setViewport(previousViewport);
      renderer.setScissor(previousScissor);
      renderer.setScissorTest(previousScissorTest);
      renderer.setClearColor(previousClearColor, previousClearAlpha);
    }

    return this._lastRenderedKeys.length;
  }

  _rebuildPageTable() {
    this.pageTableData.fill(0);
    const pagesPerAxis = this.options.virtualPagesPerAxis;

    for (let level = 0; level < this.options.clipExtents.length; level += 1) {
      const window = this.clipmap.getWindow(level);
      this.sharedUniforms.uClipMinPage.value[level].set(window.minX, window.minY);
      this.sharedUniforms.uPageWorldSize.value[level] = window.pageWorldSize;

      for (let localY = 0; localY < pagesPerAxis; localY += 1) {
        for (let localX = 0; localX < pagesPerAxis; localX += 1) {
          const x = window.minX + localX;
          const y = window.minY + localY;
          const entry = this.pool.get(makePageKey(level, x, y));
          if (!entry || entry.dirty) continue;
          const tableIndex = localY * pagesPerAxis + localX;
          const offset = (level * this.pageTableWidth + tableIndex) * 4;
          this.pageTableData[offset] = entry.slotX;
          this.pageTableData[offset + 1] = entry.slotY;
          this.pageTableData[offset + 2] = 255;
          this.pageTableData[offset + 3] = Math.min(entry.generation, 255);
        }
      }
    }
    this.pageTableTexture.needsUpdate = true;
  }

  update(frame = 0) {
    if (this._disposed) throw new Error('VirtualShadowMap has been disposed');
    if (!Number.isInteger(frame)) throw new TypeError('frame must be an integer');

    this.camera.updateMatrixWorld(true);
    this.clipmap.updateCenter(plainVector(this.camera.position));
    this.sharedUniforms.uCameraWorldPosition.value.copy(this.camera.position);
    this.sharedUniforms.uCameraLightUV.value.set(
      this.clipmap.centerLight.u,
      this.clipmap.centerLight.v,
    );

    this._updateTrackedBounds();
    const invalidatedKeys = this.invalidationTracker.consumeInvalidatedKeys();
    let invalidated = 0;
    for (const key of invalidatedKeys) {
      if (this.pool.markDirty(key)) invalidated += 1;
    }

    const cameraAdapter = {
      position: plainVector(this.camera.position),
      sampleGroundPoints: (columns, rows, planeY) => (
        this._sampleGroundPoints(columns, rows, planeY)
      ),
    };
    const requests = this.demandPass.collect({
      camera: cameraAdapter,
      receiverPlaneY: this.receiverPlaneY,
      visibleBounds: this._visibleBounds,
      clipmap: this.clipmap,
    });
    this._lastRequests = requests;
    const protectedKeys = new Set(requests.map(({ key }) => key));

    for (const entry of this.pool.entries()) entry.pinned = false;
    const previousEvictions = this.pool.evictions;
    const previousOverflow = this.pool.overflow;
    let cached = 0;

    for (const request of requests) {
      const result = this.pool.allocate(request.key, {
        frame,
        pinned: request.pinned,
        protectedKeys,
      });
      if (result?.reused && !result.entry.dirty) cached += 1;
    }

    const rendered = this._renderDirtyPages(requests);
    this._rebuildPageTable();

    const evicted = this.pool.evictions - previousEvictions;
    const overflow = this.pool.overflow - previousOverflow;
    this._cumulative.rendered += rendered;
    this._cumulative.cached += cached;
    this._cumulative.invalidated += invalidated;
    this._cumulative.evicted += evicted;
    this._cumulative.overflow += overflow;

    this._stats = {
      ...createDefaultStats(this.options),
      frame,
      requested: requests.length,
      resident: this.pool.size,
      rendered,
      cached,
      invalidated,
      evicted,
      overflow,
      reuseRatio: requests.length > 0 ? cached / requests.length : 1,
      dirtyResident: this.pool.entries().filter(({ dirty }) => dirty).length,
      cumulative: { ...this._cumulative },
    };
    return this.getStats();
  }

  getStats() {
    return JSON.parse(JSON.stringify(this._stats));
  }

  getResidencySnapshot() {
    return this.pool.entries().map((entry) => ({
      ...entry,
      ...parsePageKey(entry.key),
    }));
  }

  getLastRequests() {
    return this._lastRequests.map((request) => ({ ...request }));
  }

  getLastRenderedKeys() {
    return [...this._lastRenderedKeys];
  }

  dispose() {
    if (this._disposed) return;
    this.shadowAtlas.dispose();
    this.pageTableTexture.dispose();
    this.depthMaterial.dispose();
    this._casters.clear();
    this.invalidationTracker.clear();
    this.pool.clear();
    this._disposed = true;
  }
}
