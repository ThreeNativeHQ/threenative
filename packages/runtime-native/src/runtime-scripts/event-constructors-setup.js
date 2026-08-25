(() => {
  class Event {
    constructor(...args) {
      if (args.length === 0) {
        throw new TypeError("Event constructor requires a type");
      }
      const [type, init] = args;
      const eventInit = init || {};
      this.type = String(type);
      this.bubbles = Boolean(eventInit.bubbles);
      this.cancelable = Boolean(eventInit.cancelable);
      this.composed = Boolean(eventInit.composed);
      this.defaultPrevented = false;
      this.target = null;
      this.currentTarget = null;
      this.eventPhase = 0;
      this.isTrusted = false;
      this.cancelBubble = false;
      this._immediatePropagationStopped = false;
    }

    preventDefault() {
      if (this.cancelable) this.defaultPrevented = true;
    }

    stopPropagation() {
      this.cancelBubble = true;
    }

    stopImmediatePropagation() {
      this.cancelBubble = true;
      this._immediatePropagationStopped = true;
    }
  }

  class PointerEvent extends Event {
    constructor(type, init) {
      const eventInit = init || {};
      super(type, eventInit);
      this.pointerId = Number(eventInit.pointerId || 0);
      this.pointerType = String(eventInit.pointerType || "");
      this.isPrimary = Boolean(eventInit.isPrimary);
      this.clientX = Number(eventInit.clientX || 0);
      this.clientY = Number(eventInit.clientY || 0);
      this.screenX = Number(eventInit.screenX || 0);
      this.screenY = Number(eventInit.screenY || 0);
      this.pageX = Number(eventInit.pageX || 0);
      this.pageY = Number(eventInit.pageY || 0);
      this.offsetX = Number(eventInit.offsetX || 0);
      this.offsetY = Number(eventInit.offsetY || 0);
      this.movementX = Number(eventInit.movementX || 0);
      this.movementY = Number(eventInit.movementY || 0);
      this.button = Number(eventInit.button || 0);
      this.buttons = Number(eventInit.buttons || 0);
      this.pressure = Number(eventInit.pressure || 0);
      this.width = Number(eventInit.width || 1);
      this.height = Number(eventInit.height || 1);
      this.ctrlKey = Boolean(eventInit.ctrlKey);
      this.shiftKey = Boolean(eventInit.shiftKey);
      this.altKey = Boolean(eventInit.altKey);
      this.metaKey = Boolean(eventInit.metaKey);
    }
  }

  class TouchEvent extends Event {
    constructor(type, init) {
      const eventInit = init || {};
      super(type, eventInit);
      this.touches = eventInit.touches || [];
      this.targetTouches = eventInit.targetTouches || [];
      this.changedTouches = eventInit.changedTouches || [];
      this.ctrlKey = Boolean(eventInit.ctrlKey);
      this.shiftKey = Boolean(eventInit.shiftKey);
      this.altKey = Boolean(eventInit.altKey);
      this.metaKey = Boolean(eventInit.metaKey);
    }
  }

  class KeyboardEvent extends Event {
    constructor(type, init) {
      const eventInit = init || {};
      super(type, eventInit);
      this.key = String(eventInit.key || "");
      this.code = String(eventInit.code || "");
      this.location = Number(eventInit.location || 0);
      this.repeat = Boolean(eventInit.repeat);
      this.isComposing = Boolean(eventInit.isComposing);
      this.keyCode = Number(eventInit.keyCode || 0);
      this.charCode = Number(eventInit.charCode || 0);
      this.which = Number(eventInit.which || 0);
      this.ctrlKey = Boolean(eventInit.ctrlKey);
      this.shiftKey = Boolean(eventInit.shiftKey);
      this.altKey = Boolean(eventInit.altKey);
      this.metaKey = Boolean(eventInit.metaKey);
    }
  }

  // The Worker polyfill's failed-load path constructs an ErrorEvent
  // (url-worker-polyfill.js); without this global that path throws
  // ReferenceError instead of delivering worker.onerror to the game.
  class ErrorEvent extends Event {
    constructor(type, init) {
      const eventInit = init || {};
      super(type, eventInit);
      this.message = String(eventInit.message || "");
      this.filename = String(eventInit.filename || "");
      this.lineno = Number(eventInit.lineno || 0);
      this.colno = Number(eventInit.colno || 0);
      this.error = eventInit.error !== undefined ? eventInit.error : null;
    }
  }

  globalThis.Event = Event;
  globalThis.PointerEvent = PointerEvent;
  globalThis.TouchEvent = TouchEvent;
  globalThis.KeyboardEvent = KeyboardEvent;
  globalThis.ErrorEvent = ErrorEvent;
})();
