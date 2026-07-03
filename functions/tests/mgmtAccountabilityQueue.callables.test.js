const assert = require("node:assert/strict");
const Module = require("node:module");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function dayKeyDaysAgo(daysAgo) {
  const now = new Date();
  const ms = now.getTime() - daysAgo * 24 * 60 * 60 * 1000;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dayKeyDaysFromNow(daysFromNow) {
  const now = new Date();
  const ms = now.getTime() + daysFromNow * 24 * 60 * 60 * 1000;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function createFirestoreMock(initialCollections = {}) {
  const collections = new Map();
  const autoIds = new Map();

  function ensureCollection(name) {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    if (!autoIds.has(name)) {
      autoIds.set(name, 0);
    }
    return collections.get(name);
  }

  for (const [collectionName, docs] of Object.entries(initialCollections)) {
    const bucket = ensureCollection(collectionName);
    for (const [docId, data] of Object.entries(docs || {})) {
      bucket.set(docId, clone(data));
    }
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
              const raw = bucket.get(docId);
              return {
                id: docId,
                exists: raw !== undefined,
                data: () => (raw === undefined ? undefined : clone(raw)),
              };
            },
            async set(value, options = {}) {
              const current = bucket.get(docId);
              if (
                options &&
                options.merge &&
                current &&
                typeof current === "object"
              ) {
                bucket.set(docId, { ...clone(current), ...clone(value) });
              } else {
                bucket.set(docId, clone(value));
              }
            },
            async update(value) {
              const current = bucket.get(docId) || {};
              bucket.set(docId, { ...clone(current), ...clone(value) });
            },
          };
        },
        async add(value) {
          const nextId = (autoIds.get(name) || 0) + 1;
          autoIds.set(name, nextId);
          const id = `${name}-auto-${nextId}`;
          bucket.set(id, clone(value));
          return { id };
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
    "mgmtListAccountabilityQueue scopes to managed parent students",
    async () => {
      const h = createHarness({
        authUsers: {
          parent1: {
            uid: "parent1",
            email: "parent@example.com",
            customClaims: { role: "parent" },
          },
        },
        firestoreCollections: {
          users: {
            parent1: { role: "parent", email: "parent@example.com" },
            studentA: {
              role: "student",
              username: "studentA",
              ownerId: "parent1",
              firstName: "A",
              lastName: "Alpha",
              firstLessonAttemptedAt: "2026-01-01T00:00:00.000Z",
              lastPracticeDay: dayKeyDaysAgo(5),
            },
            studentB: {
              role: "student",
              username: "studentB",
              ownerId: "parent1",
              firstLessonAttemptedAt: "2026-01-01T00:00:00.000Z",
              lastPracticeDay: dayKeyDaysAgo(1),
            },
            studentC: {
              role: "student",
              username: "studentC",
              ownerId: "parent2",
              firstLessonAttemptedAt: "2026-01-01T00:00:00.000Z",
              lastPracticeDay: dayKeyDaysAgo(8),
            },
          },
        },
      });

      const result = await h.exports.mgmtListAccountabilityQueue(
        {},
        { auth: { uid: "parent1" } },
      );

      assert.equal(result.meta.callerRole, "parent");
      assert.equal(result.meta.totalScopedStudents, 2);
      assert.equal(result.queue.length, 1);
      assert.equal(result.queue[0].id, "studentA");
      assert.equal(result.queue[0].status.key, "returning");
    },
  );

  await runCase(
    "mgmtListAccountabilityQueue returns needs_first_win when requested",
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
            admin1: { role: "admin", email: "admin@example.com" },
            student1: {
              role: "student",
              username: "student1",
              firstName: "S",
              lastName: "One",
              lastPracticeDay: "",
            },
            student2: {
              role: "student",
              username: "student2",
              firstLessonAttemptedAt: "2026-01-01T00:00:00.000Z",
              lastPracticeDay: dayKeyDaysAgo(3),
            },
          },
        },
      });

      const result = await h.exports.mgmtListAccountabilityQueue(
        { includeNeedsFirstWin: true, minInactiveDays: 0 },
        { auth: { uid: "admin1" } },
      );

      assert.equal(result.meta.callerRole, "admin");
      assert.equal(result.meta.totalScopedStudents, 2);
      assert.equal(result.queue.length, 2);
      assert.equal(result.queue[0].status.key, "needs_first_win");
      assert.equal(result.queue[0].id, "student1");
    },
  );

  await runCase(
    "mgmtRecordAccountabilityReminder stores event and queue exposes last reminder",
    async () => {
      const h = createHarness({
        authUsers: {
          parent1: {
            uid: "parent1",
            email: "parent@example.com",
            customClaims: { role: "parent" },
          },
        },
        firestoreCollections: {
          users: {
            parent1: { role: "parent", email: "parent@example.com" },
            studentA: {
              role: "student",
              username: "studentA",
              ownerId: "parent1",
              firstLessonAttemptedAt: "2026-01-01T00:00:00.000Z",
              lastPracticeDay: dayKeyDaysAgo(4),
            },
          },
          accountabilityReminderState: {},
          accountabilityReminderEvents: {},
        },
      });

      const reminderResult = await h.exports.mgmtRecordAccountabilityReminder(
        {
          studentId: "studentA",
          channel: "in_app",
          note: "Quick reminder before tomorrow's check-in.",
        },
        { auth: { uid: "parent1" } },
      );

      assert.equal(reminderResult.status, "success");
      assert.ok(reminderResult.reminderId);

      const queueResult = await h.exports.mgmtListAccountabilityQueue(
        { minInactiveDays: 0 },
        { auth: { uid: "parent1" } },
      );

      assert.equal(queueResult.queue.length, 1);
      assert.equal(queueResult.queue[0].id, "studentA");
      assert.equal(queueResult.queue[0].lastReminder.channel, "in_app");
      assert.equal(
        queueResult.queue[0].lastReminder.note,
        "Quick reminder before tomorrow's check-in.",
      );
      assert.equal(queueResult.queue[0].reminderCount, 1);
    },
  );

  await runCase(
    "mgmtListAccountabilityQueue sets dueForCheckIn false for future dates",
    async () => {
      const h = createHarness({
        authUsers: {
          parent1: {
            uid: "parent1",
            email: "parent@example.com",
            customClaims: { role: "parent" },
          },
        },
        firestoreCollections: {
          users: {
            parent1: { role: "parent", email: "parent@example.com" },
            studentA: {
              role: "student",
              username: "studentA",
              ownerId: "parent1",
              firstLessonAttemptedAt: "2026-01-01T00:00:00.000Z",
              lastPracticeDay: dayKeyDaysAgo(1),
              nextCheckInDay: dayKeyDaysFromNow(3),
            },
          },
        },
      });

      const queueResult = await h.exports.mgmtListAccountabilityQueue(
        { minInactiveDays: 0, includeOnTrack: true },
        { auth: { uid: "parent1" } },
      );

      assert.equal(queueResult.queue.length, 1);
      assert.equal(queueResult.queue[0].id, "studentA");
      assert.equal(queueResult.queue[0].dueForCheckIn, false);
      assert.equal(queueResult.queue[0].daysUntilCheckIn >= 1, true);
    },
  );
})();
