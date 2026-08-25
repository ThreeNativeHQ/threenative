// localStorage - backed by native C++ file storage
(() => {
  function createStorage(nativeBacked) {
    // In-memory store for sessionStorage (or fallback)
    let memStore = {};
    let memKeys = [];

    const storage = {
      getItem: (key) => {
        const storageKey = String(key);
        if (nativeBacked) {
          return __storageGetItem(storageKey);
        }
        return Object.prototype.hasOwnProperty.call(memStore, storageKey)
          ? memStore[storageKey]
          : null;
      },
      setItem: (key, value) => {
        const storageKey = String(key);
        const storageValue = String(value);
        if (nativeBacked) {
          __storageSetItem(storageKey, storageValue);
        } else {
          if (!Object.prototype.hasOwnProperty.call(memStore, storageKey)) {
            memKeys.push(storageKey);
          }
          memStore[storageKey] = storageValue;
        }
      },
      removeItem: (key) => {
        const storageKey = String(key);
        if (nativeBacked) {
          __storageRemoveItem(storageKey);
        } else if (Object.prototype.hasOwnProperty.call(memStore, storageKey)) {
          delete memStore[storageKey];
          const idx = memKeys.indexOf(storageKey);
          if (idx !== -1) memKeys.splice(idx, 1);
        }
      },
      clear: () => {
        if (nativeBacked) {
          __storageClear();
        } else {
          memStore = {};
          memKeys = [];
        }
      },
      key: (index) => {
        if (nativeBacked) {
          return __storageKey(index);
        }
        return index >= 0 && index < memKeys.length ? memKeys[index] : null;
      },
      get length() {
        if (nativeBacked) {
          return __storageLength();
        }
        return memKeys.length;
      },
    };

    // Wrap with Proxy for bracket access (localStorage['key'] and localStorage.key)
    if (typeof Proxy !== "undefined") {
      return new Proxy(storage, {
        get: (target, prop) => {
          // Return own methods/properties first
          if (prop in target) return target[prop];
          if (typeof prop === "symbol") return undefined;
          // Treat as getItem
          return target.getItem(prop);
        },
        set: (target, prop, value) => {
          // Don't intercept known method names
          if (
            prop === "getItem" ||
            prop === "setItem" ||
            prop === "removeItem" ||
            prop === "clear" ||
            prop === "key" ||
            prop === "length"
          ) {
            return false;
          }
          if (typeof prop === "symbol") return false;
          target.setItem(prop, value);
          return true;
        },
        deleteProperty: (target, prop) => {
          target.removeItem(prop);
          return true;
        },
      });
    }

    return storage;
  }

  // localStorage: backed by native C++ file storage (persistent)
  globalThis.localStorage = createStorage(true);

  // sessionStorage: in-memory only (cleared when app closes)
  globalThis.sessionStorage = createStorage(false);
})();
