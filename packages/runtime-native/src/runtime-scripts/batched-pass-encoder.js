// Batched render-pass encoding.
//
// The native host's per-call bridge cost owns part of the frame on Android (PRD-222 F8):
// every encoder method call is a JS-to-C++ crossing that pays argument marshalling and V8
// API machinery. The hot GPURenderPassEncoder methods instead append fixed-stride opcodes
// into a Float64Array here — plain JavaScript, no crossing — and the pass `end` binding
// replays the whole stream in one crossing. Anything this installer does not recognize
// stays on its original native binding, so behaviour is unchanged wherever the fast path
// does not apply.
//
// Ops are f64 slots; slot 0 holds the live length and ops run from slot 1. Resource ids
// arrive from wrapper fields (`_pipelineId`, `_bufferId`, `_bindGroupId`) and are resolved
// against the native registries at replay. A missing id or unexpected argument shape falls
// back to the original binding for that one call.
//
// State is strictly per pass: each install acquires its own buffer from a small ring, so
// concurrent passes (shadow pass + colour pass) record independently. The ring is sized
// for real scenes — Three.js keeps at most a handful of passes open; a ninth simultaneous
// open pass would reuse a live buffer and is not a supported shape.
//
// Installed per pass by the beginRenderPass binding:
//   installer(jsRenderPass) -> true when the hot methods were batched.
// The C++ side replaces `end` itself with the replay binding afterwards.
(passInstallerHost) => {
  const opSetPipeline = 1;
  const opSetBindGroup = 2;
  const opSetVertexBuffer = 3;
  const opSetIndexBuffer = 4;
  const opDraw = 5;
  const opDrawIndexed = 6;
  const opSetViewport = 7;
  const opSetScissorRect = 8;
  const opSetStencilReference = 9;
  const opSetBlendConstant = 10;

  const ringSize = 8;
  const initialSlots = 4096;
  const ring = [];
  let ringNext = 0;

  // Returns a non-negative numeric id or -1 when the argument carries none.
  function idOf(value, field) {
    if (value === null || value === undefined) return -1;
    const id = value[field];
    return typeof id === "number" && Number.isFinite(id) && id >= 0 ? id : -1;
  }

  function numberArg(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  return (pass) => {
    if (!pass || typeof pass !== "object") return false;
    // The replay binding is installed by the host under its own name before this installer
    // runs. It performs the native end-of-pass transitions whether or not any ops were
    // recorded, so `end` always routes through it with the live buffer.
    const replayEnd = pass.__tnReplayEnd;
    if (typeof replayEnd !== "function") return false;

    // Per-pass recording state. Slot 0 mirrors the live length; ops occupy [1, length).
    const slot = ring.length < ringSize ? ring.push(null) - 1 : ringNext++ % ringSize;
    let ops = ring[slot];
    if (!ops) {
      ops = new Float64Array(initialSlots);
      ring[slot] = ops;
    }
    let cursor = 1;
    ops[0] = 1;

    function ensure(extra) {
      if (cursor + extra <= ops.length) return true;
      let size = ops.length * 2;
      while (cursor + extra > size) size *= 2;
      const next = new Float64Array(size);
      next.set(ops.subarray(0, cursor));
      next[0] = cursor;
      ring[slot] = next;
      ops = next;
      return true;
    }

    const original = {
      setPipeline: pass.setPipeline,
      setBindGroup: pass.setBindGroup,
      setVertexBuffer: pass.setVertexBuffer,
      setIndexBuffer: pass.setIndexBuffer,
      draw: pass.draw,
      drawIndexed: pass.drawIndexed,
      setViewport: pass.setViewport,
      setScissorRect: pass.setScissorRect,
      setStencilReference: pass.setStencilReference,
      setBlendConstant: pass.setBlendConstant,
    };

    pass.setPipeline = function (pipeline) {
      const pipelineId = idOf(pipeline, "_pipelineId");
      if (pipelineId < 0) return original.setPipeline.call(this, pipeline);
      ensure(2);
      ops[cursor] = opSetPipeline;
      ops[cursor + 1] = pipelineId;
      ops[0] = cursor += 2;
    };

    pass.setBindGroup = function (index, bindGroup, dynamicOffsets) {
      const bindGroupId = idOf(bindGroup, "_bindGroupId");
      if (bindGroupId < 0) {
        return original.setBindGroup.call(this, index, bindGroup, dynamicOffsets);
      }
      const groupIndex = numberArg(index, 0);
      if (dynamicOffsets === undefined || dynamicOffsets === null) {
        ensure(4);
        ops[cursor] = opSetBindGroup;
        ops[cursor + 1] = groupIndex;
        ops[cursor + 2] = bindGroupId;
        ops[cursor + 3] = 0;
        ops[0] = cursor += 4;
        return;
      }
      // Variable-length tail: count follows the fixed slots, offsets after it.
      if (typeof dynamicOffsets.length !== "number") {
        return original.setBindGroup.call(this, index, bindGroup, dynamicOffsets);
      }
      const count = dynamicOffsets.length;
      ensure(4 + count);
      ops[cursor] = opSetBindGroup;
      ops[cursor + 1] = groupIndex;
      ops[cursor + 2] = bindGroupId;
      ops[cursor + 3] = count;
      for (let i = 0; i < count; i++) {
        ops[cursor + 4 + i] = numberArg(dynamicOffsets[i], 0);
      }
      ops[0] = cursor += 4 + count;
    };

    pass.setVertexBuffer = function (slot_, buffer, offset, size) {
      const bufferId = idOf(buffer, "_bufferId");
      if (bufferId < 0) return original.setVertexBuffer.call(this, slot_, buffer, offset, size);
      ensure(5);
      ops[cursor] = opSetVertexBuffer;
      ops[cursor + 1] = numberArg(slot_, 0);
      ops[cursor + 2] = bufferId;
      ops[cursor + 3] = numberArg(offset, 0);
      // Negative size encodes WGPU_WHOLE_SIZE at replay.
      ops[cursor + 4] = size === undefined || size === null ? -1 : numberArg(size, -1);
      ops[0] = cursor += 5;
    };

    pass.setIndexBuffer = function (buffer, format, offset, size) {
      const bufferId = idOf(buffer, "_bufferId");
      if (bufferId < 0) return original.setIndexBuffer.call(this, buffer, format, offset, size);
      let formatCode;
      if (format === "uint16") formatCode = 0;
      else if (format === "uint32") formatCode = 1;
      else if (format === "sint16") formatCode = 2;
      else if (format === "sint32") formatCode = 3;
      else return original.setIndexBuffer.call(this, buffer, format, offset, size);
      ensure(5);
      ops[cursor] = opSetIndexBuffer;
      ops[cursor + 1] = formatCode;
      ops[cursor + 2] = bufferId;
      ops[cursor + 3] = numberArg(offset, 0);
      ops[cursor + 4] = size === undefined || size === null ? -1 : numberArg(size, -1);
      ops[0] = cursor += 5;
    };

    pass.draw = (vertexCount, instanceCount, firstVertex, firstInstance) => {
      ensure(6);
      ops[cursor] = opDraw;
      ops[cursor + 1] = numberArg(vertexCount, 0);
      ops[cursor + 2] = instanceCount === undefined ? 1 : numberArg(instanceCount, 1);
      ops[cursor + 3] = numberArg(firstVertex, 0);
      ops[cursor + 4] = numberArg(firstInstance, 0);
      ops[0] = cursor += 6;
    };

    pass.drawIndexed = (
      indexCount,
      instanceCount,
      firstIndex,
      baseVertex,
      firstInstance,
    ) => {
      ensure(7);
      ops[cursor] = opDrawIndexed;
      ops[cursor + 1] = numberArg(indexCount, 0);
      ops[cursor + 2] = instanceCount === undefined ? 1 : numberArg(instanceCount, 1);
      ops[cursor + 3] = numberArg(firstIndex, 0);
      ops[cursor + 4] = baseVertex === undefined ? 0 : numberArg(baseVertex, 0);
      ops[cursor + 5] = numberArg(firstInstance, 0);
      ops[0] = cursor += 7;
    };

    pass.setViewport = (x, y, width, height, minDepth, maxDepth) => {
      ensure(8);
      ops[cursor] = opSetViewport;
      ops[cursor + 1] = numberArg(x, 0);
      ops[cursor + 2] = numberArg(y, 0);
      ops[cursor + 3] = numberArg(width, 0);
      ops[cursor + 4] = numberArg(height, 0);
      ops[cursor + 5] = numberArg(minDepth, 0);
      ops[cursor + 6] = numberArg(maxDepth, 1);
      ops[0] = cursor += 8;
    };

    pass.setScissorRect = (x, y, width, height) => {
      ensure(6);
      ops[cursor] = opSetScissorRect;
      ops[cursor + 1] = numberArg(x, 0);
      ops[cursor + 2] = numberArg(y, 0);
      ops[cursor + 3] = numberArg(width, 0);
      ops[cursor + 4] = numberArg(height, 0);
      ops[0] = cursor += 6;
    };

    pass.setStencilReference = (reference) => {
      ensure(3);
      ops[cursor] = opSetStencilReference;
      ops[cursor + 1] = numberArg(reference, 0);
      ops[0] = cursor += 3;
    };

    pass.setBlendConstant = (color) => {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      if (color !== null && color !== undefined) {
        r = numberArg(color.r, 0);
        g = numberArg(color.g, 0);
        b = numberArg(color.b, 0);
        a = numberArg(color.a, 0);
      }
      ensure(6);
      ops[cursor] = opSetBlendConstant;
      ops[cursor + 1] = r;
      ops[cursor + 2] = g;
      ops[cursor + 3] = b;
      ops[cursor + 4] = a;
      ops[0] = cursor += 6;
    };

    pass.end = () => {
      // The replay binding reads the length header from the buffer, replays ops
      // [1, length) against the captured encoder, and performs the native end-of-pass
      // state transitions. This buffer belongs to this pass alone and is never reused.
      return replayEnd(ops);
    };

    return true;
  };
};
