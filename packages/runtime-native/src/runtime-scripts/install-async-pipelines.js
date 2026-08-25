(device) => {
  const wrap = (syncName) =>
    function (descriptor) {
      try {
        return Promise.resolve(this[syncName](descriptor));
      } catch (error) {
        return Promise.reject(error);
      }
    };
  if (typeof device.createRenderPipeline === "function") {
    device.createRenderPipelineAsync = wrap("createRenderPipeline");
  }
  if (typeof device.createComputePipeline === "function") {
    device.createComputePipelineAsync = wrap("createComputePipeline");
  }
  return (
    typeof device.createRenderPipelineAsync === "function" &&
    typeof device.createComputePipelineAsync === "function"
  );
};
