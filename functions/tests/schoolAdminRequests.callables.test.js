const assert = require("node:assert/strict");
const Module = require("node:module");

const SERVER_TIMESTAMP = Symbol("server-timestamp");
const DELETE_FIELD = Symbol("delete-field");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function applyMerge(target, patch) {
  const output = { ...(target || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === DELETE_FIELD) {
      delete output[key];
    } else if (value === SERVER_TIMESTAMP) {
      output[key] = "TS";
    } else {
      output[key] = value;
    }
  }
  return output;
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

  return {
    _collections: collections,
    collection(name) {
      const bucket = ensureCollection(name);
      return {
        doc(docId) {
          return {
            id: docId,
            async get() {
              return makeDocSnap(docId, bucket.get(docId));
            },
            async set(data, options = {}) {
              const existing = bucket.get(docId);
              const next = options.merge
                ? applyMerge(existing || {}, data)
                : applyMerge({}, data);
              bucket.set(docId, next);
            },
            async delete() {
              bucket.delete(docId);
            },
          };
        },
        async add(data) {
          autoId += 1;
          const id = `auto-${autoId}`;
          bucket.set(id, applyMerge({}, data));
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
  config = {},
} = {}) {
  const firestore = createFirestoreMock(firestoreCollections);

  const claimsCalls = [];
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
        async setCustomUserClaims(uid, claims) {
          claimsCalls.push({ uid, claims: clone(claims) });
        },
      };
    },
    firestore() {
      return firestore;
    },
    database() {
      return {
        ref() {
          throw new Error("Realtime DB mock not implemented for this test");
        },
      };
    },
  };

  adminMock.firestore.FieldValue = {
    serverTimestamp: () => SERVER_TIMESTAMP,
    delete: () => DELETE_FIELD,
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
      return clone(config);
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
    claimsCalls,
    firestore,
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
    "requestSchoolAdminAccess returns already-pending",
    async () => {
      const h = createHarness({
        authUsers: {
          requester: {
            uid: "requester",
            email: "teacher@example.com",
            customClaims: { role: "educator" },
          },
        },
        firestoreCollections: {
          users: {
            requester: { role: "educator", firstName: "Tea", lastName: "Cher" },
          },
          schoolAdminRoleRequests: {
            requester: { status: "pending", requesterUid: "requester" },
          },
        },
      });

      const result = await h.exports.requestSchoolAdminAccess(
        { schoolId: "school-1" },
        { auth: { uid: "requester" } },
      );

      assert.equal(result.status, "already-pending");
      assert.equal(result.requestId, "requester");
    },
  );

  await runCase(
    "adminListSchoolAdminRequests denies non-admin callers",
    async () => {
      const h = createHarness({
        authUsers: {
          educator1: {
            uid: "educator1",
            email: "teacher@example.com",
            customClaims: { role: "educator" },
          },
        },
        firestoreCollections: {
          schoolAdminRoleRequests: {
            req1: { status: "pending" },
          },
        },
      });

      await assert.rejects(
        () =>
          h.exports.adminListSchoolAdminRequests(
            { status: "pending", limit: 10 },
            { auth: { uid: "educator1" } },
          ),
        (err) => err.code === "permission-denied",
      );
    },
  );

  await runCase(
    "adminListSchoolAdminRequests returns filtered pending rows",
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
          schoolAdminRoleRequests: {
            req1: { status: "pending", requesterUid: "u1" },
            req2: { status: "approved", requesterUid: "u2" },
            req3: { status: "pending", requesterUid: "u3" },
          },
        },
      });

      const result = await h.exports.adminListSchoolAdminRequests(
        { status: "pending", limit: 50 },
        { auth: { uid: "admin1" } },
      );

      assert.equal(Array.isArray(result.requests), true);
      assert.equal(result.requests.length, 2);
      assert.deepEqual(result.requests.map((r) => r.id).sort(), [
        "req1",
        "req3",
      ]);
    },
  );

  await runCase(
    "adminReviewSchoolAdminRequest approve updates role and claims",
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
          users: {
            requester: {
              email: "requester@example.com",
              role: "educator",
              requestedRole: "schoolAdmin",
            },
          },
          schools: {
            schoolA: { isActive: true, name: "School A" },
          },
          schoolAdminRoleRequests: {
            requester: {
              status: "pending",
              requesterUid: "requester",
              requesterEmail: "requester@example.com",
              requestedSchoolId: "schoolA",
            },
          },
        },
      });

      const result = await h.exports.adminReviewSchoolAdminRequest(
        { requestId: "requester", decision: "approve" },
        { auth: { uid: "admin1" } },
      );

      assert.equal(result.status, "success");
      assert.equal(result.decision, "approved");
      assert.equal(h.claimsCalls.length, 1);
      assert.equal(h.claimsCalls[0].uid, "requester");
      assert.equal(h.claimsCalls[0].claims.schoolAdmin, true);

      const usersCol = h.firestore._collections.get("users");
      const requesterDoc = usersCol.get("requester");
      assert.equal(requesterDoc.role, "schoolAdmin");
      assert.equal(requesterDoc.schoolId, "schoolA");
      assert.equal(requesterDoc.schoolAdminRequestStatus, "approved");
      assert.equal(
        Object.prototype.hasOwnProperty.call(requesterDoc, "requestedRole"),
        false,
      );
    },
  );

  await runCase(
    "adminReviewSchoolAdminRequest rejects invalid decisions",
    async () => {
      const h = createHarness({
        authUsers: {
          admin1: {
            uid: "admin1",
            email: "admin@example.com",
            customClaims: { admin: true },
          },
        },
      });

      await assert.rejects(
        () =>
          h.exports.adminReviewSchoolAdminRequest(
            { requestId: "requester", decision: "later" },
            { auth: { uid: "admin1" } },
          ),
        (err) => err.code === "invalid-argument",
      );
    },
  );

  await runCase(
    "adminReviewSchoolAdminRequest deny sets denied status and preserves claims",
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
          users: {
            requester: {
              email: "requester@example.com",
              role: "educator",
              requestedRole: "schoolAdmin",
            },
          },
          schoolAdminRoleRequests: {
            requester: {
              status: "pending",
              requesterUid: "requester",
              requesterEmail: "requester@example.com",
            },
          },
        },
      });

      const result = await h.exports.adminReviewSchoolAdminRequest(
        {
          requestId: "requester",
          decision: "deny",
          decisionNote: "Could not verify school ownership",
        },
        { auth: { uid: "admin1" } },
      );

      assert.equal(result.status, "success");
      assert.equal(result.decision, "denied");
      assert.equal(h.claimsCalls.length, 0);

      const usersCol = h.firestore._collections.get("users");
      const requesterDoc = usersCol.get("requester");
      assert.equal(requesterDoc.role, "educator");
      assert.equal(requesterDoc.schoolAdminRequestStatus, "denied");
      assert.equal(
        Object.prototype.hasOwnProperty.call(requesterDoc, "requestedRole"),
        false,
      );

      const reqCol = h.firestore._collections.get("schoolAdminRoleRequests");
      const requestDoc = reqCol.get("requester");
      assert.equal(requestDoc.status, "denied");
      assert.equal(
        requestDoc.decisionNote,
        "Could not verify school ownership",
      );
    },
  );

  await runCase(
    "adminReviewSchoolAdminRequest approve fails when requested school is inactive",
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
          users: {
            requester: {
              email: "requester@example.com",
              role: "educator",
              requestedRole: "schoolAdmin",
            },
          },
          schools: {
            schoolInactive: { isActive: false, name: "Inactive School" },
          },
          schoolAdminRoleRequests: {
            requester: {
              status: "pending",
              requesterUid: "requester",
              requesterEmail: "requester@example.com",
              requestedSchoolId: "schoolInactive",
            },
          },
        },
      });

      await assert.rejects(
        () =>
          h.exports.adminReviewSchoolAdminRequest(
            { requestId: "requester", decision: "approve" },
            { auth: { uid: "admin1" } },
          ),
        (err) => err.code === "not-found",
      );

      assert.equal(h.claimsCalls.length, 0);
      const reqCol = h.firestore._collections.get("schoolAdminRoleRequests");
      const requestDoc = reqCol.get("requester");
      assert.equal(requestDoc.status, "pending");
    },
  );

  await runCase(
    "adminReviewSchoolAdminRequest rejects non-pending requests",
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
          schoolAdminRoleRequests: {
            requester: {
              status: "approved",
              requesterUid: "requester",
              requesterEmail: "requester@example.com",
            },
          },
        },
      });

      await assert.rejects(
        () =>
          h.exports.adminReviewSchoolAdminRequest(
            { requestId: "requester", decision: "deny" },
            { auth: { uid: "admin1" } },
          ),
        (err) => err.code === "failed-precondition",
      );
    },
  );

  await runCase(
    "adminReviewSchoolAdminRequest falls back to requestId when requester uid is missing",
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
          users: {
            requester: {
              email: "requester@example.com",
              role: "educator",
              requestedRole: "schoolAdmin",
            },
          },
          schools: {
            schoolA: { isActive: true, name: "School A" },
          },
          schoolAdminRoleRequests: {
            requester: {
              status: "pending",
              requesterUid: "",
              requesterEmail: "requester@example.com",
              requestedSchoolId: "schoolA",
            },
          },
        },
      });

      const result = await h.exports.adminReviewSchoolAdminRequest(
        { requestId: "requester", decision: "approve" },
        { auth: { uid: "admin1" } },
      );

      assert.equal(result.status, "success");
      assert.equal(result.decision, "approved");
      assert.equal(h.claimsCalls.length, 1);
      assert.equal(h.claimsCalls[0].uid, "requester");
    },
  );

  console.log("\nAll school admin callable tests passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
