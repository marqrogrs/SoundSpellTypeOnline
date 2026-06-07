// Temporary diagnostic script — safe to delete after use
const admin = require("../functions/node_modules/firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "soundspeller-c5e53" });
}
const db = admin.firestore();
db.collection("users")
  .where("role", "==", "student")
  .get()
  .then((snap) => {
    const noClass = snap.docs.filter((d) => {
      const data = d.data();
      const classIds = data.classIds || [];
      return classIds.length === 0;
    });
    console.log(`Unclassed students: ${noClass.length}`);
    noClass.forEach((d) => {
      const {
        firstName,
        lastName,
        email,
        username,
        classIds,
        educatorId,
        ownerId,
      } = d.data();
      console.log(
        JSON.stringify({
          id: d.id,
          firstName,
          lastName,
          email,
          username,
          classIds,
          educatorId,
          ownerId,
        }),
      );
    });
    process.exit(0);
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
