// Packed production WebGPU frame recorder. The host reads exactly one ArrayBuffer per frame.
(host) => {
  if (!host || !host.device || !host.queue) return null;
  const device = host.device;
  const queue = host.queue;
  const magic = 0x544e4652;
  const version = 1;
  let storage = new ArrayBuffer(1 << 20);
  let view = new DataView(storage);
  let cursor = 16;
  let opCount = 0;
  let nextId = 1;
  let retained = [];
  const ensure = (n) => {
    if (cursor + n <= storage.byteLength) return;
    let size = storage.byteLength * 2;
    while (cursor + n > size) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(new Uint8Array(storage, 0, cursor));
    storage = next;
    view = new DataView(storage);
  };
  const u32 = (v) => {
    ensure(4);
    view.setUint32(cursor, v >>> 0, true);
    cursor += 4;
  };
  const f64 = (v) => {
    ensure(8);
    view.setFloat64(cursor, Number(v), true);
    cursor += 8;
  };
  const raw = (v) => {
    ensure(v.byteLength + 7);
    new Uint8Array(storage, cursor, v.byteLength).set(v);
    cursor += v.byteLength;
    while (cursor & 7) view.setUint8(cursor++, 0);
  };
  const emit = (code, write) => {
    const start = cursor;
    const retainedStart = retained.length;
    ensure(8);
    u32(code);
    u32(0);
    try {
      write();
    } catch (error) {
      cursor = start;
      retained.length = retainedStart;
      throw error;
    }
    while (cursor & 7) {
      ensure(1);
      view.setUint8(cursor++, 0);
    }
    view.setUint32(start + 4, cursor - start, true);
    opCount++;
  };
  const resourceId = (v, n, label) => {
    if (!Number.isSafeInteger(n) || n <= 0)
      throw new TypeError(`frame op stream: ${label} has no numeric id`);
    retained.push(v);
    return n;
  };
  const bufferId = (v) => resourceId(v, v?._bufferId, "buffer");
  const textureId = (v) => resourceId(v, v?._textureId, "texture");
  const textureViewId = (v) => resourceId(v, v?._textureViewId, "texture view");
  const pipelineId = (v, label = "pipeline") => resourceId(v, v?._pipelineId, label);
  const bindGroupId = (v) => resourceId(v, v?._bindGroupId, "bind group");
  const renderBundleId = (v) => resourceId(v, v?._renderBundleId, "render bundle");
  const commandBufferId = (v) => resourceId(v, v?.__tnCommandBufferId, "command buffer");
  const opt = (v, fallback) => (v === undefined ? fallback : v);
  const offsets = (v) => {
    const n = v == null ? 0 : v.length;
    u32(n);
    for (let i = 0; i < n; i++) u32(v[i]);
  };
  const extent = (v) => {
    if (Array.isArray(v)) {
      u32(v[0]);
      u32(opt(v[1], 1));
      u32(opt(v[2], 1));
    } else {
      u32(v.width);
      u32(opt(v.height, 1));
      u32(opt(v.depthOrArrayLayers, 1));
    }
  };
  const textureCopy = (c) => {
    u32(textureId(c.texture));
    u32(opt(c.mipLevel, 0));
    const o = opt(c.origin, {});
    if (Array.isArray(o)) {
      u32(o[0]);
      u32(opt(o[1], 0));
      u32(opt(o[2], 0));
    } else {
      u32(opt(o.x, 0));
      u32(opt(o.y, 0));
      u32(opt(o.z, 0));
    }
    u32(c.aspect === "depth-only" ? 1 : c.aspect === "stencil-only" ? 2 : 0);
  };
  const upload = (data, dataOffset, size) => {
    const buffer = data instanceof ArrayBuffer ? data : data.buffer;
    const base = data instanceof ArrayBuffer ? 0 : data.byteOffset;
    const length = data instanceof ArrayBuffer ? data.byteLength : data.byteLength;
    const unit = typeof data.BYTES_PER_ELEMENT === "number" ? data.BYTES_PER_ELEMENT : 1;
    const start = opt(dataOffset, 0) * unit;
    const bytes = size === undefined ? length - start : size * unit;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(bytes) ||
      start < 0 ||
      bytes < 0 ||
      start + bytes > length
    )
      throw new RangeError("frame op stream: upload range exceeds source view");
    return new Uint8Array(buffer, base + start, bytes);
  };
  const renderPass = (encoderId, descriptor) => {
    const passId = nextId++;
    emit(3, () => {
      u32(encoderId);
      u32(passId);
      const colors = descriptor.colorAttachments || [];
      u32(colors.length);
      for (const c of colors) {
        if (!c) throw new TypeError("frame op stream: null color attachment unsupported");
        u32(textureViewId(c.view));
        u32(c.resolveTarget ? textureViewId(c.resolveTarget) : 0);
        u32(c.loadOp === "load" ? 1 : 0);
        u32(c.storeOp === "discard" ? 1 : 0);
        const x = opt(c.clearValue, {});
        if (Array.isArray(x)) {
          f64(x[0]);
          f64(x[1]);
          f64(x[2]);
          f64(x[3]);
        } else {
          f64(opt(x.r, 0));
          f64(opt(x.g, 0));
          f64(opt(x.b, 0));
          f64(opt(x.a, 0));
        }
      }
      const d = descriptor.depthStencilAttachment;
      u32(d ? 1 : 0);
      if (d) {
        u32(textureViewId(d.view));
        f64(opt(d.depthClearValue, 1));
        u32(d.depthLoadOp === "load" ? 1 : 0);
        u32(d.depthStoreOp === "discard" ? 1 : 0);
        u32(opt(d.depthReadOnly, false));
        u32(opt(d.stencilClearValue, 0));
        u32(d.stencilLoadOp === "load" ? 1 : d.stencilLoadOp === "clear" ? 0 : 2);
        u32(d.stencilStoreOp === "store" ? 0 : d.stencilStoreOp === "discard" ? 1 : 2);
        u32(opt(d.stencilReadOnly, false));
      }
    });
    return {
      setPipeline: (p) =>
        emit(4, () => {
          u32(passId);
          u32(pipelineId(p, "render pipeline"));
        }),
      setBindGroup: (i, g, o) =>
        emit(5, () => {
          u32(passId);
          u32(i);
          u32(bindGroupId(g));
          offsets(o);
        }),
      setVertexBuffer: (s, b, o, z) =>
        emit(6, () => {
          u32(passId);
          u32(s);
          u32(bufferId(b));
          f64(opt(o, 0));
          f64(opt(z, -1));
        }),
      setIndexBuffer: (b, f, o, z) =>
        emit(7, () => {
          u32(passId);
          u32(bufferId(b));
          u32(f === "uint32");
          f64(opt(o, 0));
          f64(opt(z, -1));
        }),
      draw: (a, b, c, d) =>
        emit(8, () => {
          u32(passId);
          u32(a);
          u32(opt(b, 1));
          u32(opt(c, 0));
          u32(opt(d, 0));
        }),
      drawIndexed: (a, b, c, d, e) =>
        emit(9, () => {
          u32(passId);
          u32(a);
          u32(opt(b, 1));
          u32(opt(c, 0));
          u32(opt(d, 0));
          u32(opt(e, 0));
        }),
      drawIndirect: (b, o) =>
        emit(10, () => {
          u32(passId);
          u32(bufferId(b));
          f64(o);
        }),
      drawIndexedIndirect: (b, o) =>
        emit(11, () => {
          u32(passId);
          u32(bufferId(b));
          f64(o);
        }),
      setViewport: (...a) =>
        emit(12, () => {
          u32(passId);
          for (const v of a) f64(v);
        }),
      setScissorRect: (...a) =>
        emit(13, () => {
          u32(passId);
          for (const v of a) u32(v);
        }),
      setBlendConstant: (c) =>
        emit(14, () => {
          u32(passId);
          if (Array.isArray(c) || ArrayBuffer.isView(c)) {
            f64(c[0]);
            f64(c[1]);
            f64(c[2]);
            f64(c[3]);
          } else {
            f64(c.r);
            f64(c.g);
            f64(c.b);
            f64(c.a);
          }
        }),
      setStencilReference: (r) =>
        emit(15, () => {
          u32(passId);
          u32(r);
        }),
      executeBundles: (a) =>
        emit(16, () => {
          u32(passId);
          u32(a.length);
          for (const b of a) u32(renderBundleId(b));
        }),
      end: () => emit(17, () => u32(passId)),
    };
  };
  const computePass = (encoderId) => {
    const passId = nextId++;
    emit(18, () => {
      u32(encoderId);
      u32(passId);
    });
    return {
      setPipeline: (p) =>
        emit(19, () => {
          u32(passId);
          u32(pipelineId(p, "compute pipeline"));
        }),
      setBindGroup: (i, g, o) =>
        emit(20, () => {
          u32(passId);
          u32(i);
          u32(bindGroupId(g));
          offsets(o);
        }),
      dispatchWorkgroups: (x, y, z) =>
        emit(21, () => {
          u32(passId);
          u32(x);
          u32(opt(y, 1));
          u32(opt(z, 1));
        }),
      end: () => emit(22, () => u32(passId)),
    };
  };
  const encoderIdKey = Symbol("frameOpEncoderId");
  const commandEncoderPrototype = {
      beginRenderPass(d) {
        return renderPass(this[encoderIdKey], d);
      },
      beginComputePass() {
        return computePass(this[encoderIdKey]);
      },
      copyBufferToBuffer(s, so, d, do_, z) {
        emit(23, () => {
          u32(this[encoderIdKey]);
          u32(bufferId(s));
          f64(so);
          u32(bufferId(d));
          f64(do_);
          f64(z);
        });
      },
      copyBufferToTexture(s, d, z) {
        emit(24, () => {
          u32(this[encoderIdKey]);
          u32(bufferId(s.buffer));
          f64(opt(s.offset, 0));
          u32(opt(s.bytesPerRow, 0));
          u32(opt(s.rowsPerImage, 0));
          textureCopy(d);
          extent(z);
        });
      },
      copyTextureToBuffer(s, d, z) {
        emit(25, () => {
          u32(this[encoderIdKey]);
          textureCopy(s);
          u32(bufferId(d.buffer));
          f64(opt(d.offset, 0));
          u32(opt(d.bytesPerRow, 0));
          u32(opt(d.rowsPerImage, 0));
          extent(z);
        });
      },
      copyTextureToTexture(s, d, z) {
        emit(26, () => {
          u32(this[encoderIdKey]);
          textureCopy(s);
          textureCopy(d);
          extent(z);
        });
      },
      clearBuffer(b, o, z) {
        emit(27, () => {
          u32(this[encoderIdKey]);
          u32(bufferId(b));
          f64(opt(o, 0));
          f64(opt(z, -1));
        });
      },
      finish() {
        const commandId = nextId++;
        emit(28, () => {
          u32(this[encoderIdKey]);
          u32(commandId);
        });
        return { __tnCommandBufferId: commandId };
      },
  };
  device.createCommandEncoder = () => {
    const encoderId = nextId++;
    emit(2, () => u32(encoderId));
    const encoder = Object.create(commandEncoderPrototype);
    encoder[encoderIdKey] = encoderId;
    return encoder;
  };
  const wrapDestroy = (resource, readId, opcode) => {
    if (!resource || typeof resource.destroy !== "function") return resource;
    let destroyed = false;
    resource.destroy = () => {
      if (destroyed) return;
      const id = readId(resource);
      emit(opcode, () => u32(id));
      destroyed = true;
    };
    return resource;
  };
  const createBuffer = device.createBuffer.bind(device);
  const createTexture = device.createTexture.bind(device);
  device.createBuffer = (descriptor) =>
    wrapDestroy(createBuffer(descriptor), bufferId, 32);
  device.createTexture = (descriptor) =>
    wrapDestroy(createTexture(descriptor), textureId, 33);
  queue.writeBuffer = (b, o, d, do_, z) => {
    if (!Number.isSafeInteger(o) || o < 0 || o & 3)
      throw new RangeError(
        "frame op stream: writeBuffer offset must be a non-negative multiple of 4",
      );
    const copy = upload(d, do_, z);
    if (copy.byteLength & 3)
      throw new RangeError("frame op stream: writeBuffer size must be a multiple of 4");
    emit(1, () => {
      u32(bufferId(b));
      f64(o);
      u32(copy.byteLength);
      raw(copy);
    });
  };
  queue.writeTexture = (d, data, l, z) => {
    const copy = upload(data, 0);
    emit(30, () => {
      textureCopy(d);
      f64(opt(l.offset, 0));
      u32(opt(l.bytesPerRow, 0));
      u32(opt(l.rowsPerImage, 0));
      extent(z);
      u32(copy.byteLength);
      raw(copy);
    });
  };
  queue.copyExternalImageToTexture = (s, d, z) => {
    const image = s?.source;
    const rgba = image && (image.data || image._data);
    if (!rgba) throw new TypeError("frame op stream: external image has no eager-copy RGBA data");
    const copy = upload(rgba, 0);
    const o = opt(s.origin, {});
    const ox = Array.isArray(o) ? opt(o[0], 0) : opt(o.x, 0);
    const oy = Array.isArray(o) ? opt(o[1], 0) : opt(o.y, 0);
    emit(31, () => {
      u32(image.width);
      u32(image.height);
      u32(ox);
      u32(oy);
      u32(s.flipY ? 1 : 0);
      textureCopy(d);
      extent(z);
      u32(copy.byteLength);
      raw(copy);
    });
  };
  queue.submit = (a) =>
    emit(29, () => {
      u32(a.length);
      for (const b of a) u32(commandBufferId(b));
    });
  return () => {
    if (!opCount) return null;
    view.setUint32(0, magic, true);
    view.setUint32(4, version, true);
    view.setUint32(8, cursor, true);
    view.setUint32(12, opCount, true);
    const frame = storage;
    cursor = 16;
    opCount = 0;
    retained = [];
    return frame;
  };
};
