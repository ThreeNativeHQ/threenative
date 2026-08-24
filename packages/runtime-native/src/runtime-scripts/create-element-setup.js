document.createElement = (tagName) => {
  if (tagName === "canvas") {
    return {
      tagName: "CANVAS",
      width: 64,
      height: 64,
      style: {},
      toDataURL: (mimeType) => __nativeCanvasToDataURL(mimeType || "image/png"),
      getContext: (type) => null,
    };
  }
  if (tagName === "script") {
    return {
      tagName: "SCRIPT",
      src: "",
      type: "",
      async: false,
      onload: null,
      onerror: null,
    };
  }
  if (tagName === "style") {
    return {
      tagName: "STYLE",
      type: "text/css",
      textContent: "",
    };
  }
  if (tagName === "div" || tagName === "span" || tagName === "img") {
    return {
      tagName: (tagName || "").toUpperCase(),
      style: {},
      className: "",
      id: "",
    };
  }
  return { tagName: (tagName || "").toUpperCase(), style: {} };
};
document.createElementNS = (_namespace, tagName) => document.createElement(tagName);
