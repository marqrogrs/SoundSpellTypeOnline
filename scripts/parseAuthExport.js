const d = require("/tmp/fb_users.json");
const users = d.users || [];
users.forEach((u) => {
  if (!u.email && !u.displayName) return;
  console.log(
    JSON.stringify({
      uid: u.localId,
      email: u.email,
      displayName: u.displayName,
      providers: (u.providerUserInfo || []).map((p) => p.providerId),
    }),
  );
});
