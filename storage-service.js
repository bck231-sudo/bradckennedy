export function createStorageService(storageLike) {
  const storage = storageLike && typeof storageLike.getItem === "function" ? storageLike : null;

  return {
    readText(key, fallback = "") {
      if (!storage) return fallback;
      try {
        const value = storage.getItem(key);
        return value == null ? fallback : String(value);
      } catch (_error) {
        return fallback;
      }
    },

    writeText(key, value) {
      if (!storage) return false;
      try {
        storage.setItem(key, String(value));
        return true;
      } catch (_error) {
        return false;
      }
    },

    remove(key) {
      if (!storage) return false;
      try {
        storage.removeItem(key);
        return true;
      } catch (_error) {
        return false;
      }
    },

    readJson(key, fallback) {
      const raw = this.readText(key, "");
      if (!raw) return fallback;
      try {
        return JSON.parse(raw);
      } catch (_error) {
        return fallback;
      }
    },

    writeJson(key, value) {
      return this.writeText(key, JSON.stringify(value));
    }
  };
}
