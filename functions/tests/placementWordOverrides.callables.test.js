const assert = require("node:assert/strict");
const Module = require("node:module");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createFirestoreMock(initialCollections = {}) {
  const collections = new Map();

  function ensureCollection(name) {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    return collections.get(name);
  }

  for (const [collectionName, docs] of Object.entries(initialCollections)) {
    const bucket = ensureCollection(collectionName);
    for (const [docId, data] of Object.entries(docs || {})) {
      bucket.set(docId, clone(data));
    }
  }

  function makeDocSnap(docId, raw) {
    return {
      id: docId,
      exists: raw !== undefined,
      data: () => (raw === undefined ? undefined : clone(raw)),
    };
  }

  return {
    collection(name) {
      const bucket = ensureCollection(name);
      return {
        doc(docId) {
          return {
            id: docId,
            async get() {
              return makeDocSnap(docId, bucket.get(docId));
            },
          };
        },
      };
    },
  };
}

function createHarness({ firestoreCollections = {} } = {}) {
  const firestore = createFirestoreMock(firestoreCollections);

  const adminMock = {
    apps: [],
    initializeApp() {
      this.apps.push({ initialized: true });
    },
    auth() {
      return {
        async getUser() {
          throw new Error("auth mock not used in this test");
        },
      };
    },
    firestore() {
      return firestore;
    },
    database() {
      return {
        ref() {
          return {
            async once() {
              return {
                exists: () => false,
                val: () => null,
              };
            },
          };
        },
      };
    },
  };

  adminMock.firestore.FieldValue = {
    serverTimestamp: () => "TS",
    delete: () => "DELETE",
  };

  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  const functionsMock = {
    https: {
      HttpsError,
      onCall(fn) {
        return fn;
      },
      onRequest(fn) {
        return fn;
      },
    },
    config() {
      return {};
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "firebase-admin") return adminMock;
    if (request === "firebase-admin/app") {
      return {
        getApps: () => adminMock.apps,
        initializeApp: (...args) => adminMock.initializeApp(...args),
      };
    }
    if (request === "firebase-admin/auth") {
      return {
        getAuth: () => adminMock.auth(),
      };
    }
    if (request === "firebase-admin/database") {
      return {
        getDatabase: () => adminMock.database(),
      };
    }
    if (request === "firebase-admin/firestore") {
      return {
        getFirestore: () => adminMock.firestore(),
        FieldValue: adminMock.firestore.FieldValue,
      };
    }
    if (request === "firebase-functions") return functionsMock;
    if (request === "firebase-functions/v1") return functionsMock;
    return originalLoad.call(this, request, parent, isMain);
  };

  const indexPath = require.resolve("../index.js");
  delete require.cache[indexPath];

  let functionsExports;
  try {
    functionsExports = require("../index.js");
  } finally {
    Module._load = originalLoad;
  }

  return {
    exports: functionsExports,
    HttpsError,
  };
}

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

(async () => {
  await runCase(
    "getPlacementWordOverrides returns matching override rows",
    async () => {
      const h = createHarness({
        firestoreCollections: {
          words: {
            DAP: {
              graphemes: ["D", "A", "P"],
              phonemes: ["D", "AH", "P"],
            },
            NANG: {
              graphemes: ["N", "A", "NG"],
              phonemes: ["N", "AE", "NG"],
            },
          },
        },
      });

      const result = await h.exports.getPlacementWordOverrides({
        words: ["dap", "NANG", "missing"],
      });

      assert.deepEqual(result.overrides.DAP, {
        graphemes: ["D", "A", "P"],
        phonemes: ["D", "AH", "P"],
      });
      assert.deepEqual(result.overrides.NANG, {
        graphemes: ["N", "A", "NG"],
        phonemes: ["N", "AE", "NG"],
      });
      assert.equal(
        Object.prototype.hasOwnProperty.call(result.overrides, "MISSING"),
        false,
      );
    },
  );

  await runCase(
    "getPlacementWordOverrides rejects oversized requests",
    async () => {
      const h = createHarness();
      const toWord = (index) => {
        let n = index;
        let out = "";
        do {
          out = String.fromCharCode(65 + (n % 26)) + out;
          n = Math.floor(n / 26) - 1;
        } while (n >= 0);
        return out;
      };
      const words = Array.from({ length: 501 }, (_v, i) => toWord(i));

      await assert.rejects(
        () => h.exports.getPlacementWordOverrides({ words }),
        (err) => err instanceof h.HttpsError && err.code === "invalid-argument",
      );
    },
  );

  console.log("All placementWordOverrides callable tests passed.");
})();
