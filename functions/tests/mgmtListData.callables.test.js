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

  function runQuery(collectionName, filters, limitCount) {
    const bucket = ensureCollection(collectionName);
    let rows = Array.from(bucket.entries()).map(([id, data]) => ({ id, data }));

    for (const filter of filters) {
      if (filter.op === "==") {
        rows = rows.filter((row) => row.data?.[filter.field] === filter.value);
      }
    }

    if (typeof limitCount === "number") {
      rows = rows.slice(0, limitCount);
    }

    return {
      empty: rows.length === 0,
      docs: rows.map((row) => ({
        id: row.id,
        data: () => clone(row.data),
      })),
    };
  }

  function makeQuery(collectionName, filters = [], limitCount = null) {
    return {
      where(field, op, value) {
        return makeQuery(
          collectionName,
          [...filters, { field, op, value }],
          limitCount,
        );
      },
      limit(nextLimit) {
        return makeQuery(collectionName, filters, Number(nextLimit));
      },
      async get() {
        return runQuery(collectionName, filters, limitCount);
      },
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
        where(field, op, value) {
          return makeQuery(name, [{ field, op, value }], null);
        },
        async get() {
          return runQuery(name, [], null);
        },
      };
    },
    async getAll(...refs) {
      return Promise.all(refs.map((ref) => ref.get()));
    },
  };
}

function createHarness({ authUsers = {}, firestoreCollections = {} } = {}) {
  const firestore = createFirestoreMock(firestoreCollections);

  const adminMock = {
    apps: [],
    initializeApp() {
      this.apps.push({ initialized: true });
    },
    auth() {
      return {
        async getUser(uid) {
          const record = authUsers[uid];
          if (!record) {
            const err = new Error("auth/user-not-found");
            err.code = "auth/user-not-found";
            throw err;
          }
          return clone(record);
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
  };
  adminMock.firestore.FieldPath = {
    documentId: () => "__name__",
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
    },
    config() {
      return {};
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "firebase-admin") return adminMock;
    if (request === "firebase-functions") return functionsMock;
    if (request === "firebase-functions/v1") return functionsMock;
    return originalLoad.call(this, request, parent, isMain);
  };

  const indexPath = require.resolve("../index.js");
  const orgManagementPath = require.resolve("../orgManagement.js");
  delete require.cache[indexPath];
  delete require.cache[orgManagementPath];

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
    "mgmtListData infers parent role from owned students",
    async () => {
      const h = createHarness({
        authUsers: {
          admin1: {
            uid: "admin1",
            email: "admin@example.com",
            customClaims: { admin: true },
          },
        },
        firestoreCollections: {
          schools: {
            school1: { isActive: true, name: "School One" },
          },
          classes: {},
          users: {
            admin1: { role: "admin", email: "admin@example.com" },
            parent1: {
              role: "student",
              email: "klt1729@aol.com",
              firstName: "Kelly",
              lastName: "Newsham",
              schoolId: "school1",
            },
            keri1: {
              role: "student",
              firstName: "Keri",
              lastName: "Newsham",
              ownerId: "parent1",
              ownerRole: "parent",
              schoolId: "school1",
            },
            shelby1: {
              role: "student",
              firstName: "Shelby",
              lastName: "Newsham",
              parentOwnerId: "parent1",
              schoolId: "school1",
            },
          },
        },
      });

      const result = await h.exports.mgmtListData(
        {},
        { auth: { uid: "admin1" } },
      );
      const parentRow = (result.users || []).find((u) => u.id === "parent1");

      assert.ok(parentRow, "expected parent row in response");
      assert.equal(parentRow.role, "parent");
      assert.equal(parentRow.email, "klt1729@aol.com");
    },
  );

  await runCase(
    "mgmtListData infers tutor role when ownerRole is tutor",
    async () => {
      const h = createHarness({
        authUsers: {
          admin1: {
            uid: "admin1",
            email: "admin@example.com",
            customClaims: { admin: true },
          },
        },
        firestoreCollections: {
          schools: {
            school1: { isActive: true, name: "School One" },
          },
          classes: {},
          users: {
            admin1: { role: "admin", email: "admin@example.com" },
            tutor1: {
              role: "student",
              email: "tutor@example.com",
              schoolId: "school1",
            },
            student1: {
              role: "student",
              ownerId: "tutor1",
              ownerRole: "tutor",
              schoolId: "school1",
            },
          },
        },
      });

      const result = await h.exports.mgmtListData(
        {},
        { auth: { uid: "admin1" } },
      );
      const tutorRow = (result.users || []).find((u) => u.id === "tutor1");

      assert.ok(tutorRow, "expected tutor row in response");
      assert.equal(tutorRow.role, "tutor");
    },
  );

  await runCase(
    "mgmtListData preserves display names for parent rows",
    async () => {
      const h = createHarness({
        authUsers: {
          admin1: {
            uid: "admin1",
            email: "admin@example.com",
            customClaims: { admin: true },
          },
        },
        firestoreCollections: {
          schools: {
            school1: { isActive: true, name: "School One" },
          },
          classes: {},
          users: {
            admin1: { role: "admin", email: "admin@example.com" },
            parent1: {
              role: "student",
              email: "klt1729@aol.com",
              displayName: "Kelly Newsham",
              schoolId: "school1",
            },
            child1: {
              role: "student",
              firstName: "Keri",
              lastName: "Newsham",
              ownerId: "parent1",
              schoolId: "school1",
            },
          },
        },
      });

      const result = await h.exports.mgmtListData(
        {},
        { auth: { uid: "admin1" } },
      );
      const parentRow = (result.users || []).find((u) => u.id === "parent1");

      assert.ok(parentRow, "expected parent row in response");
      assert.equal(parentRow.role, "parent");
      assert.equal(parentRow.displayName, "Kelly Newsham");
      assert.equal(parentRow.firstName, "Kelly");
      assert.equal(parentRow.lastName, "Newsham");
    },
  );
})();
