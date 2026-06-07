// Parse auth export and show accounts WITHOUT email (generated-username students)
const d = require("/tmp/fb_users.json");
const users = d.users || [];
console.log(`Total accounts: ${users.length}`);
const noEmail = users.filter((u) => !u.email);
console.log(`\nAccounts with no email (${noEmail.length}):`);
noEmail.forEach((u) => {
  console.log(
    JSON.stringify({
      uid: u.localId,
      displayName: u.displayName,
      providers: (u.providerUserInfo || []).map((p) => p.providerId),
      customAttributes: u.customAttributes,
    }),
  );
});
