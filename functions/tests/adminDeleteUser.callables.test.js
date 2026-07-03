const assert = require("node:assert/strict");
const Module = require("node:module");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createFirestoreMock(initialCollections = {}) {
  const collections = new Map();
  let autoId = 0;

  function ensureCollection(name) {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    return collections.get(name);
  }

  function applySet(existing, data, options = {}) {
    if (!options.merge) {
      return clone(data);
    }
    const next = clone(existing || {});
    for (const [key, value] of Object.entries(data || {})) {
      if (value && value.__fieldValue === "arrayRemove") {
        const current = Array.isArray(next[key]) ? next[key] : [];
        next[key] = current.filter((item) => item !== value.value);
      } else {
        next[key] = clone(value);
      }
    }
    return next;
  }

  function makeDocRef(collectionName, docId) {
    const bucket = ensureCollection(collectionName);
    return {
      id: docId,
      async get() {
        const raw = bucket.get(docId);
        return {
          id: docId,
          exists: raw !== undefined,
          data: () => clone(raw),
          ref: makeDocRef(collectionName, docId),
        };
      },
      async set(data, options = {}) {
        const existing = bucket.get(docId);
        bucket.set(docId, applySet(existing, data, options));
      },
      async delete() {
        bucket.delete(docId);
      },
    };
  }

  function runQuery(collectionName, filters, limitCount) {
    const bucket = ensureCollection(collectionName);
    let rows = Array.from(bucket.entries()).map(([id, data]) => ({ id, data }));

    for (const filter of filters) {
      if (filter.op === "==") {
        rows = rows.filter((row) => row.data?.[filter.field] === filter.value);
      } else if (filter.op === "array-contains") {
        rows = rows.filter(
          (row) =>
            Array.isArray(row.data?.[filter.field]) &&
            row.data[filter.field].includes(filter.value),
        );
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
        ref: makeDocRef(collectionName, row.id),
      })),
    };
  }

  function makeQuery(collectionName, filters = [], limitCount = null) {
    return {
      orderBy() {
        return makeQuery(collectionName, filters, limitCount);
      },
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

  for (const [collectionName, docs] of Object.entries(initialCollections)) {
    const bucket = ensureCollection(collectionName);
    for (const [docId, data] of Object.entries(docs || {})) {
      bucket.set(docId, clone(data));
    }
  }

  return {
    _collections: collections,
    collection(name) {
      ensureCollection(name);
      return {
        doc(docId) {
          return makeDocRef(name, docId);
        },
        add(data) {
          autoId += 1;
          const id = `auto-${autoId}`;
          ensureCollection(name).set(id, clone(data));
          return { id };
        },
        where(field, op, value) {
          return makeQuery(name, [{ field, op, value }], null);
        },
        orderBy() {
          return makeQuery(name, [], null);
        },
        limit(nextLimit) {
          return makeQuery(name, [], Number(nextLimit));
        },
      };
    },
  };
}

function createHarness({
  authUsers = {},
  firestoreCollections = {},
  rtdb = {},
} = {}) {
  const firestore = createFirestoreMock(firestoreCollections);
  const deletedAuthUsers = [];

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
        async deleteUser(uid) {
          deletedAuthUsers.push(uid);
        },
        async getUsers() {
          return { users: [] };
        },
        async setCustomUserClaims() {},
      };
    },
    firestore() {
      return firestore;
    },
    database() {
      return {
        ref(path) {
          return {
            async remove() {
              delete rtdb[path];
            },
            async once() {
              return {
                exists() {
                  return Object.prototype.hasOwnProperty.call(rtdb, path);
                },
                val() {
                  return clone(rtdb[path]);
                },
              };
            },
          };
        },
      };
    },
  };

  adminMock.firestore.FieldValue = {
    serverTimestamp: () => ({ __fieldValue: "serverTimestamp" }),
    delete: () => ({ __fieldValue: "delete" }),
    arrayRemove: (value) => ({ __fieldValue: "arrayRemove", value }),
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
    deletedAuthUsers,
    firestore,
    HttpsError,
    rtdb,
  };
}

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

(async () => {
  await runCase("adminDeleteUser cascades student records", async () => {
    const h = createHarness({
      authUsers: {
        caller: {
          uid: "caller",
          email: "admin@example.com",
          customClaims: { role: "schoolAdmin" },
        },
      },
      firestoreCollections: {
        users: {
          student1: {
            role: "student",
            username: "student1",
            firstName: "Stu",
            lastName: "Dent",
          },
        },
        classes: {
          class1: { studentIds: ["student1", "other-student"] },
        },
        customLessonProgress: {
          progress1: { studentId: "student1", lessonId: "1.1" },
          progress2: { studentId: "other-student", lessonId: "1.1" },
        },
        customLessons: {
          lesson1: { assignedStudentIds: ["student1", "other-student"] },
          lesson2: { assignedStudentIds: ["student1"] },
        },
      },
      rtdb: {
        "/students/student1": { p: "hash" },
      },
    });

    const result = await h.exports.adminDeleteUser(
      { userId: "student1" },
      { auth: { uid: "caller" } },
    );

    assert.equal(result.status, "success");
    assert.equal(h.firestore._collections.get("users").has("student1"), false);
    assert.equal(
      h.firestore._collections.get("customLessonProgress").has("progress1"),
      false,
    );
    assert.equal(
      h.firestore._collections.get("customLessonProgress").has("progress2"),
      true,
    );
    assert.deepEqual(
      h.firestore._collections.get("customLessons").get("lesson1")
        .assignedStudentIds,
      ["other-student"],
    );
    assert.equal(
      h.firestore._collections.get("customLessons").has("lesson2"),
      false,
    );
    assert.deepEqual(
      h.firestore._collections.get("classes").get("class1").studentIds,
      ["other-student"],
    );
    assert.equal(h.rtdb["/students/student1"], undefined);
    assert.deepEqual(h.deletedAuthUsers, []);
  });

  console.log("All adminDeleteUser tests passed.");
})();
